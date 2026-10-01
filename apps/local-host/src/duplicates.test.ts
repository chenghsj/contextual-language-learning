import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, LearningDocumentSchema } from "@immersive/core";
import { findLocalDuplicates, sourceKey, videoFolderName } from "./duplicates";
import { localStoragePorts } from "./storage/file";

test("existing video is found despite URL tracking parameters, and model/level variants are identified", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-duplicate-"));
  try {
    const storage = localStoragePorts(root);
    const request = GenerationRequestSchema.parse({
      id: randomUUID(),
      source: {
        platform: "youtube",
        title: "Lesson",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
      },
      profile: {
        targetLanguage: "en",
        instructionLanguage: "zh-TW",
        level: "B1",
        sceneCount: 2,
        contextualExampleCount: 1,
      },
      agent: { provider: "openai", modelId: "" },
      destination: { kind: "local" },
      cues: [{ id: "cue-1", startMs: 1000, endMs: 2000, originalText: "Try again." }],
    });
    const doc = LearningDocumentSchema.parse({
      id: randomUUID(),
      schemaVersion: 5,
      createdAt: new Date().toISOString(),
      source: { platform: "youtube", title: "Lesson", url: "https://youtu.be/dQw4w9WgXcQ" },
      profile: request.profile,
      generation: request.agent,
      cues: request.cues,
      sections: [
        {
          id: randomUUID(),
          title: "A",
          context: "B",
          cueIds: ["cue-1"],
          startMs: 1000,
          endMs: 2000,
          translations: [{ cueId: "cue-1", text: "再試一次。" }],
          focusItems: [
            {
              expression: "Try again",
              sourceCueIds: ["cue-1"],
              meaning: "再試一次",
              contextExplanation: "A retry prompt",
              contextCueIds: ["cue-1"],
              wordNotes: [],
              examples: [
                {
                  situation: "Practice",
                  dialogue: [
                    { text: "Try again", translation: "再試一次" },
                    { text: "Okay", translation: "好" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
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
