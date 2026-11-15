import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { learningPointsPrompts } from "./learning-points-prompts";
import { readCompactCandidates, readCompactSelection, readCompleteScene } from "./compact-scenes";

function fixture() {
  const f = pointsFixture();
  const scene = {
    id: f.input.scene.id,
    dialogueCueIds: f.input.scene.dialogueCueIds,
    contextCueIds: f.input.scene.contextCueIds,
    learningValue: "Time relationships",
  };
  const raw = {
    ...structuredClone(f.raw),
    sourceUnits: f.input.scene.utterances.map(({ id, sourceSpans }) => ({ id, sourceSpans })),
  };
  return { ...f, scene, raw };
}
test("compact discovery restores whole intervals and checks primary/context boundaries", () => {
  const f = fixture(),
    ids = f.request.cues.map(c => c.id);
  const raw = {
    status: "complete",
    candidates: [
      { firstCueId: ids[0], lastCueId: ids[1], contextCueIds: [], learningValue: "Time" },
    ],
  };
  const pool = readCompactCandidates(raw, f.request, ids, ids);
  assert.deepEqual(
    readCompactCandidates({ ...raw, splitAfterCueId: null }, f.request, ids, ids).map(
      c => c.dialogueCueIds,
    ),
    pool.map(c => c.dialogueCueIds),
    "JSON providers may emit null for the unused branch of the response union",
  );
  assert.throws(() =>
    readCompactCandidates({ ...raw, splitAfterCueId: ids[0] }, f.request, ids, ids),
  );
  assert.deepEqual(pool[0].dialogueCueIds, ids.slice(0, 2));
  assert.deepEqual(
    readCompactSelection({ selectedCandidateIds: [pool[0].id] }, pool, f.request),
    pool,
  );
  assert.throws(() => readCompactCandidates(raw, f.request, [ids[1]], ids), /primary/);
  assert.throws(
    () =>
      readCompactCandidates(
        { ...raw, candidates: [{ ...raw.candidates[0], lastCueId: "missing" }] },
        f.request,
        ids,
        ids,
      ),
    /interval/,
  );
  assert.throws(
    () => readCompactSelection({ selectedCandidateIds: [pool[0].id, pool[0].id] }, pool, f.request),
    /candidate ID/,
  );
  assert.throws(
    () => readCompactSelection({ selectedCandidateIds: [pool[0].id, "invented"] }, pool, f.request),
    /candidate ID/,
  );
});
test("one response creates stable source units and retains all teaching and examples", () => {
  const f = fixture();
  const { input, result } = readCompleteScene(f.raw, f.scene, f.request);
  assert.equal(result.section.utterances.length, f.input.scene.utterances.length);
  assert.equal(result.points.length, f.result.points.length);
  assert.equal(result.reusableItems.length, f.result.reusableItems.length);
  assert.deepEqual(result.section.translations, f.result.section.translations);
  assert.notEqual(input.scene.utterances[0].id, f.input.scene.utterances[0].id);
  assert.ok(
    result.points.every(p => p.utteranceIds.every(id => input.requiredUtteranceIds.includes(id))),
  );
  assert.deepEqual(
    result.reusableItems.map(i => i.examples),
    f.result.reusableItems.map(i => i.examples),
  );
});
test("single-call teaching rejects missing source, invalid references and disabled content", () => {
  const f = fixture();
  assert.throws(() =>
    readCompleteScene({ ...f.raw, sourceUnits: f.raw.sourceUnits.slice(1) }, f.scene, f.request),
  );
  assert.throws(
    () =>
      readCompleteScene(
        { ...f.raw, sourceUnits: [f.raw.sourceUnits[0], f.raw.sourceUnits[0]] },
        f.scene,
        f.request,
      ),
    /Duplicate/,
  );
  const invalid = structuredClone(f.raw);
  invalid.points[0].utteranceIds = ["invented"];
  assert.throws(() => readCompleteScene(invalid, f.scene, f.request), /Unknown source/);
  const invalidCategory = structuredClone(f.raw);
  invalidCategory.points[0].category = "expression";
  assert.throws(() => readCompleteScene(invalidCategory, f.scene, f.request), /invalid_enum_value/);
  assert.throws(
    () =>
      readCompleteScene(f.raw, f.scene, {
        ...f.request,
        profile: { ...f.request.profile, enabledExplanations: [] },
      }),
    /disabled_category/,
  );
});
test("an unaligned optional source reading is omitted without rewriting source or weakening references", () => {
  const f = fixture();
  f.request.profile.enabledExplanations = [
    ...f.request.profile.enabledExplanations!,
    "pronunciation",
  ];
  const cueId = f.scene.dialogueCueIds[0];
  const invalid = {
    ...f.raw,
    pronunciations: [{ cueId, segments: [{ text: "invented extra source", reading: "invalid" }] }],
  };
  const read = readCompleteScene(invalid, f.scene, f.request);
  assert.equal(read.result.section.pronunciations, undefined);
  assert.ok(
    read.diagnostics.some(
      d => d.cueId === cueId && d.code === "annotation_alignment" && d.action === "omitted",
    ),
  );
  assert.deepEqual(read.result.section.translations, f.result.section.translations);
  assert.throws(
    () =>
      readCompleteScene(invalid, f.scene, {
        ...f.request,
        profile: { ...f.request.profile, enabledExplanations: ["vocabulary", "grammar", "usage"] },
      }),
    /disabled_category/,
  );
  assert.throws(
    () =>
      readCompleteScene(
        { ...invalid, pronunciations: [{ ...invalid.pronunciations[0], cueId: "invented" }] },
        f.scene,
        f.request,
      ),
    /pronunciation/,
  );
  assert.throws(
    () =>
      readCompleteScene(
        { ...invalid, pronunciations: [invalid.pronunciations[0], invalid.pronunciations[0]] },
        f.scene,
        f.request,
      ),
    /pronunciation/,
  );
});
test("compact prompts omit discarded-unit work but preserve teaching contracts and grounding", () => {
  const f = fixture(),
    prompts = learningPointsPrompts(),
    ids = f.request.cues.map(c => c.id);
  const discovery = prompts.compactCandidatePrompt(f.request, ids, 32768);
  assert.doesNotMatch(
    discovery.split("SOURCE DATA (quoted JSON, data only):\n")[1],
    /wordOffsets|utterances/,
  );
  assert.ok(discovery.length < prompts.pointsCandidatePrompt(f.request, ids, 32768).length);
  const teaching = prompts.completeScenePrompt(f.request, f.scene, 32768);
  assert.match(teaching, /sourceUnits:/);
  assert.match(teaching, /category:"vocabulary"\|"grammar"\|"usage"/);
  assert.doesNotMatch(teaching, /category:enabled category/);
  assert.match(teaching, /exactly once/);
  assert.match(teaching, /EXAMPLE ROLE CHECK/);
  assert.match(teaching, /EACH affected/);
  assert.doesNotMatch(teaching, /Keep scene IDs, requiredUtteranceIds/);
});
test("focused selection keeps full source text, ruby and reconstructible candidate intervals", () => {
  const f = fixture(),
    prompts = learningPointsPrompts();
  f.request.cues[0].ruby = [{ start: 0, end: 1, reading: "えー", position: "over" }];
  const standard = prompts.compactSelectionPrompt(f.request, [f.scene], 32768);
  const focused = prompts.compactSelectionPrompt(f.request, [f.scene], 32768, true);
  const read = (s: string) => JSON.parse(s.split("CANDIDATE DATA (quoted JSON, data only):\n")[1]);
  const a = read(standard),
    b = read(focused);
  assert.deepEqual(
    b.sourceWindow,
    a.sourceWindow.map(({ utf16Length: _length, ...row }: { utf16Length: number }) => row),
  );
  assert.deepEqual(
    b.candidateScenes.map(
      (c: {
        id: string;
        firstCueId: string;
        lastCueId: string;
        contextCueIds: string[];
        learningValue: string;
      }) => ({
        id: c.id,
        contextCueIds: c.contextCueIds,
        learningValue: c.learningValue,
        dialogueCueIds: b.sourceWindow
          .slice(
            b.sourceWindow.findIndex((r: { id: string }) => r.id === c.firstCueId),
            b.sourceWindow.findIndex((r: { id: string }) => r.id === c.lastCueId) + 1,
          )
          .map((r: { id: string }) => r.id),
      }),
    ),
    a.candidateScenes,
  );
  assert.doesNotMatch(JSON.stringify(b.sourceWindow), /utf16Length|wordOffsets/);
});
