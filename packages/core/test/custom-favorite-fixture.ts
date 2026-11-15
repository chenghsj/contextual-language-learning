import { randomUUID } from "node:crypto";
import { CustomDocumentSchema } from "../src/custom";

export function customFavoriteFixture() {
  const id = randomUUID();
  return CustomDocumentSchema.parse({
    schemaVersion: "custom-v1",
    kind: "custom",
    id,
    title: "自訂教材：日本語筆記",
    createdAt: "2026-10-21T00:00:00.000Z",
    markdown: "# 日本語筆記\n\n**ありがとう**：謝謝。\n\n完整的自訂教材內容。",
    request: {
      id,
      kind: "custom",
      source: { platform: "import", title: "Synthetic custom source" },
      agent: { provider: "openai", modelId: "offline-fixture" },
      prompt: "Synthetic prompt, excluded from favorites",
      context: { subtitles: true, title: true },
      cues: [
        { id: "custom-cue", startMs: null, endMs: null, originalText: "ありがとうございます。" },
      ],
    },
    execution: {
      workflowVersion: "custom-workflow-v1",
      promptVersion: "custom-prompt-v1",
      schemaVersion: "custom-v1",
      inputFingerprint: "a".repeat(64),
      provider: "openai",
      modelId: "offline-fixture",
      contextWindow: 16384,
      maxOutputTokens: 4096,
      chunkPlan: [["custom-cue"]],
      calls: [],
    },
  });
}
