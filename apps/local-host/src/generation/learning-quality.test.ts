import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import {
  runBatchQuality,
  qualityRisks,
  qualityHash,
  CompletedQualityResponseError,
  validateQualityReview,
} from "./legacy/learning-quality";
import { LANGUAGES, LEVELS, LANGUAGE_CHECKS } from "./learning-points-rules";
import { pointsCandidatePrompt, pointsTeachingPrompt } from "./learning-points-prompts";
import {
  LEARNING_LANGUAGES,
  levelsForTargetLanguage,
  type QualityCheckpoint,
} from "@contextual/core";

function harness(risky = true) {
  const f = pointsFixture();
  let saved: QualityCheckpoint | undefined;
  if (risky)
    f.raw.risks = [
      {
        type: "reference_uncertainty",
        unitId: "u2",
        path: "/utterances/1/meaning",
        sourceSpans: f.input.scene.utterances[1].sourceSpans,
        description: "Check missing referent",
      },
    ];
  const calls: string[] = [];
  const options = {
    draft: f.raw,
    input: f.input,
    request: f.request,
    namespace: "test",
    batchId: "s0",
    budget: 8192,
    signal: new AbortController().signal,
    persist: async (q: QualityCheckpoint) => {
      saved = structuredClone(q);
    },
  };
  return {
    f,
    calls,
    options,
    get saved() {
      return saved;
    },
  };
}
const issue = (h: ReturnType<typeof harness>, type = "mistranslation", severity = "error") => ({
  severity,
  type,
  path: "/utterances/1/meaning",
  sourceSpans: h.f.input.scene.utterances[1].sourceSpans,
  description: "Concrete source issue",
});

test("review can cite necessary frozen context but not unrelated or other-batch source", () => {
  const h = harness(false);
  const context = {
    id: "context",
    originalText: "残念だけどあなたはその",
    startMs: 4000,
    endMs: 5000,
  };
  h.f.input.sourceWindow.push(context);
  h.f.input.scene.contextCueIds.push(context.id);
  const review = {
    issues: [
      {
        severity: "error",
        type: "uncertainty_bypass",
        path: "/context/text",
        sourceSpans: [{ cueId: context.id, start: 0, end: context.originalText.length }],
        description: "The incomplete source must not be quoted as a completed assertion.",
      },
    ],
  };
  assert.equal(validateQualityReview(review, h.f.raw, h.f.input).issues.length, 1);
  h.f.input.scene.contextCueIds = [];
  assert.throws(
    () => validateQualityReview(review, h.f.raw, h.f.input),
    /outside associated teaching unit/,
  );
  h.f.raw.utterances[1].contextCueIds.push(context.id);
  assert.equal(
    validateQualityReview(review, h.f.raw, h.f.input).issues.length,
    1,
    "A split batch may cite a necessary dialogue cue through its explicit context reference",
  );
});

test("Japanese omitted objects and unfinished context receive narrow risks, explicit self objects do not", () => {
  const h = harness(false);
  const cue = h.f.input.sourceWindow[1];
  cue.originalText = "ちょっと下に見てるのかな？";
  h.f.input.scene.utterances[1].sourceSpans = [
    { cueId: cue.id, start: 0, end: cue.originalText.length },
  ];
  h.f.raw.utterances[1].meaning = "是不是有點看扁我？";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "reference_uncertainty"));
  cue.originalText = "俺を下に見てるのかな？";
  h.f.input.scene.utterances[1].sourceSpans[0].end = cue.originalText.length;
  assert.ok(!qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "reference_uncertainty"));
  const context = {
    id: "context",
    originalText: "残念だけどあなたはその",
    startMs: 4000,
    endMs: 5000,
  };
  h.f.input.sourceWindow.push(context);
  h.f.input.scene.contextCueIds.push(context.id);
  assert.ok(qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "source_uncertainty"));
  assert.ok(!qualityRisks(h.f.raw, h.f.input, "en").some(r => r.type === "source_uncertainty"));
});

test("Japanese completion endings do not trigger review unless teaching claims accident or regret", () => {
  const h = harness(false);
  const cue = h.f.input.sourceWindow[1];
  cue.originalText = "傷つけちゃった。";
  h.f.input.scene.utterances[1].sourceSpans = [
    { cueId: cue.id, start: 0, end: cue.originalText.length },
  ];
  h.f.raw.utterances[1].meaning = "傷害過。";
  h.f.raw.utterances[1].contextExplanation = "";
  h.f.raw.points.forEach((p: { explanation: string }) => {
    p.explanation = "Completed action.";
  });
  assert.ok(!qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "context_inference"));
  h.f.raw.utterances[1].meaning = "不小心傷害了對方，很後悔。";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "context_inference"));
});

test("no risk means zero reviews even with frames, nonempty context and advanced proficiency", async () => {
  const h = harness(false);
  h.f.request.profile.level = "C2";
  assert.deepEqual(qualityRisks(h.f.raw, h.f.input, "en"), []);
  const result = await runBatchQuality({
    ...h.options,
    generate: async () => {
      throw new Error("must not call");
    },
  });
  assert.equal(result.checkpoint.phase, "accepted");
  assert.equal(result.checkpoint.review, undefined);
});
test("warning accepts and completed review is never resent on resume", async () => {
  const h = harness();
  let calls = 0;
  const first = await runBatchQuality({
    ...h.options,
    generate: async () => {
      calls++;
      return { issues: [issue(h, "verbosity", "warning")] };
    },
  });
  assert.equal(first.checkpoint.phase, "accepted");
  assert.equal(calls, 1);
  await runBatchQuality({
    ...h.options,
    saved: h.saved,
    generate: async () => {
      throw new Error("must not replay");
    },
  });
});
test("one review, one repair, one recheck; frozen units persist and only current evidence included", async () => {
  const h = harness();
  const result = await runBatchQuality({
    ...h.options,
    generate: async (prompt, step) => {
      h.calls.push(step);
      if (step.endsWith("-review")) return { issues: [issue(h)] };
      if (step.endsWith("-repair"))
        return { patches: [{ path: "/utterances/1/meaning", value: "修正後的句意。" }] };
      assert.ok(prompt.includes("Recheck"));
      return { issues: [] };
    },
  });
  assert.deepEqual(h.calls, ["s0-quality-review", "s0-quality-repair", "s0-quality-recheck"]);
  assert.equal(result.checkpoint.repairEligible, false);
  assert.notEqual(
    JSON.stringify(result.checkpoint.originalDraft),
    JSON.stringify(result.checkpoint.draft),
  );
  assert.deepEqual(
    result.result.section.utterances.map(u => u.sourceSpans),
    h.f.input.scene.utterances.map(u => u.sourceSpans),
  );
});
for (const mode of [
  "invalid-review",
  "boundary",
  "invalid-repair",
  "recheck-error",
  "unknown-paid",
] as const)
  test(mode + " blocks publication and resume cannot restore allowance", async () => {
    const h = harness();
    let calls = 0;
    const generate = async (_p: string, step: string): Promise<unknown> => {
      calls++;
      if (mode === "unknown-paid") throw new Error("stream disconnected after output");
      if (mode === "invalid-review") return { ok: true };
      if (step.endsWith("-review"))
        return { issues: [issue(h, mode === "boundary" ? "unit_boundary" : "mistranslation")] };
      if (step.endsWith("-repair"))
        return mode === "invalid-repair"
          ? { patches: [{ path: "/sceneId", value: "wrong" }] }
          : { patches: [] };
      return { issues: [issue(h)] };
    };
    await assert.rejects(runBatchQuality({ ...h.options, generate }));
    const before = calls;
    assert.equal(h.saved!.phase, "blocked");
    await assert.rejects(runBatchQuality({ ...h.options, saved: h.saved, generate }), /blocked/i);
    assert.equal(calls, before);
  });
test("cancel interrupted stage and resume only unfinished stage, preserving completed review", async () => {
  const h = harness(),
    controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    runBatchQuality({
      ...h.options,
      signal: controller.signal,
      generate: async (_p, step) => {
        calls++;
        if (step.endsWith("-review")) return { issues: [issue(h)] };
        controller.abort();
        throw new Error("cancelled");
      },
    }),
  );
  assert.equal(h.saved!.phase, "repair_pending");
  const resumeSteps: string[] = [];
  await runBatchQuality({
    ...h.options,
    saved: h.saved,
    generate: async (_p, step) => {
      resumeSteps.push(step);
      return step.endsWith("-repair") ? { patches: [] } : { issues: [] };
    },
  });
  assert.deepEqual(resumeSteps, ["s0-quality-repair", "s0-quality-recheck"]);
});
test("draft and review hash mismatches and unresolved started request cannot be replayed", async () => {
  const h = harness();
  await runBatchQuality({ ...h.options, generate: async () => ({ issues: [] }) });
  for (const mutation of [
    (q: QualityCheckpoint) => {
      q.draft.title = "corrupt";
    },
    (q: QualityCheckpoint) => {
      q.inputHash = "0".repeat(64);
    },
    (q: QualityCheckpoint) => {
      q.reviewHash = "0".repeat(64);
    },
    (q: QualityCheckpoint) => {
      q.phase = "review_started";
    },
  ]) {
    const q = structuredClone(h.saved!);
    mutation(q);
    await assert.rejects(
      runBatchQuality({
        ...h.options,
        saved: q,
        generate: async () => {
          throw new Error("must not call");
        },
      }),
    );
  }
});
test("all 14 languages x valid levels x explanation languages isolate specialized rules", () => {
  const f = pointsFixture();
  let combinations = 0;
  for (const target of LEARNING_LANGUAGES)
    for (const level of levelsForTargetLanguage(target))
      for (const instruction of LEARNING_LANGUAGES) {
        const request = {
          ...f.request,
          profile: {
            ...f.request.profile,
            targetLanguage: target,
            instructionLanguage: instruction,
            level,
          },
        };
        const candidate = pointsCandidatePrompt(
            request,
            request.cues.map(c => c.id),
            8192,
          ),
          teaching = pointsTeachingPrompt(request, f.input, 8192);
        assert.ok(candidate.includes(LANGUAGES[target]));
        assert.ok(teaching.includes(`Examples per reusable item: 1`));
        for (const other of ["ja", "ko"] as const)
          if (other !== target) assert.ok(!teaching.includes(LANGUAGE_CHECKS[other]!));
        if (target !== "ja") assert.ok(!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(teaching));
        if (target !== "ko") assert.ok(!/알려|같이/u.test(teaching));
        combinations++;
      }
  assert.ok(combinations >= 1000);
  assert.equal(Object.keys(LANGUAGES).length, 14);
  assert.equal(Object.keys(LEVELS).length, 17);
});

test("French quotation markers trigger review and source/unit drift rejects a saved quality phase", async () => {
  const h = harness(false);
  h.f.request.cues[0].originalText = "« Oui », a-t-elle dit.";
  h.f.input.scene.utterances[0].sourceSpans[0].end = h.f.request.cues[0].originalText.length;
  assert.ok(qualityRisks(h.f.raw, h.f.input, "fr").some(r => r.type === "reported_role"));
  const regular = harness();
  await runBatchQuality({ ...regular.options, generate: async () => ({ issues: [] }) });
  const changed = structuredClone(regular.f.input);
  changed.scene.learningValue = "changed source selection";
  await assert.rejects(
    runBatchQuality({
      ...regular.options,
      input: changed,
      saved: regular.saved,
      generate: async () => {
        throw new Error("must not replay");
      },
    }),
    /input hash mismatch/,
  );
});

test("Portuguese completed-past terminology is a targeted risk, not a global construction trigger", () => {
  const h = harness(false);
  h.f.raw.points[0].explanation += " 此處為過去完成式。";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "pt").some(r => r.type === "construction_example"));
  assert.deepEqual(qualityRisks(h.f.raw, h.f.input, "en"), []);
});

test("a Japanese contraction formula that voices an already complete te-form is a targeted construction risk", () => {
  const h = harness(false);
  h.f.raw.points[0].explanation += " 縮約為[動詞て形]た／だ。";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "ja").some(r => r.type === "construction_example"));
  assert.deepEqual(qualityRisks(h.f.raw, h.f.input, "en"), []);
});

test("cancellation cannot turn a received invalid paid review into a replayable pending phase", async () => {
  const h = harness(),
    controller = new AbortController();
  await assert.rejects(
    runBatchQuality({
      ...h.options,
      signal: controller.signal,
      generate: async () => {
        controller.abort();
        throw new CompletedQualityResponseError("completed empty answer");
      },
    }),
    /Invalid completed quality response/,
  );
  assert.equal(h.saved!.phase, "blocked");
  assert.equal(h.saved!.repairEligible, false);
  let calls = 0;
  await assert.rejects(
    runBatchQuality({
      ...h.options,
      saved: h.saved,
      generate: async () => {
        calls++;
        return { issues: [] };
      },
    }),
    /Quality blocked/,
  );
  assert.equal(calls, 0);
});

test("risk detection covers a causal scene title and role linking in scene context without reviewing every title", () => {
  const h = harness(false);
  assert.deepEqual(qualityRisks(h.f.raw, h.f.input, "en"), []);
  h.f.raw.title = "來電打斷了出門計畫";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "en").some(r => r.path === "/title"));
  h.f.raw.title = "電話與出門時間";
  h.f.raw.context.text = "對方說明準備出門，隨後提出等待的請求。";
  assert.ok(qualityRisks(h.f.raw, h.f.input, "en").some(r => r.path === "/context/text"));
});
