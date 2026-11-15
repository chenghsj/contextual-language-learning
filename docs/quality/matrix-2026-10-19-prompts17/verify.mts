/** Offline verification of this fixed matrix. Never starts inference. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  GenerationRequestSchema,
  validateLearningDocumentV7,
  LEARNING_POINTS_PROMPT_VERSION,
  LEARNING_POINTS_WORKFLOW_VERSION,
  QUALITY_STRATEGY_VERSION,
} from "../../../packages/core/src/index.ts";
import { qualityV7Cases } from "../../../apps/local-host/scripts/quality-v7-cases.ts";

const root = new URL("../../../", import.meta.url);
const folder = new URL("./", import.meta.url);
const json = async (url: URL): Promise<any> => JSON.parse(await readFile(url, "utf8"));
const hash = async (url: URL) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");
const historical = process.argv.includes("--historical");
const context = await json(new URL("run-context.json", folder));
const acceptance = await json(new URL("acceptance.json", folder));
const verification = await json(new URL("verification.json", folder));
const manifest = await json(new URL("raw-artifacts.sha256.json", folder));
for (const [name, expected] of Object.entries(manifest.files))
  assert.equal(await hash(new URL(name, folder)), expected, `Original artifact changed: ${name}`);
const sourceDrift: string[] = [];
const sources = {
  ...context.runtimeSourceHashes,
  ...context.dependencyManifestHashes,
  "apps/local-host/scripts/learning-points-quality.ts": context.runnerHash,
};
for (const [name, expected] of Object.entries(sources))
  if ((await hash(new URL(name, root))) !== expected) sourceDrift.push(name);
const tree = spawnSync("git", ["rev-parse", context.sourceCommit + "^{tree}"], {
  cwd: fileURLToPath(root),
  encoding: "utf8",
});
assert.ifError(tree.error);
assert.equal(tree.status, 0);
assert.equal(tree.stdout.trim(), context.sourceTree);
assert.equal(acceptance.sourceCommit, context.sourceCommit);

// Preserve initial judgments and make later editorial changes explicit.
// These checks establish record consistency, not linguistic correctness.
const reassessment = await json(new URL(acceptance.reassessment.record, folder));
const initialAcceptanceUrl = new URL(reassessment.initialAcceptance, folder);
assert.equal(await hash(initialAcceptanceUrl), reassessment.initialAcceptanceHash);
const initialAcceptance = await json(initialAcceptanceUrl);
assert.deepEqual(initialAcceptance.counts, reassessment.originalCounts);
assert.equal(
  await hash(new URL(reassessment.originalRubric, folder)),
  reassessment.originalRubricHash,
);
const initiallyUnaccepted = initialAcceptance.cases.filter((c: any) => !c.accepted);
assert.deepEqual(
  new Set(reassessment.cases.map((c: any) => c.case)),
  new Set(initiallyUnaccepted.map((c: any) => c.case)),
);
assert.equal(reassessment.cases.length, initiallyUnaccepted.length);
for (const change of reassessment.cases) {
  const original = initiallyUnaccepted.find((c: any) => c.case === change.case);
  const current = acceptance.cases.find((c: any) => c.case === change.case);
  assert.ok(original && current);
  assert.equal(change.originalReview, original.review);
  assert.equal(change.currentReview, current.review);
  assert.equal(await hash(new URL(change.originalReview, folder)), change.originalReviewHash);
  assert.equal(current.documentHash, original.documentHash);
}
for (const original of initialAcceptance.cases.filter((c: any) => c.accepted))
  assert.deepEqual(
    acceptance.cases.find((c: any) => c.case === original.case),
    original,
  );

const baseline = new URL(context.baseline + "/", folder);
const baselineContext = await json(new URL("run-context.json", baseline));
const baselineAcceptance = await json(new URL("acceptance.json", baseline));
const baselineConditions = await json(new URL("conditions.json", baseline));
assert.deepEqual(baselineContext.runtimeSourceHashes, context.runtimeSourceHashes);
assert.equal(baselineContext.runnerHash, context.runnerHash);
const baselineCheck = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    fileURLToPath(new URL("verify.mts", baseline)),
    ...(historical ? ["--historical"] : []),
  ],
  { cwd: fileURLToPath(root), encoding: "utf8" },
);
assert.ifError(baselineCheck.error);
assert.equal(baselineCheck.status, 0, baselineCheck.stderr);
assert.equal(baselineAcceptance.counts.accepted, 4);

const planned = context.caseIds as string[];
assert.equal(planned.length, 24);
assert.equal(new Set(planned).size, 24);
assert.equal(verification.cases.length, 24);
assert.equal(acceptance.cases.length, 28);
const frozenCaseNames: string[] = [];
const rows: any[] = [
  ...baselineAcceptance.cases.map((row: any) => ({
    ...row,
    generation: "generated",
    structural: "passed",
    fixedSource: "passed",
    identity: "passed",
    origin: "reused_accepted_pilot",
  })),
];
let recordedCalls = baselineAcceptance.usage.calls;
let structuralRepairCalls = baselineAcceptance.usage.structuralRepairCalls;
let callsWithoutUsage = baselineAcceptance.usage.callsWithoutUsage;
let sumCaseDurationMs = baselineAcceptance.usage.sumCaseDurationMs;
const usage: Record<string, number> = { ...baselineAcceptance.usage.reportedTokens };
const incompleteCallAccounting: string[] = [];
const at = (value: any, pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .reduce(
      (v, key) =>
        v?.[Array.isArray(v) ? Number(key) : key.replaceAll("~1", "/").replaceAll("~0", "~")],
      value,
    );

for (const batch of context.batches) {
  const batchFolder = new URL(batch.id + "/", folder);
  const conditions = await json(new URL("conditions.json", batchFolder));
  const requests = await json(new URL("requests.json", batchFolder));
  const report = await json(new URL("report.json", batchFolder));
  assert.equal(requests.length, 6);
  assert.equal(report.length, 6);
  assert.deepEqual(
    requests.map((r: any) => r.source.title),
    conditions.selectedCases,
  );
  frozenCaseNames.push(...conditions.selectedCases);
  for (const key of [
    "provider",
    "modelId",
    "thinkingLevel",
    "instructionLanguage",
    "contextualExampleCount",
    "timeoutMs",
    "protocolVersion",
    "promptVersion",
    "workflowVersion",
    "qualityStrategyVersion",
    "casesHash",
    "generatorHashes",
    "rulesHash",
    "promptsHash",
    "transportPatchHash",
  ])
    assert.deepEqual(
      conditions[key],
      baselineConditions[key],
      `Batch differs from accepted pilot: ${batch.id}/${key}`,
    );
  for (const [key, current] of Object.entries({
    promptVersion: LEARNING_POINTS_PROMPT_VERSION,
    workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
    qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
  }))
    if (conditions[key] !== current) sourceDrift.push(key);
  for (const [name, expected] of Object.entries({
    "apps/local-host/scripts/quality-v7-cases.ts": conditions.casesHash,
    "apps/local-host/src/generation/learning-points-rules.ts": conditions.rulesHash,
    "apps/local-host/src/generation/learning-points-prompts.ts": conditions.promptsHash,
    "patches/pi-antigravity@0.10.0.patch": conditions.transportPatchHash,
  }))
    if ((await hash(new URL(name, root))) !== expected) sourceDrift.push(name);
  for (const raw of requests) {
    const request = GenerationRequestSchema.parse(raw);
    const name = request.source.title!;
    const row = report.find((r: any) => r.case === name);
    const check = verification.cases.find((r: any) => r.case === name);
    const verdict = acceptance.cases.find((r: any) => r.case === name);
    assert.ok(row && check && verdict);
    assert.equal(check.batch, batch.id);
    assert.equal(check.generation, row.status);
    assert.equal(check.durationMs, row.durationMs);
    const job = await json(new URL(name + "/jobs/" + request.id + ".json", batchFolder));
    assert.deepEqual(job.request, request);
    assert.deepEqual(job.execution, row.execution);
    const fixture = qualityV7Cases.find(c => `${c.language}-${c.name}-automatic` === name);
    assert.ok(fixture);
    if (!historical)
      assert.deepEqual(
        request.cues.map(c => c.originalText),
        fixture.lines,
      );
    let document: any;
    if (row.status === "generated") {
      assert.equal(check.document, verdict.document);
      assert.equal(check.documentHash, verdict.documentHash);
      const documentUrl = new URL(check.document, root);
      assert.equal(await hash(documentUrl), check.documentHash);
      document = validateLearningDocumentV7(await json(documentUrl));
      assert.deepEqual(document.cues, request.cues);
      assert.deepEqual(document.profile, request.profile);
      assert.equal(document.id, request.id);
      assert.deepEqual(document.execution, row.execution);
      assert.equal(document.generation.thinkingLevel, conditions.thinkingLevel);
      for (const key of [
        "provider",
        "modelId",
        "workflowVersion",
        "promptVersion",
        "qualityStrategyVersion",
      ])
        assert.equal(document.execution[key], conditions[key]);
      for (const key of ["structural", "fixedSource", "identity"])
        assert.equal(check[key], "passed");
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
      assert.equal(coverage.status, verdict.coverage === "passed" ? 0 : 1);
      assert.equal(check.coverage, verdict.coverage);
    } else {
      assert.equal(row.status, "failed");
      assert.equal(check.document, null);
      assert.equal(verdict.accepted, false);
      assert.equal(verdict.semantic, "not_reviewed_generation_failed");
      assert.equal(check.error, row.error);
      incompleteCallAccounting.push(name);
    }
    const review = await json(new URL(verdict.review, folder));
    assert.equal(review.case, name);
    assert.equal(review.documentHash, check.documentHash);
    assert.equal(review.verdict, verdict.semantic);
    for (const issue of review.issues) {
      assert.ok(["error", "warning", "needs_review"].includes(issue.severity));
      assert.ok(
        (issue.paths ?? [issue.path]).some((path: string) =>
          JSON.stringify(at(document, path))?.includes(issue.quote),
        ),
        `Review quote absent: ${name}/${issue.quote}`,
      );
    }
    assert.equal(verdict.errors, review.issues.filter((i: any) => i.severity === "error").length);
    assert.equal(
      verdict.warnings,
      review.issues.filter((i: any) => i.severity === "warning").length,
    );
    const pendingIssues = review.issues.filter((i: any) => i.severity === "needs_review").length;
    assert.equal(verdict.pendingIssues ?? 0, pendingIssues);
    if (document)
      assert.equal(
        review.verdict,
        verdict.errors ? "failed" : pendingIssues ? "needs_review" : "passed",
      );
    assert.equal(
      verdict.accepted,
      !!document && check.coverage === "passed" && review.verdict === "passed",
    );
    assert.equal(verdict.generation, row.status);
    rows.push({
      ...verdict,
      structural: check.structural,
      fixedSource: check.fixedSource,
      identity: check.identity,
    });
    const calls = row.execution?.calls ?? [];
    assert.equal(check.calls, calls.length);
    assert.deepEqual(
      check.steps,
      calls.map((c: any) => c.step),
    );
    const caseUsage: Record<string, number> = {};
    for (const call of calls) {
      assert.equal(call.provider, conditions.provider);
      assert.equal(call.modelId, conditions.modelId);
      recordedCalls++;
      structuralRepairCalls += Number(call.step.endsWith("-repair"));
      if (!call.usage) {
        callsWithoutUsage++;
        continue;
      }
      for (const [key, value] of Object.entries(call.usage))
        if (typeof value === "number") {
          usage[key] = (usage[key] ?? 0) + value;
          caseUsage[key] = (caseUsage[key] ?? 0) + value;
        }
    }
    assert.deepEqual(check.knownUsage, caseUsage);
    sumCaseDurationMs += row.durationMs;
  }
}
assert.deepEqual(frozenCaseNames, planned);
assert.equal(new Set(rows.map(r => r.case)).size, 28);
assert.deepEqual(
  new Set(rows.map(r => r.case)),
  new Set(qualityV7Cases.map(c => `${c.language}-${c.name}-automatic`)),
);
for (const row of rows) {
  const verdict = acceptance.cases.find((r: any) => r.case === row.case);
  for (const key of [
    "accepted",
    "coverage",
    "semantic",
    "document",
    "documentHash",
    "errors",
    "warnings",
  ])
    assert.deepEqual(verdict[key], row[key]);
}
const counts = {
  requested: 28,
  generated: rows.filter(r => r.generation === "generated").length,
  structuralPassed: rows.filter(r => r.structural === "passed").length,
  fixedSourcePassed: rows.filter(r => r.fixedSource === "passed").length,
  identityPassed: rows.filter(r => r.identity === "passed").length,
  coveragePassed: rows.filter(r => r.coverage === "passed").length,
  semanticPassed: rows.filter(r => r.semantic === "passed").length,
  semanticFailed: rows.filter(r => r.semantic === "failed").length,
  semanticNeedsReview: rows.filter(r => r.semantic === "needs_review").length,
  accepted: rows.filter(r => r.accepted).length,
};
assert.deepEqual(acceptance.counts, counts);
assert.deepEqual(acceptance.usage.reportedTokens, usage);
for (const [key, value] of Object.entries({
  recordedCalls,
  structuralRepairCalls,
  callsWithoutUsage,
  sumCaseDurationMs,
  incompleteCallAccounting,
}))
  assert.deepEqual(acceptance.usage[key], value);
assert.equal(
  acceptance.decision,
  counts.accepted === 28
    ? "fixed_matrix_passed_with_recorded_warnings"
    : "fixed_matrix_has_unaccepted_cases_do_not_claim_complete_quality",
);
const drift = [...new Set(sourceDrift)];
if (!historical)
  assert.deepEqual(drift, [], "Sources changed; --historical checks old evidence only");
console.log(
  JSON.stringify(
    {
      evidence: "artifact_integrity_and_record_consistency_verified",
      semanticEvaluation:
        "Stored AI editorial judgments; not independently re-evaluated by this verifier",
      mode: historical ? "historical artifacts" : "current source and frozen artifacts",
      sourceDrift: drift,
      counts,
      recordedCalls,
      incompleteCallAccounting,
      modelCallsStartedByVerifier: 0,
    },
    null,
    2,
  ),
);
