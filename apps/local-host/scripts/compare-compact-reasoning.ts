/** Matched-prompt candidate comparison against a historical trace. No publishing. */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { GenerationRequestSchema, chunkCues } from "@contextual/core";
import { resolvePiModel, generatePiText } from "../src/agents/pi";
import { parseCompactJson } from "../src/generation/compact-json";
import { learningPointsPrompts } from "../src/generation/learning-points-prompts";
import {
  CompactSceneSchema,
  readCompactCandidates,
  readCompleteScene,
} from "../src/generation/compact-scenes";
import { reserveValidationTask } from "./live-validation-budget";

const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const baselinePath = option("baseline"),
  outputPath = option("output"),
  budgetPath = option("budget");
const windowIndex = Number(option("window") ?? "3");
const sceneArg = option("scene");
const sceneIndex = sceneArg === undefined ? undefined : Number(sceneArg);
const currentPrompt = process.argv.includes("--current-prompt");
if (
  !baselinePath ||
  !outputPath ||
  !budgetPath ||
  !Number.isInteger(windowIndex) ||
  windowIndex < 0 ||
  (sceneIndex !== undefined && (!Number.isInteger(sceneIndex) || sceneIndex < 0))
)
  throw new Error(
    "Required --baseline, --output, --budget and nonnegative --window; opt in with --live",
  );
const baseline = resolve(baselinePath),
  output = resolve(outputPath),
  budget = resolve(budgetPath);
const request = GenerationRequestSchema.parse(
  JSON.parse(await readFile(join(baseline, "request.json"), "utf8")),
);
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
const savedJob =
  sceneIndex === undefined
    ? undefined
    : JSON.parse(await readFile(join(baseline, "library", "jobs", request.id + ".json"), "utf8"));
if (
  savedJob &&
  (JSON.stringify(savedJob.request.cues) !== JSON.stringify(request.cues) ||
    JSON.stringify(savedJob.request.profile) !== JSON.stringify(request.profile))
)
  throw new Error("Scene checkpoint binding differs from the baseline request");
const scene =
  sceneIndex === undefined
    ? undefined
    : CompactSceneSchema.parse(savedJob.compactPlan?.scenes?.[sceneIndex]?.source);
const step = scene ? `scene-${scene.id}` : `window-${windowIndex}`;
const files = await readdir(join(baseline, "traces"));
let prefix: string | undefined;
for (const file of files.filter(f => f.endsWith("-call.json"))) {
  const call = JSON.parse(await readFile(join(baseline, "traces", file), "utf8"));
  if (call.step === step) {
    if (prefix) throw new Error("Ambiguous baseline trace");
    prefix = file.slice(0, -"-call.json".length);
  }
}
if (!prefix) throw new Error("Missing baseline trace");
const trace = (suffix: string) => join(baseline, "traces", prefix + suffix);
const baselineCall = JSON.parse(await readFile(trace("-call.json"), "utf8"));
const originalPrompt = await readFile(trace("-prompt.txt"), "utf8");
const ids = scene?.dialogueCueIds ?? chunkCues(request.cues)[windowIndex]?.map(c => c.id);
if (!ids) throw new Error("Unknown source window");
const prompts = learningPointsPrompts();
const generatedPrompt = scene
  ? prompts.completeScenePrompt(request, scene, baselineCall.outputTokenBudget)
  : prompts.compactCandidatePrompt(request, ids, baselineCall.outputTokenBudget);
if (!currentPrompt && originalPrompt !== generatedPrompt)
  throw new Error("Baseline prompt has drifted; a one-variable comparison would be invalid");
const prompt = currentPrompt ? generatedPrompt : originalPrompt;
const validate = (text: string) =>
  scene
    ? readCompleteScene(parseCompactJson(text).value, scene, request)
    : readCompactCandidates(
        parseCompactJson(text).value,
        request,
        ids,
        prompts.sourceWindow(request.cues, ids).map(c => c.id),
      );
const original = validate(await readFile(trace("-response.txt"), "utf8"));
await mkdir(output, { recursive: false });
await writeFile(join(output, "prompt.txt"), prompt);
const conditions = {
  baseline,
  step,
  sourceHash: createHash("sha256").update(JSON.stringify(request.cues)).digest("hex"),
  originalThinkingLevel: baselineCall.effectiveThinkingLevel,
  requestedThinkingLevel: "low",
  outputBudget: baselineCall.outputTokenBudget,
  promptIdentical: prompt === originalPrompt,
  baselineCall,
  ...(Array.isArray(original) ? { baselineCandidates: original } : { baselineScene: original }),
  ...(scene ? { sceneIndex, selectedSource: scene } : {}),
  live: process.argv.includes("--live"),
  boundary:
    "One candidate window or complete selected scene, one initial model task; safe retries reserve the shared cap. Same prompt/output allowance, model and source. No publishing, installation or original checkpoint changes. Semantic review required; one pair is not a latency distribution.",
};
await writeFile(join(output, "conditions.json"), JSON.stringify(conditions, null, 2));
if (conditions.live) {
  const resolved = await resolvePiModel({ ...request.agent, thinkingLevel: "low" });
  await reserveValidationTask(budget, `low-comparison-${step}`);
  const response = await generatePiText(resolved.agent, prompt, AbortSignal.timeout(180000), {
    systemPrompt: prompts.system,
    format: "json",
    step: `low-comparison-${step}`,
    maxOutputTokens: baselineCall.outputTokenBudget,
    allowIncomplete: true,
    onCall: async call => {
      await writeFile(join(output, "call.json"), JSON.stringify(call, null, 2));
    },
    onRetry: async () => {
      await reserveValidationTask(budget, `low-comparison-${step}-safe-retry`);
    },
  });
  await writeFile(join(output, "response.txt"), response.text);
  if (response.incomplete) throw new Error("Comparison truncated; retained without paid replay");
  const result = validate(response.text);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        ...conditions,
        call: response.call,
        ...(Array.isArray(result) ? { candidates: result } : { sceneResult: result }),
        structural: "passed",
        semantic: "not-reviewed",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      structural: "passed",
      ...(Array.isArray(result) ? { candidates: result.length } : { scene: sceneIndex }),
      call: response.call,
    }),
  );
} else
  console.log(
    JSON.stringify({
      output,
      prepared: true,
      ...(Array.isArray(original)
        ? { baselineCandidates: original.length }
        : { scene: sceneIndex }),
      newModelCalls: 0,
    }),
  );
