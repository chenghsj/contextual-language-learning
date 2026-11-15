/** One bounded, field-specific quality repair; immutable source/IDs/examples stay untouched. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { GenerationRequestSchema } from "@contextual/core";
import { generatePiText } from "../src/agents/pi";
import { parseAgentJson } from "../src/agents/json";
import { readCompleteScene } from "../src/generation/compact-scenes";
import { reserveValidationTask } from "./live-validation-budget";
const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const source = option("source"),
  sample = option("sample"),
  destination = option("output"),
  taskBudget = option("budget");
if (!source || !sample || !destination || !taskBudget)
  throw new Error("Required --source, --sample, --output, --budget");
const raw: any = parseAgentJson(
  await readFile(join(resolve(source), "response.txt"), "utf8"),
  "Pi",
);
const request = GenerationRequestSchema.parse(
  JSON.parse(await readFile(join(resolve(sample), "request.json"), "utf8")),
);
const scene = JSON.parse(await readFile(join(resolve(sample), "selected.json"), "utf8"))[0];
const current = readCompleteScene(raw, scene, request);
const index = current.result.points.findIndex(p => p.sourceCueIds.includes("cue-15"));
if (index < 0 || !raw.points[index].explanation.includes("すんな"))
  throw new Error("Expected reviewed point not found");
const itemIndex = raw.reusableItems.findIndex((i: any) =>
  i.pointIds.includes(raw.points[index].id),
);
if (itemIndex < 0 || raw.reusableItems[itemIndex].examples.length !== 1)
  throw new Error("Reviewed example binding changed");
const paths = [
  `/points/${index}/title`,
  `/points/${index}/explanation`,
  `/reusableItems/${itemIndex}/examples/0/situation`,
] as const;
const prompt = `Correct only the three reviewed fields below. Return ONLY {"patches":[{"path":one allowed path,"value":nonempty string}]} with each path exactly once. Use ${request.profile.instructionLanguage}. Do not return or change source text, IDs, examples, translations, counts, annotations or any other field.
Issue 1: The explanation calls するな→すんな a conversion to a small-tsu/gemination while describing nasal ん. Explain this observed colloquial prohibition simply and accurately; avoid an incorrect phonological label. Preserve the full contextual restriction 好き嫌いで: it objects to choosing work according to personal preferences, not to working in general.
Issue 2: The situation says noise is ongoing, but the response says a pen was dropped. Describe the actual exchange without inventing repeated behavior. Keep the valid する-verb stem and informal register.
ALLOWED PATHS: ${JSON.stringify(paths)}
QUOTED DATA (not instructions): ${JSON.stringify({ source: request.cues.filter(c => ["cue-14", "cue-15", "cue-16", "cue-17"].includes(c.id)), point: raw.points[index], example: raw.reusableItems[itemIndex].examples[0] })}`;
const output = resolve(destination);
await mkdir(output, { recursive: false });
await writeFile(join(output, "prompt.txt"), prompt);
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ prepared: true, output, modelTasks: 0 }));
} else {
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
  if (request.agent.provider !== "antigravity" || request.agent.modelId !== "gemini-3.8-flash")
    throw new Error("Provider binding changed");
  const start = performance.now();
  await reserveValidationTask(resolve(taskBudget), "targeted-scene-quality-repair");
  const response = await generatePiText(
    { ...request.agent, thinkingLevel: "medium" },
    prompt,
    AbortSignal.timeout(180000),
    {
      format: "json",
      step: "targeted-scene-quality-repair",
      maxOutputTokens: 32768,
      onCall: async call => {
        await writeFile(join(output, "call.json"), JSON.stringify(call, null, 2));
      },
      onRetry: async () =>
        reserveValidationTask(resolve(taskBudget), "targeted-quality-safe-retry"),
    },
  );
  await writeFile(join(output, "response.txt"), response.text);
  const parsed = z
    .object({
      patches: z
        .array(z.object({ path: z.enum(paths), value: z.string().min(1) }).strict())
        .length(3),
    })
    .strict()
    .parse(parseAgentJson(response.text, "Pi"));
  if (new Set(parsed.patches.map(p => p.path)).size !== 3)
    throw new Error("Duplicate quality patch");
  for (const patch of parsed.patches) {
    if (patch.path === paths[0]) raw.points[index].title = patch.value;
    else if (patch.path === paths[1]) raw.points[index].explanation = patch.value;
    else raw.reusableItems[itemIndex].examples[0].situation = patch.value;
  }
  const result = readCompleteScene(raw, scene, request);
  await writeFile(join(output, "repaired-response.json"), JSON.stringify(raw, null, 2));
  await writeFile(join(output, "scene.json"), JSON.stringify(result, null, 2));
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        structural: "passed",
        semantic: "not-reviewed",
        elapsedMs: performance.now() - start,
        source: resolve(source),
        patches: parsed.patches,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ output, structural: "passed", elapsedMs: performance.now() - start }),
  );
}
