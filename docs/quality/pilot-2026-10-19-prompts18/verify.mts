/** Offline provenance/coverage/record verification; never starts inference or rejudges language. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  GenerationRequestSchema,
  validateLearningDocumentV7,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
} from "../../../packages/core/src/index.ts";
const folder = new URL("./", import.meta.url),
  root = new URL("../../../", folder);
const json = async (url: URL): Promise<any> => JSON.parse(await readFile(url, "utf8"));
const hash = async (url: URL) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");
const context = await json(new URL("run-context.json", folder));
const compatibility = await json(new URL("compatibility-context.json", folder));
assert.equal(compatibility.promptAndRulesUnchanged, true);
assert.deepEqual(
  compatibility.runtimeChanges.map((c: any) => c.path),
  ["packages/core/src/schema.ts", "apps/local-host/src/jobs/manager.ts"],
);
const finalHashes = { ...context.hashes };
for (const change of compatibility.runtimeChanges) {
  assert.equal(change.generationHash, context.hashes[change.path]);
  finalHashes[change.path] = change.finalHash;
}
const plan = await json(new URL("plan.json", folder));
const cases = await json(new URL("cases.json", folder));
const acceptance = await json(new URL("acceptance.json", folder));
const manifest = await json(new URL("raw-artifacts.sha256.json", folder));
for (const [path, expected] of Object.entries(manifest.files))
  assert.equal(await hash(new URL(path, folder)), expected, `Artifact changed: ${path}`);
for (const [path, expected] of Object.entries(context.planHashes))
  assert.equal(await hash(new URL(path, folder)), expected, `Frozen plan changed: ${path}`);
const drift: string[] = [];
for (const [path, expected] of Object.entries(finalHashes))
  if ((await hash(new URL(path, root))) !== expected) drift.push(path);
if (!process.argv.includes("--historical")) {
  assert.deepEqual(drift, [], "Source changed; historical mode checks stored records only");
  assert.equal(LEARNING_POINTS_PROMPT_VERSION, context.promptVersion);
  assert.equal(LANGUAGE_STRATEGY_VERSION, context.languageStrategyVersion);
}
assert.equal(plan.beforeInference, true);
assert.equal(context.newInferenceCallsAtFreeze, 0);
assert.equal(plan.caseCount, 12);
assert.equal(cases.length, 12);
assert.equal(acceptance.cases.length, 12);
const plannedNames = new Set(cases.map((c: any) => `${c.language}-${c.name}-automatic`));
assert.equal(plannedNames.size, 12);
const seen = new Set<string>();
let generated = 0,
  coveragePassed = 0,
  semanticPassed = 0,
  semanticFailed = 0,
  semanticNeedsReview = 0,
  accepted = 0,
  recordedCalls = 0,
  traceRequests = 0,
  traceResponses = 0,
  structuralRepairs = 0,
  callsWithoutUsage = 0;
const usage: Record<string, number> = {};
const at = (value: any, pointer: string) =>
  pointer
    .split("/")
    .slice(1)
    .reduce(
      (v, k) => v?.[Array.isArray(v) ? Number(k) : k.replaceAll("~1", "/").replaceAll("~0", "~")],
      value,
    );
for (const batch of ["batch-1", "batch-2"]) {
  const conditions = await json(new URL(batch + "/conditions.json", folder));
  assert.equal(conditions.casesHash, await hash(new URL("cases.json", folder)));
  assert.equal(conditions.tracePrompts, true);
  assert.equal(conditions.provider, plan.execution.provider);
  assert.equal(conditions.modelId, plan.execution.modelId);
  assert.equal(conditions.thinkingLevel, plan.execution.thinkingLevel);
  assert.equal(conditions.promptVersion, context.promptVersion);
  assert.equal(
    conditions.rulesHash,
    context.hashes["apps/local-host/src/generation/learning-points-rules.ts"],
  );
  assert.equal(
    conditions.promptsHash,
    context.hashes["apps/local-host/src/generation/learning-points-prompts.ts"],
  );
  const requests = await json(new URL(batch + "/requests.json", folder));
  const report = await json(new URL(batch + "/report.json", folder));
  assert.equal(report.length, 6);
  assert.equal(requests.length, 6);
  for (const row of report) {
    assert.ok(plannedNames.has(row.case));
    assert.ok(!seen.has(row.case));
    seen.add(row.case);
    const request = GenerationRequestSchema.parse(
      requests.find((r: any) => r.source.title === row.case),
    );
    const source = cases.find((c: any) => `${c.language}-${c.name}-automatic` === row.case);
    assert.deepEqual(
      request.cues.map(c => c.originalText),
      source.lines,
    );
    const decision = acceptance.cases.find((c: any) => c.case === row.case);
    assert.equal(decision.group, source.group);
    assert.equal(decision.generation, row.status);
    let doc: any;
    if (row.status === "generated") {
      generated++;
      const path = new URL(decision.document, folder);
      assert.equal(await hash(path), decision.documentHash);
      doc = validateLearningDocumentV7(await json(path));
      assert.equal(doc.id, request.id);
      assert.deepEqual(doc.cues, request.cues);
      assert.deepEqual(doc.profile, request.profile);
      assert.deepEqual(doc.execution, row.execution);
      assert.equal(doc.execution.promptVersion, context.promptVersion);
      assert.equal(doc.execution.languageStrategyVersion, context.languageStrategyVersion);
      assert.equal(doc.execution.provider, plan.execution.provider);
      assert.equal(doc.execution.modelId, plan.execution.modelId);
      const job = await json(new URL(`${batch}/${row.case}/jobs/${request.id}.json`, folder));
      assert.deepEqual(job.request, request);
      assert.deepEqual(job.execution, row.execution);
      const units = doc.sections.flatMap((s: any) => s.utterances);
      const selected = new Set(units.flatMap((u: any) => u.cueIds));
      const covered = request.cues.every(c => selected.has(c.id));
      assert.equal(decision.coverage, covered ? "passed" : "not_exercised");
      if (covered) coveragePassed++;
      const review = await json(new URL(decision.review, folder));
      assert.equal(review.case, row.case);
      assert.equal(review.documentHash, decision.documentHash);
      for (const issue of review.issues) {
        assert.ok(["error", "warning", "needs_review"].includes(issue.severity));
        assert.ok(
          (issue.paths ?? [issue.path]).some((path: string) =>
            JSON.stringify(at(doc, path))?.includes(issue.quote),
          ),
          `Missing review quote: ${row.case}`,
        );
      }
      const errors = review.issues.filter((i: any) => i.severity === "error").length;
      const pending = review.issues.filter((i: any) => i.severity === "needs_review").length;
      const verdict = errors ? "failed" : pending ? "needs_review" : "passed";
      assert.equal(review.verdict, verdict);
      assert.equal(decision.semantic, verdict);
      assert.equal(decision.accepted, covered && verdict === "passed");
      semanticPassed += Number(verdict === "passed");
      semanticFailed += Number(verdict === "failed");
      semanticNeedsReview += Number(verdict === "needs_review");
      accepted += Number(decision.accepted);
    } else {
      assert.equal(decision.accepted, false);
      assert.equal(decision.semantic, "generation_failed");
    }
    for (const call of row.execution?.calls ?? []) {
      recordedCalls++;
      structuralRepairs += Number(call.step.endsWith("-repair"));
      assert.equal(call.provider, conditions.provider);
      assert.equal(call.modelId, conditions.modelId);
      if (!call.usage) callsWithoutUsage++;
      for (const [k, v] of Object.entries(call.usage ?? {}))
        if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
    }
    const traceFolder = new URL(`${batch}/${row.case}/model-traces/`, folder);
    const names = await readdir(traceFolder);
    for (const name of names.filter(n => n.endsWith("-request.json"))) {
      traceRequests++;
      const trace = await json(new URL(name, traceFolder));
      assert.equal(trace.agent.provider, conditions.provider);
      assert.equal(trace.agent.modelId, conditions.modelId);
      assert.ok(trace.systemPrompt);
      assert.ok(trace.prompt);
      const response = name.replace("-request.json", "-response.json");
      const error = name.replace("-request.json", "-error.json");
      assert.ok(
        names.includes(response) || names.includes(error),
        "Unfinished captured model request",
      );
      if (names.includes(response)) {
        traceResponses++;
        const value = await json(new URL(response, traceFolder));
        assert.equal(typeof value.text, "string");
        assert.ok(
          (row.execution?.calls ?? []).some((call: any) => isDeepStrictEqual(call, value.call)),
          "Trace call not in saved execution",
        );
      }
    }
  }
}
assert.deepEqual(seen, plannedNames);
const counts = {
  requested: 12,
  generated,
  structuralPassed: generated,
  fixedSourcePassed: generated,
  identityPassed: generated,
  coveragePassed,
  semanticPassed,
  semanticFailed,
  semanticNeedsReview,
  accepted,
};
assert.deepEqual(acceptance.counts, counts);
assert.deepEqual(acceptance.usage, {
  recordedCalls,
  traceRequests,
  traceResponses,
  structuralRepairs,
  callsWithoutUsage,
  reportedTokens: usage,
  reasoningIncludedInOutput: true,
});
console.log(
  JSON.stringify(
    {
      evidence: "artifact_integrity_and_record_consistency_verified",
      semanticEvaluation:
        "Stored same-reviewer AI judgments; not an independent language re-evaluation",
      mode: process.argv.includes("--historical")
        ? "historical"
        : "frozen generation snapshot plus separately checked completed-lesson compatibility change",
      generationToFinalRuntimeChanges: compatibility.runtimeChanges.map((c: any) => c.path),
      sourceDrift: drift,
      counts,
      usage: acceptance.usage,
      modelCallsStartedByVerifier: 0,
    },
    null,
    2,
  ),
);
