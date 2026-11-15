/** Bounded, opt-in live experiment. Uses the existing product-owned provider login, never logs credentials. */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { GenerationRequestSchema, chunkCues, type ExecutionCall } from "@contextual/core";
import { generatePiText, resolvePiModel } from "../src/agents/pi";
import { parseAgentJson } from "../src/agents/json";
import {
  initialLearningPointsBudget,
  learningPointsPrompts,
} from "../src/generation/learning-points-prompts";
import {
  COMPACT_SCENE_EXPERIMENT_VERSION,
  readCompactCandidates,
  readCompactSelection,
  readCompleteScene,
} from "../src/generation/compact-scenes";

const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const jobPath = option("job"),
  outputPath = option("output");
if (!jobPath || !outputPath)
  throw new Error(
    "Required: --job=<saved-job.json> --output=<new-directory>. Opt-in with --live after inspecting --prepare-only.",
  );
const live = process.argv.includes("--live");
const reusePath = option("reuse-candidates");
if (reusePath && !live)
  throw new Error("Candidate reuse is only valid for the remaining live stages");
if (live && process.argv.includes("--prepare-only"))
  throw new Error("Choose --prepare-only or --live, not both");
const allowedOrigins = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];
const endpointOverride = process.env.ANTIGRAVITY_BASE_URL || process.env.NOAGY_BASE_URL;
if (endpointOverride && !allowedOrigins.includes(endpointOverride.replace(/\/$/, "")))
  throw new Error("This benchmark only permits the product provider's Google API endpoints");
const windows = (option("windows") ?? "0,1").split(",").map(Number);
if (
  !windows.length ||
  windows.length > 2 ||
  new Set(windows).size !== windows.length ||
  windows.some(n => !Number.isInteger(n) || n < 0)
)
  throw new Error("Choose at most two distinct zero-based windows");
const output = resolve(outputPath);
await mkdir(output, { recursive: false });
const saved = JSON.parse(await readFile(resolve(jobPath), "utf8"));
const request = GenerationRequestSchema.parse({
  ...saved.request,
  id: randomUUID(),
  destination: undefined,
  backup: undefined,
});
if (request.agent.provider !== "antigravity" || request.agent.modelId !== "gemini-3.8-flash")
  throw new Error("This benchmark is scoped to the original antigravity / gemini-3.8-flash task");
const chunks = chunkCues(request.cues);
if (windows.some(n => !chunks[n])) throw new Error("Unknown source window");
const prompts = learningPointsPrompts();
const resolved = live ? await resolvePiModel(request.agent) : null;
const capacity = resolved ?? saved.execution;
if (!capacity) throw new Error("Missing model capacity");
const thinking =
  resolved?.agent.thinkingLevel ??
  saved.execution?.effectiveThinkingLevel ??
  request.agent.thinkingLevel ??
  "medium";
const agent = resolved?.agent ?? { ...request.agent, thinkingLevel: thinking };
const budget = initialLearningPointsBudget(
  { ...capacity, modelId: resolved?.modelId ?? saved.execution.modelId },
  thinking,
);
const calls: ExecutionCall[] = [];
const conditions = {
  experimentVersion: COMPACT_SCENE_EXPERIMENT_VERSION,
  allowedDestinations: endpointOverride ? [endpointOverride] : allowedOrigins,
  ...(reusePath ? { reusedCandidatesFrom: resolve(reusePath) } : {}),
  live,
  provider: agent.provider,
  modelId: agent.modelId,
  effectiveThinkingLevel: thinking,
  outputBudget: budget.output,
  windows,
  originalWindowCount: chunks.length,
  profile: request.profile,
  sourceHash: createHash("sha256").update(JSON.stringify(request.cues)).digest("hex"),
  boundary:
    "At most two source-window calls, one selection and one complete scene. Does not publish, install, modify or resume the original job. This sample does not establish full-video latency or semantic quality.",
};
await writeFile(join(output, "conditions.json"), JSON.stringify(conditions, null, 2));
await writeFile(join(output, "request.json"), JSON.stringify(request, null, 2));
let sequence = 0;
let newModelCalls = 0;
const started = performance.now();
const stages: { step: string; durationMs: number; promptChars: number; validated?: boolean }[] = [];
const generate = async (prompt: string, step: string) => {
  if (!prompts.pointsPromptFits(prompt, budget))
    throw new Error(`${step}: prompt exceeds capacity`);
  const prefix = String(++sequence).padStart(2, "0") + "-" + step;
  await writeFile(join(output, prefix + "-prompt.txt"), prompt);
  const start = performance.now();
  newModelCalls++;
  const response = await generatePiText(agent, prompt, AbortSignal.timeout(180000), {
    systemPrompt: prompts.system,
    format: "json",
    step,
    maxOutputTokens: budget.output,
    allowIncomplete: true,
    onCall: async call => {
      calls.push(call);
      await writeFile(join(output, prefix + "-call.json"), JSON.stringify(call, null, 2));
    },
  });
  await writeFile(join(output, prefix + "-response.txt"), response.text);
  const stage = { step, durationMs: performance.now() - start, promptChars: prompt.length };
  stages.push(stage);
  console.log(JSON.stringify(stage));
  if (response.incomplete)
    throw new Error(`${step}: truncated output; sample stopped without an extra paid replay`);
  return parseAgentJson(response.text, "Pi");
};
let failure: string | undefined;
try {
  if (!live) {
    for (const index of windows) {
      const ids = chunks[index].map(c => c.id);
      const prompt = prompts.compactCandidatePrompt(request, ids, budget.output);
      await writeFile(join(output, `window-${index}-prompt.txt`), prompt);
      console.log(
        JSON.stringify({
          window: index,
          compactPromptChars: prompt.length,
          previousPromptChars: prompts.pointsCandidatePrompt(request, ids, budget.output).length,
        }),
      );
    }
  } else {
    const previous = reusePath
      ? JSON.parse(await readFile(join(resolve(reusePath), "report.json"), "utf8"))
      : null;
    if (
      previous &&
      (previous.sourceHash !== conditions.sourceHash ||
        previous.provider !== conditions.provider ||
        previous.modelId !== conditions.modelId ||
        previous.effectiveThinkingLevel !== thinking ||
        previous.outputBudget !== budget.output ||
        previous.experimentVersion !== COMPACT_SCENE_EXPERIMENT_VERSION ||
        JSON.stringify(previous.profile) !== JSON.stringify(request.profile) ||
        JSON.stringify(previous.windows) !== JSON.stringify(windows) ||
        previous.calls.length !== windows.length ||
        previous.calls.some((c: ExecutionCall) => !windows.some(i => c.step === `window-${i}`)))
    )
      throw new Error(
        "Saved candidate sample binding differs or has already spent later-stage calls",
      );
    const previousFiles = reusePath ? await readdir(resolve(reusePath)) : [];
    const results = await Promise.allSettled(
      windows.map(async index => {
        const ids = chunks[index].map(c => c.id);
        const step = `window-${index}`;
        const prompt = prompts.compactCandidatePrompt(request, ids, budget.output);
        let raw: unknown;
        if (reusePath) {
          const responseFile = previousFiles.find(f => f.endsWith(`-${step}-response.txt`));
          if (!responseFile) throw new Error("Missing saved candidate response");
          const prefix = responseFile.slice(0, -"-response.txt".length);
          if ((await readFile(join(resolve(reusePath), prefix + "-prompt.txt"), "utf8")) !== prompt)
            throw new Error("Saved prompt differs; refusing paid replay or mismatched reuse");
          raw = parseAgentJson(
            await readFile(join(resolve(reusePath), responseFile), "utf8"),
            "Pi",
          );
          const call = previous.calls.find((c: ExecutionCall) => c.step === step);
          if (!call || call.stopReason !== "stop")
            throw new Error("Saved candidate call was not complete");
          calls.push(call);
          stages.push({ step, durationMs: call.durationMs, promptChars: prompt.length });
        } else {
          raw = await generate(prompt, step);
        }
        const candidates = readCompactCandidates(
          raw,
          request,
          ids,
          prompts.sourceWindow(request.cues, ids).map(c => c.id),
        );
        stages.find(s => s.step === `window-${index}`)!.validated = true;
        return candidates;
      }),
    );
    const failed = results.find(r => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const pool = results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
    await writeFile(join(output, "candidates.json"), JSON.stringify(pool, null, 2));
    const scenes = readCompactSelection(
      await generate(prompts.compactSelectionPrompt(request, pool, budget.output), "selection"),
      pool,
      request,
    );
    stages.find(s => s.step === "selection")!.validated = true;
    await writeFile(join(output, "selected.json"), JSON.stringify(scenes, null, 2));
    if (!scenes.length) throw new Error("No suitable scene selected in sampled windows");
    const scene = readCompleteScene(
      await generate(prompts.completeScenePrompt(request, scenes[0], budget.output), "scene-0"),
      scenes[0],
      request,
    );
    stages.find(s => s.step === "scene-0")!.validated = true;
    await writeFile(join(output, "scene.json"), JSON.stringify(scene, null, 2));
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const report = {
    ...conditions,
    stages,
    calls,
    newModelCalls,
    elapsedMs: performance.now() - started,
    failure,
    structural: live && !failure ? "passed" : live ? "failed" : "not-run",
    semantic: "not-reviewed",
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ output, structural: report.structural, elapsedMs: report.elapsedMs, failure }),
  );
}
