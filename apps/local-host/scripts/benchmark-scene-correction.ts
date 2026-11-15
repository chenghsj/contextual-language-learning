/** Reuse paid discovery/selection; opt in to exactly one new whole-scene call. */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { GenerationRequestSchema } from "@contextual/core";
import { generatePiText, resolvePiModel } from "../src/agents/pi";
import { parseAgentJson } from "../src/agents/json";
import { reserveValidationTask } from "./live-validation-budget";
import {
  learningPointsPrompts,
  learningPointsBudget,
} from "../src/generation/learning-points-prompts";
import {
  CompactSceneSchema,
  readCompactSelection,
  readCompleteScene,
} from "../src/generation/compact-scenes";

const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const sampleArg = option("sample"),
  outputArg = option("output");
const taskBudget = option("budget");
if (!sampleArg || !outputArg)
  throw new Error(
    "Required: --sample=<previous-phase-directory> --output=<new-directory>; --live sends one model request",
  );
const sample = resolve(sampleArg),
  output = resolve(outputArg),
  live = process.argv.includes("--live");
const report = JSON.parse(await readFile(join(sample, "report.json"), "utf8"));
const request = GenerationRequestSchema.parse(
  JSON.parse(await readFile(join(sample, "request.json"), "utf8")),
);
if (
  report.sourceHash !== createHash("sha256").update(JSON.stringify(request.cues)).digest("hex") ||
  report.provider !== "antigravity" ||
  report.modelId !== "gemini-3.8-flash" ||
  JSON.stringify(report.profile) !== JSON.stringify(request.profile)
)
  throw new Error("Sample binding mismatch");
const allowed = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];
const override = process.env.ANTIGRAVITY_BASE_URL || process.env.NOAGY_BASE_URL;
if (override && !allowed.includes(override.replace(/\/$/, "")))
  throw new Error("Unapproved endpoint override");
const pool = CompactSceneSchema.array().parse(
  JSON.parse(await readFile(join(sample, "candidates.json"), "utf8")),
);
const selectionFile = (await readdir(sample)).find(f => f.endsWith("-selection-response.txt"));
if (
  !selectionFile ||
  !report.stages.some(
    (s: { step: string; validated: boolean }) => s.step === "selection" && s.validated,
  )
)
  throw new Error("Missing validated selection");
const prompts = learningPointsPrompts();
const savedPrompt = await readFile(
  join(sample, selectionFile.replace("-response.txt", "-prompt.txt")),
  "utf8",
);
if (savedPrompt !== prompts.compactSelectionPrompt(request, pool, report.outputBudget))
  throw new Error("Selection prompt binding mismatch");
const scenes = readCompactSelection(
  parseAgentJson(await readFile(join(sample, selectionFile), "utf8"), "Pi"),
  pool,
  request,
);
if (!scenes.length) throw new Error("No selected scene");
const prompt = prompts.completeScenePrompt(request, scenes[0], report.outputBudget);
await mkdir(output, { recursive: false });
await writeFile(join(output, "prompt.txt"), prompt);
await writeFile(
  join(output, "conditions.json"),
  JSON.stringify(
    {
      sample,
      live,
      sourceHash: report.sourceHash,
      provider: report.provider,
      modelId: report.modelId,
      effectiveThinkingLevel: report.effectiveThinkingLevel,
      outputBudget: report.outputBudget,
      maximumNewModelTasks: 1,
      sceneId: scenes[0].id,
      allowedDestinations: allowed,
    },
    null,
    2,
  ),
);
if (!live) {
  console.log(JSON.stringify({ output, prepared: true, modelCalls: 0 }));
} else {
  const agent = { ...request.agent, thinkingLevel: report.effectiveThinkingLevel };
  const resolved = await resolvePiModel(agent);
  if (!prompts.pointsPromptFits(prompt, learningPointsBudget(resolved, report.outputBudget)))
    throw new Error("Prompt exceeds model capacity");
  const start = performance.now();
  let failure: string | undefined;
  try {
    if (taskBudget) await reserveValidationTask(resolve(taskBudget), "scene-0-corrected-contract");
    const response = await generatePiText(resolved.agent, prompt, AbortSignal.timeout(180000), {
      step: "scene-0-corrected-contract",
      systemPrompt: prompts.system,
      format: "json",
      maxOutputTokens: report.outputBudget,
      allowIncomplete: true,
      onRetry: async () => {
        if (taskBudget) await reserveValidationTask(resolve(taskBudget), "scene-0-safe-retry");
      },
      onCall: async call => {
        await writeFile(join(output, "call.json"), JSON.stringify(call, null, 2));
      },
    });
    await writeFile(join(output, "response.txt"), response.text);
    if (response.incomplete) throw new Error("Truncated output; no automatic replay");
    const scene = readCompleteScene(parseAgentJson(response.text, "Pi"), scenes[0], request);
    await writeFile(join(output, "scene.json"), JSON.stringify(scene, null, 2));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    const result = {
      elapsedMs: performance.now() - start,
      structural: failure ? "failed" : "passed",
      semantic: "not-reviewed",
      failure,
    };
    await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, ...result }));
  }
}
