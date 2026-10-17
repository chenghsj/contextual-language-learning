import assert from "node:assert/strict";
import test from "node:test";
import { mergeLibrary, groupLibrary } from "./library-catalog";

test("library joins both content types by source, deduplicates backups and keeps unrelated titles separate", () => {
  const common = { createdAt: "2026-10-01T00:00:00Z", title: "Same title" };
  const lesson = {
    ...common,
    documentId: "lesson",
    sourceKey: "video-a",
    targetLanguage: "ja",
    level: "N3",
  };
  const custom = {
    ...common,
    kind: "custom" as const,
    documentId: "notes",
    sourceTitle: "Original video",
    sourceKey: "video-a",
    createdAt: "2026-10-02T00:00:00Z",
  };
  const remote = { ...custom, accountId: "drive", url: "https://example.com/notes" };
  const catalog = mergeLibrary(
    [lesson, { ...lesson, documentId: "other", sourceKey: "video-b" }],
    [{ ...lesson, accountId: "drive", url: "https://example.com/lesson" }],
    [custom],
    [remote, { ...remote, documentId: "legacy", sourceKey: undefined }],
  );
  const groups = groupLibrary(catalog);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].title, "Original video");
  assert.deepEqual(
    groups[0].entries.map(entry => entry.documentId),
    ["notes", "lesson"],
  );
  assert.ok(groups[0].entries.every(entry => entry.local && entry.drive));
  assert.equal(groups.find(group => group.key === "document:custom:legacy")?.entries.length, 1);
  assert.deepEqual(
    groupLibrary(catalog, { language: "ja" }).map(group => group.entries.length),
    [1, 1],
  );
  assert.deepEqual(
    groupLibrary(catalog, { contentType: "custom" }).flatMap(group =>
      group.entries.map(entry => entry.documentId),
    ),
    ["notes", "legacy"],
  );
  assert.equal(groupLibrary(catalog, { language: "ja", contentType: "custom" }).length, 0);
  assert.deepEqual(
    groupLibrary(catalog, { search: "ＯＲＩＧＩＮＡＬ ＶＩＤＥＯ" }).map(
      group => group.entries.length,
    ),
    [2, 1],
  );
});
