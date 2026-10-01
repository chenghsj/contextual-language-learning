import assert from "node:assert/strict";
import test from "node:test";
import { groupLessons, mergeLessons } from "./lesson-catalog";

const local = (documentId: string, sourceKey: string, title: string, createdAt: string) => ({
  documentId,
  sourceKey,
  title,
  createdAt,
  targetLanguage: "ja",
  level: "N3",
});

test("groups repeat generations by source, not title, and joins local and Drive copies", () => {
  const lessons = mergeLessons(
    [
      local("one", "source-a", "Episode 12", "2026-09-27T10:00:00Z"),
      local("two", "source-a", "Episode 12, renamed", "2026-09-28T10:00:00Z"),
      local("three", "source-b", "Episode 12", "2026-09-26T10:00:00Z"),
    ],
    [
      {
        documentId: "one",
        sourceKey: "source-a",
        title: "Episode 12",
        createdAt: "2026-09-27T10:00:00Z",
        accountId: "account",
        url: "https://example.com/one",
      },
    ],
  );
  const groups = groupLessons(lessons, "all", "");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "Episode 12, renamed");
  assert.deepEqual(
    groups[0].lessons.map(lesson => lesson.documentId),
    ["two", "one"],
  );
  assert.ok(groups[0].lessons[1].local && groups[0].lessons[1].drive);
  assert.deepEqual(
    groupLessons(lessons, "drive", "").map(group => group.lessons.length),
    [1],
  );
  assert.deepEqual(
    groupLessons(lessons, "all", "renamed").map(group => group.key),
    ["source-a"],
  );
  assert.deepEqual(
    groupLessons(lessons, "all", "ＥＰＩＳＯＤＥ １２").map(group => group.key),
    ["source-a", "source-b"],
  );
});
