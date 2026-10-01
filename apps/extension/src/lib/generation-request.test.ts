import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildGenerationRequest } from "./generation-request";

test("preflight and generation share a lean V5 request", () => {
  const request = buildGenerationRequest(
    {
      source: { platform: "import", title: "Dialogue" },
      profile: {
        targetLanguage: "en",
        instructionLanguage: "zh-TW",
        level: "B1",
        sceneCount: 4,
        contextualExampleCount: 2,
      },
      agent: { provider: "openai", modelId: "" },
      destination: { kind: "local" },
      backup: { enabled: false },
      cues: [{ id: "cue-1", startMs: 0, endMs: 1000, originalText: "Hello" }],
    },
    randomUUID(),
  );
  assert.deepEqual(Object.keys(request).sort(), [
    "agent",
    "backup",
    "cues",
    "destination",
    "id",
    "profile",
    "source",
  ]);
  assert.equal(request.profile.sceneCount, 4);
  assert.equal("lessonFormat" in request, false);
});
