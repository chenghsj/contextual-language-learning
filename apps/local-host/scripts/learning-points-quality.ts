/** Opt-in live inference; never included in pnpm test. */
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPLANATION_TYPES,
  HOST_PROTOCOL_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LEARNING_POINTS_WORKFLOW_VERSION,
  QUALITY_STRATEGY_VERSION,
  GenerationRequestSchema,
  type GenerationRequest,
} from "@contextual/core";
import { JobManager } from "../src/jobs/manager";
import { generatePiText } from "../src/agents/pi";
import { localStoragePorts } from "../src/storage/file";
import { qualityV7Cases as authoredCases } from "./quality-v7-cases";
const reactionAcceptance = process.argv.includes("--reaction-acceptance");
const casesFile = process.argv.find(a => a.startsWith("--cases-file="))?.slice(13);
if (casesFile && reactionAcceptance) throw new Error("Choose one case source");
const caseBytes = casesFile ? await readFile(casesFile) : undefined;
const customCases: typeof authoredCases | undefined = caseBytes
  ? JSON.parse(caseBytes.toString("utf8"))
  : undefined;
if (
  casesFile &&
  (!Array.isArray(customCases) ||
    !customCases.length ||
    customCases.some(
      c =>
        !c ||
        typeof c.name !== "string" ||
        !/^[a-z0-9-]+$/.test(c.name) ||
        !Array.isArray(c.lines) ||
        !c.lines.length ||
        c.lines.some(line => typeof line !== "string" || !line.trim()),
    ))
)
  throw new Error("Invalid authored quality cases");
const cases = reactionAcceptance
  ? ["N1", "N3"].flatMap(level =>
      authoredCases
        .filter(c => c.language === "ja")
        .map(c => ({
          ...c,
          level,
          name: c.name + "-" + level,
          lines: c.name === "normal-transfer" ? [...c.lines, "やった。[叫び声]"] : c.lines,
        })),
    )
  : (customCases ?? authoredCases);
if (new Set(cases.map(c => `${c.language}-${c.name}`)).size !== cases.length)
  throw new Error("Duplicate quality case");
const tracePrompts = process.argv.includes("--trace-prompts");
// This runner exercises the canonical automatic strategy, once per fixed source.
const filter = process.argv.find(a => a.startsWith("--case="))?.slice(7);
const languages = process.argv
  .find(a => a.startsWith("--languages="))
  ?.slice(12)
  .split(",");
const timeoutMs = Number(
  process.argv.find(a => a.startsWith("--timeout-ms="))?.slice(13) ?? 600000,
);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000)
  throw new Error("Quality timeout must be between 1000 and 600000 ms");
const selectedCases = cases.filter(
  c =>
    (!languages || languages.includes(c.language)) &&
    (!filter || filter.split(",").includes(`${c.language}-${c.name}-automatic`)),
);
const skip =
  process.argv
    .find(a => a.startsWith("--skip="))
    ?.slice(7)
    .split(",") ?? [];
const runnableCases = selectedCases.filter(
  c => !skip.includes(`${c.language}-${c.name}-automatic`),
);
const caseCount = runnableCases.length;
if (!caseCount) throw new Error("No matching quality cases");
const outputArg = process.argv.find(a => a.startsWith("--output="))?.slice(9);
const output = outputArg ?? (await mkdtemp(join(tmpdir(), "cll-learning-quality-")));
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error(
    "Quality output must be a new or empty directory; historical results cannot be reused",
  );
console.log(
  JSON.stringify({
    output,
    provider: "antigravity",
    modelId: "gemini-3.8-flash",
    thinkingLevel: "medium",
    source: casesFile
      ? "Explicit authored cases file"
      : reactionAcceptance
        ? "Four N1/N3 reaction and uncertainty acceptance samples"
        : "28 fixed authored V7 dialogues",
    caseCount,
  }),
);
const conditions = {
  provider: "antigravity",
  modelId: "gemini-3.8-flash",
  thinkingLevel: "medium",
  instructionLanguage: "zh-TW",
  contextualExampleCount: 1,
  timeoutMs,
  protocolVersion: HOST_PROTOCOL_VERSION,
  promptVersion: LEARNING_POINTS_PROMPT_VERSION,
  workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
  qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
  casesHash: createHash("sha256")
    .update(caseBytes ?? (await readFile(new URL("./quality-v7-cases.ts", import.meta.url))))
    .digest("hex"),
  generatorHashes: Object.fromEntries(
    await Promise.all(
      [
        "learning-execution.ts",
        "learning-candidates.ts",
        "learning-selection.ts",
        "learning-teaching.ts",
        "learning-points-pipeline.ts",
      ].map(async file => [
        file,
        createHash("sha256")
          .update(await readFile(new URL("../src/generation/" + file, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  ),
  rulesHash: createHash("sha256")
    .update(await readFile(new URL("../src/generation/learning-points-rules.ts", import.meta.url)))
    .digest("hex"),
  promptsHash: createHash("sha256")
    .update(
      await readFile(new URL("../src/generation/learning-points-prompts.ts", import.meta.url)),
    )
    .digest("hex"),
  transportPatchHash: createHash("sha256")
    .update(
      await readFile(new URL("../../../patches/pi-antigravity@0.14.0.patch", import.meta.url)),
    )
    .digest("hex"),
  selectedCases: runnableCases.map(c => `${c.language}-${c.name}-automatic`),
  ...(casesFile ? { casesFile: "case-definitions.json" } : {}),
  tracePrompts,
};
if (caseBytes) await writeFile(join(output, "case-definitions.json"), caseBytes, { flag: "wx" });
await writeFile(join(output, "conditions.json"), JSON.stringify(conditions, null, 2), {
  flag: "wx",
});
const requests = runnableCases.map(source => {
  // Match native request parsing before freezing the JSON fingerprint; storage
  // schema parsing otherwise changes field order and makes this harness unresumable.
  return GenerationRequestSchema.parse({
    id: randomUUID(),
    outputSchemaVersion: 7,
    source: { platform: "import", title: source.language + "-" + source.name + "-automatic" },
    agent: { provider: "antigravity", modelId: "gemini-3.8-flash", thinkingLevel: "medium" },
    profile: {
      targetLanguage: source.language,
      instructionLanguage: "zh-TW",
      level: source.level,
      sceneCount: 2,
      contextualExampleCount: 1,
      enabledExplanations: [...EXPLANATION_TYPES],
      emphasizedExplanations: [],
    },
    cues: source.lines.map((originalText, i) => ({
      id: `c${i + 1}`,
      originalText,
      startMs: i * 3000,
      endMs: i * 3000 + 2800,
    })),
  });
});
await writeFile(join(output, "requests.json"), JSON.stringify(requests, null, 2), { flag: "wx" });
if (process.argv.includes("--prepare-only")) {
  console.log(JSON.stringify({ prepared: true, output, caseCount, modelCalls: 0 }));
  process.exit(0);
}
const report: unknown[] = [];
for (const [index, source] of runnableCases.entries()) {
  const name = source.language + "-" + source.name + "-automatic",
    folder = join(output, name);
  await mkdir(folder);
  const request: GenerationRequest = requests[index];
  let lastStatus = "";
  const storage = localStoragePorts(folder);
  let traceIndex = 0;
  if (tracePrompts) await mkdir(join(folder, "model-traces"));
  const tracedGenerate: typeof generatePiText = async (agent, prompt, signal, options) => {
    const trace = join(folder, "model-traces", String(++traceIndex).padStart(3, "0"));
    await writeFile(
      trace + "-request.json",
      JSON.stringify(
        {
          agent,
          prompt,
          systemPrompt: options?.systemPrompt,
          step: options?.step,
          maxOutputTokens: options?.maxOutputTokens,
          boundary:
            "Arguments supplied to generatePiText, not a capture of the provider HTTP wire format or internal retry attempts.",
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    try {
      const response = await generatePiText(agent, prompt, signal, options);
      await writeFile(
        trace + "-response.json",
        JSON.stringify(
          {
            text: response.text,
            incomplete: response.incomplete,
            call: response.call,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      return response;
    } catch (error) {
      await writeFile(trace + "-error.json", JSON.stringify({ error: String(error) }), {
        flag: "wx",
      });
      throw error;
    }
  };
  const manager = new JobManager(
    { storage, ...(tracePrompts ? { generateText: tracedGenerate } : {}) },
    (_id, j) => {
      const state = JSON.stringify({
        case: name,
        phase: j.phase,
        status: j.status,
        completed: j.completed,
        total: j.total,
      });
      if (state !== lastStatus) {
        lastStatus = state;
        console.log(state);
      }
    },
  );
  const start = Date.now();
  try {
    const doc = await manager.start(request.id, request, AbortSignal.timeout(timeoutMs));
    if (doc.schemaVersion !== 7) throw new Error("Unexpected version");
    const result = {
      case: name,
      status: "generated",
      durationMs: Date.now() - start,
      id: doc.id,
      scenes: doc.sections.length,
      utterances: doc.sections.flatMap(s => s.utterances).length,
      points: doc.points.length,
      reusableItems: doc.reusableItems.length,
      execution: doc.execution,
      contentAssessment: "not_evaluated",
    };
    report.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const job = await storage.jobs.get(request.id);
    const result = {
      case: name,
      status: "failed",
      error: String(error),
      durationMs: Date.now() - start,
      execution: job?.execution,
      checkpoint: job?.learningPlan.batches.map(b => ({
        id: b.id,
        lastIssue: b.lastIssue,
      })),
    };
    report.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    finished: true,
    output,
    generated: report.filter((r: any) => r.status === "generated").length,
    total: report.length,
  }),
);
