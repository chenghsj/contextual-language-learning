import assert from "node:assert/strict";
import test from "node:test";
import { EXPLANATION_TYPES, explanationPreferences } from "./explanations";
import { alignedChunks } from "./sentence-analysis";
import { findExpressionOccurrences } from "./expression-occurrences";
import { learningDocumentToMarkdown } from "./export";
import { withSentenceTiming } from "./playback-timing";

test("old profiles are balanced/all-enabled and emphasis never survives disabling", () => {
  assert.deepEqual(explanationPreferences({}), { enabled: [...EXPLANATION_TYPES], emphasized: [] });
  assert.deepEqual(
    explanationPreferences({
      enabledExplanations: ["grammar"],
      emphasizedExplanations: ["grammar", "chunks"],
    }),
    { enabled: ["grammar"], emphasized: ["grammar"] },
  );
  assert.deepEqual(explanationPreferences({ enabledExplanations: [] }), {
    enabled: [],
    emphasized: [],
  });
});

test("literal occurrences preserve repeated positions, original quotes and Unicode offsets", () => {
  const cues = [
    { id: "a", originalText: "😀 FIGURE   OUT; figure out!", startMs: 0, endMs: 3000 },
    { id: "b", originalText: "figured it out; disfigure out", startMs: 10000, endMs: 11000 },
  ];
  const matches = findExpressionOccurrences(cues, "figure out", "en");
  assert.equal(matches.length, 2);
  assert.equal(matches[0].spans[0].start, 3);
  assert.equal(
    cues[0].originalText.slice(matches[0].spans[0].start, matches[0].spans[0].end),
    "FIGURE   OUT",
  );
  assert.equal(
    findExpressionOccurrences([{ ...cues[0], originalText: "I’m ready" }], "I'm ready", "en")
      .length,
    1,
  );
});

test("Chinese phrases match within unspaced words and across adjacent cues with exact offsets", () => {
  for (const [language, first, second, phrase] of [
    ["zh-TW", "😀我還沒", "決定要不要去。", "還沒決定"],
    ["zh-CN", "😀我还没", "决定要不要去。", "还没决定"],
  ] as const) {
    const cues = [
      { id: "a", originalText: first, startMs: 0, endMs: 1000 },
      { id: "b", originalText: second, startMs: 1100, endMs: 2000 },
    ];
    const match = findExpressionOccurrences(cues, phrase, language)[0];
    assert.deepEqual(match.cueIds, ["a", "b"]);
    assert.equal(match.spans[0].start, 3);
    assert.equal(
      match.spans
        .map(span =>
          cues.find(cue => cue.id === span.cueId)!.originalText.slice(span.start, span.end),
        )
        .join(""),
      phrase,
    );
    assert.equal(
      findExpressionOccurrences([{ ...cues[0], originalText: first + second }], phrase, language)
        .length,
      1,
    );
    assert.equal(
      findExpressionOccurrences(
        [cues[0], { ...cues[1], startMs: 5000, endMs: 6000 }],
        phrase,
        language,
      ).length,
      0,
    );
  }
});

test("cross-cue matching respects gaps, boundaries, partial input and untimed subtitles", () => {
  const cues = [
    { id: "a", originalText: "about ", startMs: 0, endMs: 1000 },
    { id: "b", originalText: " to leave", startMs: 1100, endMs: 2000 },
  ];
  const match = findExpressionOccurrences(cues, "about to", "en")[0];
  assert.deepEqual(match.cueIds, ["a", "b"]);
  assert.deepEqual([match.startMs, match.endMs], [0, 2000]);
  assert.equal(
    findExpressionOccurrences(
      [cues[0], { ...cues[1], startMs: 5000, endMs: 6000 }],
      "about to",
      "en",
    ).length,
    0,
  );
  assert.equal(findExpressionOccurrences(cues.slice(1), "about to", "en").length, 0);
  assert.equal(
    findExpressionOccurrences(
      cues.map(cue => ({ ...cue, startMs: null, endMs: null })),
      "about to",
      "en",
    )[0].startMs,
    null,
  );
});
