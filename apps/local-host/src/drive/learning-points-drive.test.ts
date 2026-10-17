import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pointsFixture,
  withReadingDiagnostics,
} from "../../../../packages/core/test/learning-points-fixture";
import { learningDocumentToMarkdown, LEARNING_POINTS_PROMPT_VERSION } from "@contextual/core";
import { completedLesson } from "../storage/test-fixtures";
import {
  publishDriveDocument,
  listDriveLessons,
  getDriveDocument,
  findDriveDuplicates,
  isPlaybackOnlyDriveRevision,
  type LearningDrivePorts,
} from "./api";

test("Drive lists current lessons, rejects retired downloads and preserves calibration", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-v6-drive-"));
  try {
    const f = pointsFixture(),
      legacy = await completedLesson(root),
      files: Awaited<ReturnType<LearningDrivePorts["files"]>> = [],
      contents = new Map<string, Buffer>();
    const queries: string[] = [];
    const ports: LearningDrivePorts = {
      accounts: async () => [{ id: "account", email: "fixture@example.com" }],
      folder: async () => "folder",
      files: async (_account, q) => {
        queries.push(q);
        const key = /key='contextualDocumentKey' and value='([^']+)'/.exec(q)?.[1];
        const format = /key='contextualFormat' and value='([^']+)'/.exec(q)?.[1];
        return files.filter(
          file =>
            (!key || file.appProperties?.contextualDocumentKey === key) &&
            (!format || file.appProperties?.contextualFormat === format),
        );
      },
      upload: async (_a, _folder, name, _mime, bytes, properties) => {
        const file = { id: randomUUID(), name, appProperties: properties };
        files.push(file);
        contents.set(file.id, bytes);
        return file;
      },
      fetch: async (_a, url) =>
        new Response(new Uint8Array(contents.get(url.match(/\/files\/([^?]+)/)![1])!)),
    };
    f.document = withReadingDiagnostics(f.document);
    await publishDriveDocument(
      "account",
      legacy.document,
      learningDocumentToMarkdown(legacy.document),
      undefined,
      ports,
    );
    await publishDriveDocument(
      "account",
      f.document,
      learningDocumentToMarkdown(f.document),
      undefined,
      ports,
    );
    assert.equal(files.length, 4);
    assert.deepEqual(
      new Set(files.map(f => f.appProperties?.contextualSchemaVersion)),
      new Set(["7"]),
    );
    const lessons = await listDriveLessons("account", ports);
    assert.equal(lessons.length, 2);
    assert.equal(lessons.find(l => l.schemaVersion === 7)?.pointCount, 3);
    assert.equal(lessons.find(l => l.schemaVersion === 7)?.reusableItemCount, 2);
    assert.deepEqual(
      await getDriveDocument("account", f.document.id, ports),
      JSON.parse(JSON.stringify(f.document)),
    );
    assert.equal((await getDriveDocument("account", legacy.document.id, ports)).schemaVersion, 7);
    const duplicates = await findDriveDuplicates(
      { ...f.request, destination: { kind: "drive", accountId: "account" } },
      ports,
    );
    assert.equal(
      duplicates.find(d => d.documentId === f.document.id)?.exactSettings,
      true,
      "older workflow remains readable but is not identical to the new generation strategy",
    );
    assert.equal(duplicates.find(d => d.documentId === legacy.document.id)?.exactSettings, true);
    const calibrated = {
      ...f.document,
      playbackOverrides: { "cue-2": { startMs: 2100, endMs: 3900 } },
    };
    assert.equal(isPlaybackOnlyDriveRevision(f.document, calibrated), true);
    assert.ok(queries.some(q => q.includes("contextualPromptVersion") && q.includes("value='7'")));
    const file = files.find(
      file =>
        file.appProperties?.contextualDocumentId === f.document.id &&
        file.appProperties.contextualFormat === "json",
    )!;
    file.appProperties!.contextualPromptVersion = "learning-points-prompts-12";
    await assert.rejects(getDriveDocument("account", f.document.id, ports), /停止支援/);
    assert.ok(
      !(await listDriveLessons("account", ports)).some(l => l.documentId === f.document.id),
    );
    file.appProperties!.contextualPromptVersion = LEARNING_POINTS_PROMPT_VERSION;
    file.appProperties!.contextualSchemaVersion = "5";
    await assert.rejects(getDriveDocument("account", f.document.id, ports), /停止支援/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
