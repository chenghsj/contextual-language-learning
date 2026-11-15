import { writeFileSync } from "node:fs";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture.ts";
import { readLearningDocument } from "../../../packages/core/src/jobs.ts";
import { readerPresentation } from "../../../packages/core/src/reader-model.ts";
import { createHash } from "node:crypto";
import { customFavoriteFixture } from "../../../packages/core/test/custom-favorite-fixture.ts";
import {
  captureFavorite,
  captureCustomFavorite,
  FavoriteRecordSchema,
} from "../../../packages/core/src/favorites.ts";
import {
  captureFavoriteCatalog,
  favoriteIdentityBytes,
} from "../../../packages/core/src/favorite-catalog.ts";

const base = pointsFixture().document;
base.id = "5de9028e-e299-4d82-b2fd-6af7388ad6cd";
base.sections[0].id = "dc67d173-0098-4b0b-81e0-71784afdd993";
type Change = (value: typeof base) => void;
const cases: Array<{ name: string; input: unknown; accepted: boolean; error?: string }> = [];
function add(name: string, change?: Change) {
  const value = structuredClone(base);
  change?.(value);
  try {
    readLearningDocument(value);
    cases.push({ name, input: value, accepted: true });
  } catch (error) {
    cases.push({ name, input: value, accepted: false, error: String(error) });
  }
}
add("current-valid");
for (const [name, url] of Object.entries({
  youtube: "https://www.youtube.com/watch?v=abc123&t=12",
  unicode: "https://例子.測試/教材?q=你好#段落",
  ipv6: "https://[::1]:8443/video",
  opaque: "urn:example:lesson",
  whitespace: "  https://example.com/video\n",
  normalized: "https:example.com/video",
  relative: "/watch?v=abc123",
  missingHost: "https://",
  invalidPort: "https://example.com:99999/video",
  invalidIPv6: "https://[invalid]/video",
  invalidHost: "https://bad host/video",
  empty: "",
})) {
  add(`source-url-${name}`, d => {
    d.source.url = url;
  });
}
add("unknown-prompt", d => {
  d.execution!.promptVersion = "unknown-prompt";
});
add("wrong-workflow", d => {
  d.execution!.workflowVersion = "unknown-workflow";
});
add("wrong-language-strategy", d => {
  d.execution!.languageStrategyVersion = "unknown";
});
add("missing-source-cue", d => {
  d.cues.shift();
});
add("duplicate-source-cue", d => {
  d.cues.push(d.cues[0]);
});
add("missing-point", d => {
  d.points.shift();
});
add("duplicate-scene", d => {
  d.sections.push(d.sections[0]);
});
add("inverted-span", d => {
  d.sections[0].utterances[0].sourceSpans[0].start = 99999;
});
add("missing-utterance", d => {
  d.sections[0].utterances.shift();
});
add("wrong-translation-cue", d => {
  d.sections[0].translations[0].cueId = "unknown";
});
add("duplicate-translation", d => {
  d.sections[0].translations.push(d.sections[0].translations[0]);
});
add("wrong-point-utterance", d => {
  d.points[0].utteranceIds = ["missing"];
});
add("inverted-cue-time", d => {
  d.cues[0].startMs = 10000;
  d.cues[0].endMs = 1;
});
add("wrong-reusable-point", d => {
  d.reusableItems[0].pointIds = ["missing"];
});
add("empty-example-dialogue", d => {
  d.reusableItems[0].examples[0].dialogue = [];
});
add("unknown-field", d => {
  Object.assign(d, { executable: "not-code" });
});
for (const [prompt, language, quality] of [
  ["12", "4", "learning-quality-1"],
  ["13", "4", "learning-quality-1"],
  ["14", "4", "program-validation-1"],
  ["15", "4", "program-validation-2"],
  ["16", "4", "program-validation-2"],
  ["17", "4", "program-validation-2"],
  ["18", "5", "program-validation-2"],
  ["19", "5", "program-validation-3"],
])
  add("historical-prompts-" + prompt, d => {
    d.execution!.promptVersion = "learning-points-prompts-" + prompt;
    d.execution!.languageStrategyVersion = "learning-language-strategies-" + language;
    d.execution!.qualityStrategyVersion = quality;
  });
const document = readLearningDocument(base);
for (const [index, text] of [
  "e\u0301X",
  "A👩‍👩‍👧‍👦B",
  "🇹🇼ไทย",
  "한\u0301글",
  "你好世界",
  "𠀀日本語",
].entries()) {
  for (const cut of [undefined, 1, 2]) {
    if (cut !== undefined && cut >= text.length) continue;
    const value = structuredClone(base);
    value.cues = [{ id: "unicode", originalText: text, startMs: null, endMs: null }];
    const ranges =
      cut === undefined
        ? [[0, text.length]]
        : [
            [0, cut],
            [cut, text.length],
          ];
    value.sections = [
      {
        id: base.sections[0].id,
        cueIds: ["unicode"],
        contextCueIds: [],
        startMs: null,
        endMs: null,
        title: "Unicode source",
        context: { text: "Synthetic Unicode fixture.", evidenceCueIds: ["unicode"] },
        translations: [{ cueId: "unicode", text: "Unicode 原文測試" }],
        utterances: ranges.map(([start, end], n) => ({
          id: "unicode-unit-" + n,
          cueIds: ["unicode"],
          sourceSpans: [{ cueId: "unicode", start, end }],
          meaning: "Unicode 單位",
          contextExplanation: "",
          contextCueIds: [],
          decision: "basic_only" as const,
          pointIds: [],
        })),
      },
    ];
    value.points = [];
    value.reusableItems = [];
    value.execution!.chunkPlan = [["unicode"]];
    const name = `unicode-${index}-cut-${cut ?? "whole"}`;
    try {
      readLearningDocument(value);
      cases.push({ name, input: value, accepted: true });
    } catch (error) {
      cases.push({ name, input: value, accepted: false, error: String(error) });
    }
  }
}
const corpus = {
  generatedFrom: "current-worktree",
  cases,
  presentation: document.sections.map(scene => readerPresentation(document, scene)),
  untranslated: document.sections.map(scene => readerPresentation(document, scene, false)),
};
writeFileSync(
  new URL("../ContextualLearningTests/Fixtures/contract-corpus.json", import.meta.url),
  JSON.stringify(corpus, null, 2) + "\n",
);
console.log(`Generated ${cases.length} contract compatibility cases.`);

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const collectionID = hash("favorites-v1:ios-fixture-account");
const writerA = "59e5f95a-3001-440e-a63f-29bcfc47a1bb";
const writerB = "65c718c1-c3e0-44ed-b206-537eebc723b3";
const capturedAt = "2026-10-26T00:00:00.000Z";
const origin = { documentId: base.id, sceneId: base.sections[0].id };
const common = {
  schemaVersion: 1 as const,
  collectionId: collectionID,
  key: hash(favoriteIdentityBytes(origin)),
  origin,
  createdAt: capturedAt,
  requestHash: "a".repeat(64),
};
const favoriteDocument = structuredClone(base);
favoriteDocument.source.url = "https://www.youtube.com/watch?v=abc123";
const snapshot = captureFavorite(favoriteDocument, origin.sceneId, capturedAt, "revision");
const operations = [
  FavoriteRecordSchema.parse({
    ...common,
    operationId: "d8ce3414-b268-4b62-a6f8-1628b0c5c770",
    writerId: writerA,
    version: { [writerA]: 1 },
    action: "add",
    snapshot,
  }),
  FavoriteRecordSchema.parse({
    ...common,
    operationId: "d8ce3414-b268-4b62-a6f8-1628b0c5c771",
    writerId: writerB,
    version: { [writerB]: 1 },
    action: "remove",
  }),
  FavoriteRecordSchema.parse({
    ...common,
    operationId: "d8ce3414-b268-4b62-a6f8-1628b0c5c772",
    writerId: writerA,
    version: { [writerA]: 2, [writerB]: 1 },
    action: "add",
    snapshot,
  }),
];
function pack(record: (typeof operations)[number], index: number) {
  const text = JSON.stringify(record);
  const source = {
    id: "source-" + index,
    operationId: record.operationId,
    hash: hash(text),
    schema: "1",
  };
  const catalog = JSON.stringify(captureFavoriteCatalog(record, source));
  return {
    source,
    catalog: {
      file: {
        id: "catalog-" + index,
        operationId: record.operationId,
        hash: hash(catalog),
        schema: "1",
      },
      text: catalog,
    },
    operation: text,
  };
}
const records = operations.map(pack);
const custom = customFavoriteFixture();
custom.request.source.url = "https://example.com/custom-lesson";
custom.id = "72bfb90f-d967-4d81-b2ae-21008758dfb9";
custom.request.id = custom.id;
const customOrigin = { documentId: custom.id, sceneId: custom.id };
const customRecord = FavoriteRecordSchema.parse({
  ...common,
  origin: customOrigin,
  key: hash(favoriteIdentityBytes(customOrigin)),
  operationId: "d8ce3414-b268-4b62-a6f8-1628b0c5c773",
  writerId: writerA,
  version: { [writerA]: 1 },
  action: "add",
  snapshot: captureCustomFavorite(custom, capturedAt, "custom-revision"),
});
const customPacked = pack(customRecord, 3);
writeFileSync(
  new URL("../ContextualLearningTests/Fixtures/favorite-corpus.json", import.meta.url),
  JSON.stringify({ collectionID, records, custom: customPacked }, null, 2) + "\n",
);
writeFileSync(
  new URL("../ContextualLearningTests/Fixtures/custom-document.json", import.meta.url),
  JSON.stringify(custom, null, 2) + "\n",
);
console.log("Generated standard/custom favorite protocol fixtures.");
