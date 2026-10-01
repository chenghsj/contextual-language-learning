import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DocumentChunkAssembler } from "./document-chunks";
import type { LearningDocument } from "@immersive/core";

test("reassembles UTF-8 characters split between native messages", () => {
  const id = randomUUID();
  const doc: LearningDocument = {
    id, schemaVersion: 4, createdAt: new Date().toISOString(),
    source: { platform: "import", title: "日本語 🎬" },
    profile: { targetLanguage: "ja", instructionLanguage: "zh-TW", level: "N4", sceneCount: 4, contextualExampleCount: 1 },
    generation: { provider: "claude", modelId: "" },
    cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "こんにちは" }],
    sections: [{
      id: randomUUID(), title: "場景", context: "日常對話",
      cueIds: ["cue-1"], startMs: null, endMs: null,
      translations: [{ cueId: "cue-1", text: "你好" }],
      focusItems: [{ expression: "こんにちは", sourceCueIds: ["cue-1"], meaning: "你好",
        contextExplanation: "A greeting.", contextCueIds: ["cue-1"], wordNotes: [],
        examples: [{ situation: "Meeting", dialogue: [
          { text: "こんにちは", translation: "你好" }, { text: "こんにちは", translation: "你好" },
        ] }],
      }],
    }],
  };
  const buffer = Buffer.from(JSON.stringify(doc), "utf8");
  const mid = Math.floor(buffer.length / 2);
  const assembler = new DocumentChunkAssembler();
  const chunks = [buffer.subarray(0, mid), buffer.subarray(mid)];
  assert.equal(assembler.push({ id: randomUUID(), type: "documentChunk", documentId: id, index: 0, total: 2, dataBase64: chunks[0].toString("base64") }), null);
  assert.deepEqual(assembler.push({ id: randomUUID(), type: "documentChunk", documentId: id, index: 1, total: 2, dataBase64: chunks[1].toString("base64") }), doc);
});
