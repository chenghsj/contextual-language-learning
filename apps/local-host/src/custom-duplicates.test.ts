import assert from "node:assert/strict";
import test from "node:test";
import { CustomGenerationRequestSchema } from "@contextual/core";
import { randomUUID } from "node:crypto";
import { customDuplicateKey } from "./custom-duplicates";
const request = CustomGenerationRequestSchema.parse({
  id: randomUUID(),
  kind: "custom",
  source: { platform: "youtube", title: "Video", url: "https://youtu.be/dQw4w9WgXcQ?t=3" },
  prompt: "Explain",
  context: { title: true, subtitles: true },
  agent: { provider: "openai", modelId: "pinned", thinkingLevel: "high" },
  cues: [{ id: "cue-1", startMs: 0, endMs: 1000, originalText: "Dialogue" }],
});
test("duplicate identity canonicalizes video URLs, cue IDs and key order but distinguishes effective settings", () => {
  const key = customDuplicateKey(request);
  assert.equal(
    customDuplicateKey({
      ...request,
      id: randomUUID(),
      source: {
        ...request.source,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      },
      cues: [{ ...request.cues[0], id: "other" }],
      agent: { thinkingLevel: "high", modelId: "pinned", provider: "openai" },
    }),
    key,
  );
  for (const changed of [
    { ...request, prompt: "Translate" },
    { ...request, agent: { ...request.agent, thinkingLevel: "low" as const } },
    { ...request, cues: [{ ...request.cues[0], originalText: "Edited" }] },
    {
      ...request,
      analysisRange: {
        mode: "custom" as const,
        startMs: 0,
        endMs: 500,
        durationMs: 1000,
        durationSource: "subtitles" as const,
      },
    },
  ])
    assert.notEqual(customDuplicateKey(changed), key);
});
