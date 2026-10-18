/** Offline evidence verification. Never starts a generation job. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateLearningDocumentV7,
  LEARNING_POINTS_PROMPT_VERSION,
  LEARNING_POINTS_WORKFLOW_VERSION,
  QUALITY_STRATEGY_VERSION,
  GenerationRequestSchema,
} from "../../../packages/core/src/index.ts";

const root = new URL("../../../", import.meta.url);
const folder = new URL("./", import.meta.url);
const json = async (url: URL) => JSON.parse(await readFile(url, "utf8"));
const hash = async (url: URL) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");
const historical = process.argv.includes("--historical");
const sourceDrift: string[] = [];
const conditions = await json(new URL("conditions.json", folder));
const context = await json(new URL("run-context.json", folder));
const requests = await json(new URL("requests.json", folder));
const report = await json(new URL("report.json", folder));
const verification = await json(new URL("verification.json", folder));
const acceptance = await json(new URL("acceptance.json", folder));
const rawManifest = await json(new URL("raw-artifacts.sha256.json", folder));
assert.equal(requests.length, 4);
assert.equal(report.length, 4);
assert.equal(verification.cases.length, 4);
assert.equal(acceptance.cases.length, 4);
assert.deepEqual(
  requests.map((r: any) => r.source.title),
  conditions.selectedCases,
);
assert.deepEqual(context.caseIds, conditions.selectedCases);
assert.equal(context.sourceCommit, acceptance.sourceCommit);
for (const [key, current] of Object.entries({
  promptVersion: LEARNING_POINTS_PROMPT_VERSION,
  workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
  qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
})) {
  if (conditions[key] !== current) sourceDrift.push(key);
}

for (const [path, expected] of Object.entries(rawManifest.files)) {
  assert.equal(await hash(new URL(path, folder)), expected, `Raw artifact changed: ${path}`);
}
assert.equal(await hash(new URL("source-change.patch", folder)), context.sourceChangeHash);
const baselineRequests = await json(new URL(context.baseline + "/requests.json", folder));
assert.deepEqual(
  requests.map(({ id, ...r }: any) => r),
  baselineRequests.map(({ id, ...r }: any) => r),
);
const sources: Record<string, string> = {
  ...context.coreHashes,
  "apps/local-host/scripts/quality-v7-cases.ts": conditions.casesHash,
  "apps/local-host/scripts/learning-points-quality.ts": context.runnerHash,
  "apps/local-host/src/generation/learning-points-rules.ts": conditions.rulesHash,
  "apps/local-host/src/generation/learning-points-prompts.ts": conditions.promptsHash,
  "patches/pi-antigravity@0.10.0.patch": conditions.transportPatchHash,
};
for (const [name, expected] of Object.entries(conditions.generatorHashes)) {
  sources[`apps/local-host/src/generation/${name}`] = expected as string;
}
for (const [path, expected] of Object.entries(sources)) {
  if ((await hash(new URL(path, root))) !== expected) sourceDrift.push(path);
}

if (!historical)
  assert.deepEqual(
    sourceDrift,
    [],
    "Source changed; use --historical to verify frozen artifacts without claiming current acceptance",
  );
let accepted = 0;
let coveragePassed = 0;
let semanticPassed = 0;
let calls = 0;
let structuralRepairCalls = 0;
let callsWithoutUsage = 0;
let sumCaseDurationMs = 0;
const usage: Record<string, number> = {};
const at = (value: any, pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .reduce((v, key) => v?.[key], value);
for (const rawRequest of requests) {
  const request = GenerationRequestSchema.parse(rawRequest);
  const name = request.source.title;
  const row = report.find((r: any) => r.case === name);
  const check = verification.cases.find((c: any) => c.case === name);
  const verdict = acceptance.cases.find((c: any) => c.case === name);
  assert.ok(row && check && verdict);
  assert.equal(row.status, "generated");
  assert.equal(check.documentHash, verdict.documentHash);
  assert.equal(check.document, verdict.document);
  const documentUrl = new URL(verdict.document, root);
  assert.equal(await hash(documentUrl), verdict.documentHash);
  const document = validateLearningDocumentV7(await json(documentUrl));
  assert.deepEqual(document.cues, request.cues);
  assert.deepEqual(document.profile, request.profile);
  assert.equal(document.id, request.id);
  assert.equal(row.id, request.id);
  const execution = document.execution!;
  assert.deepEqual(execution, row.execution);
  for (const key of [
    "promptVersion",
    "workflowVersion",
    "qualityStrategyVersion",
    "provider",
    "modelId",
  ] as const) {
    assert.equal(execution[key], conditions[key]);
  }
  assert.equal(document.generation.thinkingLevel, conditions.thinkingLevel);
  const coverage = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/local-host/scripts/check-v7-case-coverage.ts",
      fileURLToPath(documentUrl),
    ],
    { cwd: fileURLToPath(root), encoding: "utf8" },
  );
  assert.ifError(coverage.error);
  const expectedCoverage = verdict.coverage;
  assert.equal(coverage.status, expectedCoverage === "passed" ? 0 : 1);
  if (expectedCoverage === "failed") {
    assert.match(coverage.stderr, /Unclear source became a reusable target/);
  } else coveragePassed++;
  const review = await json(new URL(verdict.review, folder));
  assert.equal(review.case, name);
  assert.equal(review.documentHash, verdict.documentHash);
  assert.equal(review.verdict, verdict.semantic);
  for (const issue of review.issues) {
    const paths = issue.paths ?? [issue.path];
    assert.ok(
      paths.some((path: string) => JSON.stringify(at(document, path))?.includes(issue.quote)),
      `Review quote absent: ${name}: ${issue.quote}`,
    );
  }
  assert.equal(verdict.errors, review.issues.filter((i: any) => i.severity === "error").length);
  assert.equal(verdict.warnings, review.issues.filter((i: any) => i.severity === "warning").length);
  assert.equal(review.verdict, verdict.errors ? "failed" : "passed");
  const isAccepted = review.verdict === "passed" && expectedCoverage === "passed";
  assert.equal(verdict.accepted, isAccepted);
  accepted += Number(isAccepted);
  semanticPassed += Number(review.verdict === "passed");
  assert.equal(row.durationMs, check.durationMs);
  sumCaseDurationMs += row.durationMs;
  assert.equal(execution.calls.length, check.calls);
  assert.deepEqual(
    execution.calls.map(c => c.step),
    check.steps,
  );
  const caseUsage: Record<string, number> = {};
  for (const call of execution.calls) {
    calls++;
    structuralRepairCalls += Number(call.step.endsWith("-repair"));
    assert.equal(call.provider, conditions.provider);
    assert.equal(call.modelId, conditions.modelId);
    assert.equal(call.billing, acceptance.usage.billing);
    if (!call.usage) {
      callsWithoutUsage++;
      continue;
    }
    for (const [key, value] of Object.entries(call.usage)) {
      if (typeof value !== "number") continue;
      caseUsage[key] = (caseUsage[key] ?? 0) + value;
      usage[key] = (usage[key] ?? 0) + value;
    }
  }
  assert.deepEqual(caseUsage, check.knownUsage);
}
assert.deepEqual(acceptance.counts, {
  requested: 4,
  generated: 4,
  structuralPassed: 4,
  fixedSourcePassed: 4,
  identityPassed: 4,
  coveragePassed,
  semanticPassed,
  accepted,
});
for (const [key, value] of Object.entries({
  calls,
  structuralRepairCalls,
  callsWithoutUsage,
  sumCaseDurationMs,
})) {
  assert.equal(acceptance.usage[key], value);
}
assert.deepEqual(acceptance.usage.reportedTokens, usage);
assert.equal(
  acceptance.decision,
  accepted === 4
    ? "four_sample_passed_do_not_expand_automatically"
    : "do_not_expand_to_28_before_fix_and_focused_revalidation",
);
console.log(
  JSON.stringify(
    {
      evidence: "verified",
      mode: historical
        ? "frozen historical artifacts only"
        : "current sources and frozen artifacts",
      sourceDrift,
      accepted,
      cases: 4,
      coveragePassed,
      semanticPassed,
      calls,
      sumCaseDurationMs,
      usage,
      modelCallsStartedByVerifier: 0,
    },
    null,
    2,
  ),
);
