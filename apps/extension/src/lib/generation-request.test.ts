import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildGenerationRequest, buildCreationRequest } from "./generation-request";

test("preflight and generation share a explicit V7 request", () => {
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
    "outputSchemaVersion",
    "profile",
    "source",
  ]);
  assert.equal(request.outputSchemaVersion, 7);
  assert.equal(request.profile.sceneCount, 4);
  assert.equal("lessonFormat" in request, false);
});

test("selected input is detached from subsequent subtitle and settings edits", () => {
  const input = {
    source: { platform: "import", title: "Dialogue" },
    profile: {
      targetLanguage: "en" as const,
      instructionLanguage: "zh-TW" as const,
      level: "B1",
      sceneCount: 4 as const,
      contextualExampleCount: 2,
    },
    agent: { provider: "openai", modelId: "fixed" },
    destination: { kind: "local" as const },
    backup: { enabled: false },
    cues: [
      { id: "keep-id", startMs: 1000, endMs: 2000, originalText: "Hello" },
      { id: "excluded", startMs: 2000, endMs: 3000, originalText: "Later" },
    ],
    analysisRange: {
      mode: "custom" as const,
      startMs: 1000,
      endMs: 2000,
      durationMs: 3000,
      durationSource: "subtitles" as const,
    },
  };
  const snapshot = buildGenerationRequest(input, randomUUID());
  input.cues[0].originalText = "edited";
  input.agent.modelId = "changed";
  input.analysisRange.endMs = 3000;
  assert.deepEqual(snapshot.cues, [
    { id: "keep-id", startMs: 1000, endMs: 2000, originalText: "Hello" },
  ]);
  assert.equal(snapshot.agent.modelId, "fixed");
  assert.equal(snapshot.analysisRange?.endMs, 2000);
  const custom = buildCreationRequest(input, {
    prompt: "Summarize the selected dialogue.",
    context: { subtitles: false, title: true },
  });
  assert.equal("kind" in custom && custom.kind, "custom");
  assert.deepEqual(
    custom.cues.map(cue => cue.id),
    ["keep-id", "excluded"],
  );
  assert.equal("context" in custom && custom.context.subtitles, false);
  input.cues[0].originalText = "edited again";
  assert.equal(custom.cues[0].originalText, "edited");
});
