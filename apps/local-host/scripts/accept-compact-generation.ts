/** Full-source acceptance through the real job manager, isolated storage and a durable request cap. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  GenerationRequestSchema,
  COMPACT_QUALITY_STRATEGY_VERSION,
  compactProgress,
  type JobSnapshotV5,
  type ExecutionCall,
} from "@contextual/core";
import { generatePiText } from "../src/agents/pi";
import { JobManager } from "../src/jobs/manager";
import { localStoragePorts } from "../src/storage/file";
import { handleLessonRequest } from "../src/host/lessons";
import { reserveValidationTask } from "./live-validation-budget";
const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const source = option("job"),
  destination = option("output"),
  budget = option("budget");
const lightStages = process.argv.includes("--light-candidates");
const lightSelection = process.argv.includes("--light-selection");
const reviewExisting = process.argv.includes("--review-existing");
const prepareOnly = process.argv.includes("--prepare-only");
if (!source || !destination || !budget) throw new Error("Required --job, --output, --budget");
const original = JSON.parse(await readFile(resolve(source), "utf8"));
if (
  reviewExisting &&
  (!original.compactPlan?.scenes?.length ||
    original.compactPlan.scenes.some((s: { result?: unknown }) => !s.result))
)
  throw new Error("Existing-quality acceptance requires all saved scene results");
if (reviewExisting && (lightStages || lightSelection))
  throw new Error("Existing review preserves the frozen reasoning policy");
const request = GenerationRequestSchema.parse({
  ...original.request,
  id: randomUUID(),
  destination: undefined,
  backup: undefined,
});
if (request.agent.provider !== "antigravity" || request.agent.modelId !== "gemini-3.8-flash")
  throw new Error("Unexpected provider/model");
const override = process.env.ANTIGRAVITY_BASE_URL || process.env.NOAGY_BASE_URL;
if (
  override &&
  ![
    "https://daily-cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ].includes(override.replace(/\/$/, ""))
)
  throw new Error("Unapproved endpoint override");
const output = resolve(destination);
await mkdir(output, { recursive: false });
await mkdir(join(output, "traces"));
await writeFile(join(output, "request.json"), JSON.stringify(request, null, 2));
const conditions = {
  mode: reviewExisting ? "known-draft-quality" : "full-cold",
  sourceJob: resolve(source),
  provider: request.agent.provider,
  modelId: request.agent.modelId,
  sourceHash: createHash("sha256").update(JSON.stringify(request.cues)).digest("hex"),
  cues: request.cues.length,
  budget: resolve(budget),
  prepareOnly,
  requestedAgent: request.agent,
  lightCandidates: lightStages,
  lightSelection,
  runtimeVersions: Object.fromEntries(
    await Promise.all(
      ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "pi-antigravity"].map(
        async name => [
          name,
          JSON.parse(
            await readFile(
              new URL(`../node_modules/${name}/package.json`, import.meta.url),
              "utf8",
            ),
          ).version,
        ],
      ),
    ),
  ),
  boundary:
    "Same approved video/provider, isolated storage, no original overwrite, enablement, installation or quota queries. Every new inference and safe retry reserves the shared task cap.",
};
await writeFile(join(output, "conditions.json"), JSON.stringify(conditions, null, 2));
if (prepareOnly) {
  console.log(JSON.stringify({ output, prepared: true, newModelTasks: 0, ...conditions }));
  process.exit(0);
}
const storage = localStoragePorts(join(output, "library"));
const calls: ExecutionCall[] = [];
let active = 0,
  peak = 0,
  sequence = 0,
  firstReadyMs: number | undefined,
  lastProgress = "";
const start = performance.now();
const manager = new JobManager(
  {
    storage,
    generationStrategy: "compact-scenes-1",
    ...(lightStages ? { compactAutomaticReasoning: "low" as const } : {}),
    ...(lightSelection ? { compactAutomaticSelectionReasoning: "low" as const } : {}),
    generateText: async (agent, prompt, signal, options) => {
      await reserveValidationTask(resolve(budget), options!.step!);
      const prefix = String(++sequence).padStart(2, "0");
      await writeFile(join(output, "traces", prefix + "-prompt.txt"), prompt);
      active++;
      peak = Math.max(peak, active);
      try {
        const response = await generatePiText(agent, prompt, signal, {
          ...options,
          onCall: async call => {
            calls.push(call);
            await writeFile(
              join(output, "traces", prefix + "-call.json"),
              JSON.stringify(call, null, 2),
            );
            await options!.onCall?.(call);
          },
          onRetry: async notice => {
            await reserveValidationTask(resolve(budget), options!.step! + "-safe-retry");
            await options!.onRetry?.(notice);
          },
        });
        await writeFile(join(output, "traces", prefix + "-response.txt"), response.text);
        return response;
      } finally {
        active--;
      }
    },
  },
  (_id, summary) => {
    if (!reviewExisting && summary.readySceneIds?.length && firstReadyMs === undefined)
      firstReadyMs = performance.now() - start;
    const key = [
      summary.phase,
      summary.completed,
      summary.readySceneIds?.length,
      summary.status,
    ].join(":");
    if (key !== lastProgress) {
      lastProgress = key;
      console.log(
        JSON.stringify({
          phase: summary.phase,
          status: summary.status,
          completed: summary.completed,
          total: summary.total,
          ready: summary.readySceneIds?.length ?? 0,
          elapsedMs: performance.now() - start,
        }),
      );
    }
  },
);
let failure: string | undefined,
  previewVerified = false;
try {
  if (reviewExisting) {
    const job = structuredClone(original) as JobSnapshotV5;
    job.request = request;
    job.execution!.inputFingerprint = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    job.execution!.compactQualityVersion = COMPACT_QUALITY_STRATEGY_VERSION;
    job.compactPlan!.reconciliation = undefined;
    job.summary = {
      ...job.summary,
      id: request.id,
      status: "waiting",
      documentId: undefined,
      ownerPid: undefined,
      error: undefined,
      execution: job.execution,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...compactProgress(job.compactPlan!, request.profile.sceneCount),
    };
    await storage.jobs.create(job);
  }
  const document = reviewExisting
    ? await manager.resume(request.id, request.id, AbortSignal.timeout(600000))
    : await manager.start(request.id, request, AbortSignal.timeout(600000));
  await writeFile(join(output, "document.json"), JSON.stringify(document, null, 2));
  const messages: unknown[] = [];
  await handleLessonRequest(
    { id: randomUUID(), type: "getJobPreview", jobId: request.id },
    { storage, manager, reply: m => messages.push(m) },
    (id, document) => messages.push({ id, type: "result", document }),
  );
  previewVerified =
    (messages[0] as { type: string }).type === "job" &&
    (messages[1] as { document: { id: string } }).document.id === document.id;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const report = {
    jobId: request.id,
    mode: conditions.mode,
    sourceHash: createHash("sha256").update(JSON.stringify(request.cues)).digest("hex"),
    originalJobId: original.summary.id,
    cues: request.cues.length,
    profile: request.profile,
    reasoningExperiment: reviewExisting
      ? "saved-frozen-policy"
      : lightSelection
        ? "light-selection-1"
        : lightStages
          ? "light-candidates-1"
          : "unchanged",
    firstReadyMs,
    elapsedMs: performance.now() - start,
    peak,
    calls,
    previewVerified,
    structural: failure ? "failed" : "passed",
    semantic: "not-reviewed",
    failure,
    boundary: reviewExisting
      ? "Real automatic source-quality review of a saved known draft, isolated workspace library, original task/material untouched. Not a cold-generation or Chrome playback measurement."
      : "Cold generation of all source windows, isolated workspace library; original task and installed library untouched. Real provider and actual JobManager, not Chrome playback acceptance.",
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report, calls: calls.length }));
}
