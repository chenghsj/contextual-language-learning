import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema } from "@contextual/core";
import { findLocalDuplicates, sourceKey, transcriptKey, videoFolderName } from "./duplicates";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture";
import { localStoragePorts } from "./storage/file";

test("subtitle reading changes affect transcript identity without changing video identity", () => {
  const source = {
    platform: "netflix",
    title: "Video",
    url: "https://www.netflix.com/watch/81234567",
  };
  const plain = [{ id: "cue-1", originalText: "面白え～", startMs: 1000, endMs: 2000 }];
  const annotated = [
    { ...plain[0], ruby: [{ start: 0, end: 2, reading: "おもしれ", position: "under" as const }] },
  ];
  assert.notEqual(transcriptKey(plain), transcriptKey(annotated));
  assert.equal(sourceKey(source, plain), sourceKey(source, annotated));
  assert.equal(transcriptKey(plain), transcriptKey([{ ...plain[0], ruby: undefined }]));
});

test("existing video is found despite URL tracking parameters, and model/level variants are identified", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-duplicate-"));
  try {
    const storage = localStoragePorts(root);
    const { request, document: doc } = pointsFixture();
    request.source = {
      platform: "youtube",
      title: "Lesson",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    };
    request.destination = { kind: "local" };
    doc.source = { ...request.source, url: "https://youtu.be/dQw4w9WgXcQ" };
    await storage.documents.save(doc, "# Lesson");
    assert.equal(sourceKey(request.source, request.cues), sourceKey(doc.source, doc.cues));
    assert.equal(
      videoFolderName(request.source, request.cues).split("--").at(-1),
      videoFolderName({ ...request.source, title: "Renamed / Video" }, request.cues)
        .split("--")
        .at(-1),
    );
    assert.ok(
      !videoFolderName({ ...request.source, title: "Renamed / Video" }, request.cues).includes("/"),
    );
    assert.ok(
      Buffer.byteLength(
        videoFolderName({ ...request.source, title: "🎬".repeat(200) }, request.cues),
        "utf8",
      ) < 255,
    );
    const matches = await findLocalDuplicates(request, storage);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].local, true);
    assert.equal(matches[0].exactSettings, true);
    const different = await findLocalDuplicates(
      {
        ...request,
        profile: { ...request.profile, level: "B2" },
      },
      storage,
    );
    assert.equal(different[0].exactSettings, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
