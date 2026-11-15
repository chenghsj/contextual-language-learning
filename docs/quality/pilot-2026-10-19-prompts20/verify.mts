/** Verify saved evidence and report coverage; never score AI language judgments. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  GenerationRequestSchema,
  validateLearningDocumentV7,
} from "../../../packages/core/src/index.ts";
const folder = new URL("./", import.meta.url),
  root = new URL("../../../", folder);
const json = async (url: URL): Promise<any> => JSON.parse(await readFile(url, "utf8"));
const hash = async (url: URL) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");
const context = await json(new URL("run-context.json", folder));
const plan = await json(new URL("plan.json", folder));
const cases = await json(new URL("cases.json", folder));
async function verifyManifest(name: string, base = folder) {
  const manifest = await json(new URL(name, base));
  for (const [path, expected] of Object.entries(manifest.files))
    assert.equal(await hash(new URL(path, base)), expected, `Artifact changed: ${path}`);
  return manifest.files;
}
await verifyManifest("raw-artifacts.sha256.json");
await verifyManifest("manifest.json", new URL("history/editorial-gate/", folder));
for (const [path, expected] of Object.entries(context.planHashes))
  assert.equal(await hash(new URL(path, folder)), expected, `Frozen plan changed: ${path}`);
const sourceDrift: string[] = [];
for (const [path, expected] of Object.entries({
  ...context.hashes,
  ...context.verificationTestHashes,
}))
  if ((await hash(new URL(path, root))) !== expected) sourceDrift.push(path);
if (process.argv.includes("--require-current-source"))
  assert.deepEqual(sourceDrift, [], "Saved evidence belongs to a different source snapshot");
assert.equal(cases.length, plan.caseCount);
const prefix = process.argv.includes("--prepared") ? "prepared" : "batch-1";
const conditions = await json(new URL(`${prefix}/conditions.json`, folder));
const requests = await json(new URL(`${prefix}/requests.json`, folder));
assert.equal(conditions.casesHash, context.planHashes["cases.json"]);
assert.equal(conditions.promptVersion, context.promptVersion);
assert.equal(conditions.qualityStrategyVersion, context.qualityStrategyVersion);
assert.equal(conditions.workflowVersion, context.workflowVersion);
assert.equal(conditions.provider, plan.execution.provider);
assert.equal(conditions.modelId, plan.execution.modelId);
assert.equal(conditions.thinkingLevel, plan.execution.thinkingLevel);
assert.equal(
  conditions.rulesHash,
  context.hashes["apps/local-host/src/generation/learning-points-rules.ts"],
);
assert.equal(
  conditions.promptsHash,
  context.hashes["apps/local-host/src/generation/learning-points-prompts.ts"],
);
assert.equal(requests.length, cases.length);
assert.equal(new Set(requests.map((r: any) => r.id)).size, cases.length);
for (const source of cases) {
  const request = GenerationRequestSchema.parse(
    requests.find((r: any) => r.source.title === `${source.language}-${source.name}-automatic`),
  );
  assert.deepEqual(
    request.cues.map(c => c.originalText),
    source.lines,
  );
  assert.equal(request.profile.targetLanguage, source.language);
  assert.equal(request.profile.level, source.level);
  assert.equal(request.profile.instructionLanguage, conditions.instructionLanguage);
  assert.equal(request.profile.contextualExampleCount, conditions.contextualExampleCount);
  assert.equal(request.agent.provider, conditions.provider);
  assert.equal(request.agent.modelId, conditions.modelId);
}
const provenance = { sourceDrift, recordedSourceMatchesWorkspace: sourceDrift.length === 0 };
if (process.argv.includes("--prepared")) {
  console.log(
    JSON.stringify(
      {
        evidence: "saved_inputs_verified",
        mode: "historical_prepared_inputs",
        ...provenance,
        preparedCases: requests.length,
        contentQuality: "not_assessed",
        modelCallsStartedByVerifier: 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const captured = await verifyManifest("generation-artifacts.sha256.json");
for (const name of ["conditions.json", "requests.json", "report.json", "case-definitions.json"])
  assert.ok(Object.hasOwn(captured, `batch-1/${name}`));
const report = await json(new URL("validation.json", folder));
for (const key of [
  "aiAcceptanceScoreUsed",
  "independentEditorialReviewRequired",
  "editorialNotesBlockBrowserTesting",
  "optionalTeachingSelectionBlocksBrowserTesting",
])
  assert.equal(report.policy[key], false);
const rows = await json(new URL("batch-1/report.json", folder));
assert.equal(rows.length, cases.length);
assert.equal(report.cases.length, rows.length);
const at = (value: any, pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .reduce(
      (v, k) => v?.[Array.isArray(v) ? Number(k) : k.replaceAll("~1", "/").replaceAll("~0", "~")],
      value,
    );
const seen = new Set<string>();
let generated = 0,
  completeSourceCoverage = 0,
  targetsExercised = 0,
  targetsNotExercised = 0,
  editorialNotes = 0,
  recordedCalls = 0,
  traceRequests = 0,
  traceResponses = 0,
  structuralRepairs = 0,
  callsWithoutUsage = 0;
const tokens: Record<string, number> = {};
for (const row of rows) {
  assert.ok(!seen.has(row.case));
  seen.add(row.case);
  const request = GenerationRequestSchema.parse(
    requests.find((r: any) => r.source.title === row.case),
  );
  const entry = report.cases.find((r: any) => r.case === row.case);
  assert.equal(entry.generation, row.status);
  assert.equal(row.status, "generated");
  assert.ok(Object.hasOwn(captured, entry.document));
  assert.equal(await hash(new URL(entry.document, folder)), entry.documentHash);
  const doc = validateLearningDocumentV7(await json(new URL(entry.document, folder)));
  assert.equal(doc.id, request.id);
  assert.deepEqual(doc.cues, request.cues);
  assert.deepEqual(doc.profile, request.profile);
  assert.deepEqual(doc.execution, row.execution);
  assert.equal(doc.execution!.workflowVersion, context.workflowVersion);
  assert.equal(doc.execution!.promptVersion, context.promptVersion);
  assert.equal(doc.execution!.qualityStrategyVersion, context.qualityStrategyVersion);
  assert.equal(doc.execution!.languageStrategyVersion, context.languageStrategyVersion);
  assert.equal(doc.execution!.provider, conditions.provider);
  assert.equal(doc.execution!.modelId, conditions.modelId);
  const jobPath = `batch-1/${row.case}/jobs/${request.id}.json`;
  assert.ok(Object.hasOwn(captured, jobPath));
  const job = await json(new URL(jobPath, folder));
  assert.deepEqual(job.request, request);
  assert.deepEqual(job.execution, row.execution);
  generated++;
  const selected = new Set(doc.sections.flatMap(s => s.utterances.flatMap(u => u.cueIds)));
  completeSourceCoverage += Number(request.cues.every(c => selected.has(c.id)));
  assert.deepEqual(
    entry.teachingTargets.map((t: any) => t.id).sort(),
    [...plan.requiredTeachingTargets[row.case]].sort(),
  );
  for (const target of entry.teachingTargets) {
    assert.ok(["exercised", "not_exercised"].includes(target.observation));
    if (target.observation === "not_exercised") {
      targetsNotExercised++;
      continue;
    }
    assert.ok(
      JSON.stringify(at(doc, target.path))?.includes(target.quote),
      "Claimed teaching target has no matching quote",
    );
    const point = /^\/points\/(\d+)\/explanation$/.exec(target.teachingPath ?? "");
    assert.ok(point && at(doc, target.teachingPath)?.trim(), "Target has no teaching explanation");
    const item = /^\/reusableItems\/(\d+)\//.exec(target.path);
    if (item)
      assert.ok(
        doc.reusableItems[Number(item[1])].pointIds.includes(doc.points[Number(point[1])].id),
      );
    targetsExercised++;
  }
  for (const note of entry.editorialNotes) {
    assert.equal(note.blocking, false, "Editorial preference cannot block browser testing");
    assert.ok(
      JSON.stringify(at(doc, note.path))?.includes(note.quote),
      "Editorial note quote missing",
    );
    editorialNotes++;
  }
  const traceFolder = new URL(`batch-1/${row.case}/model-traces/`, folder);
  const names = await readdir(traceFolder);
  for (const name of names)
    assert.ok(Object.hasOwn(captured, `batch-1/${row.case}/model-traces/${name}`));
  const responses: any[] = [];
  for (const name of names.filter(n => n.endsWith("-request.json"))) {
    traceRequests++;
    const trace = await json(new URL(name, traceFolder));
    assert.equal(trace.agent.provider, conditions.provider);
    assert.equal(trace.agent.modelId, conditions.modelId);
    assert.ok(trace.prompt && trace.systemPrompt);
    const responseName = name.replace("-request.json", "-response.json");
    assert.ok(names.includes(responseName), "Captured request has no saved response");
    const response = await json(new URL(responseName, traceFolder));
    assert.equal(typeof response.text, "string");
    responses.push(response.call);
    traceResponses++;
  }
  assert.equal(responses.length, row.execution.calls.length);
  for (const call of row.execution.calls) {
    assert.ok(
      responses.some(r => isDeepStrictEqual(call, r)),
      "Recorded call has no matching client trace",
    );
    assert.equal(call.provider, conditions.provider);
    assert.equal(call.modelId, conditions.modelId);
    recordedCalls++;
    structuralRepairs += Number(call.step.endsWith("-repair"));
    callsWithoutUsage += Number(!call.usage);
    for (const [key, value] of Object.entries(call.usage ?? {}))
      if (typeof value === "number") tokens[key] = (tokens[key] ?? 0) + value;
  }
}
assert.deepEqual(seen, new Set(cases.map((c: any) => `${c.language}-${c.name}-automatic`)));
const usage = {
  recordedCalls,
  traceRequests,
  traceResponses,
  structuralRepairs,
  callsWithoutUsage,
  reportedTokens: tokens,
  reasoningIncludedInOutput: true,
};
assert.deepEqual(report.usage, usage);
console.log(
  JSON.stringify(
    {
      evidence: "saved_generation_records_verified",
      ...provenance,
      observations: {
        generatedCases: generated,
        structurallyValidated: generated,
        completeSourceCoverage,
        teachingTargetsExercised: targetsExercised,
        teachingTargetsNotExercised: targetsNotExercised,
        editorialNotes,
      },
      contentQuality: "not_scored",
      editorialNotesBlockBrowserTesting: false,
      installedBrowserAcceptance: report.installedBrowserAcceptance,
      usage,
      modelCallsStartedByVerifier: 0,
    },
    null,
    2,
  ),
);
