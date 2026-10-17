import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateDraft, draftRevision, type CreateDraft } from "./create-draft";
import { contextualGenerationProfile } from "./contextual-profile";
const saved: CreateDraft = {
  version: 1,
  sourceKey: "youtube:abcdefghijk",
  title: "Video",
  language: "en",
  subtitleRevision: "123",
  profile: {
    targetLanguage: "en",
    instructionLanguage: "zh-TW",
    level: "B1",
    sceneCount: 4,
    contextualExampleCount: 2,
  },
  mode: "custom",
  prompt: "Retained prompt",
  context: { title: true, subtitles: true },
  range: { mode: "custom", startMs: 5000, endMs: 15000 },
  step: 1,
  completedStep: 1,
  agent: { provider: "openai", modelId: "model" },
  destination: null,
  backup: null,
};
test("drafts cannot be restored to a different video or with invalid provider/model settings", () => {
  assert.equal(parseCreateDraft(saved, "youtube:other"), undefined);
  assert.equal(
    parseCreateDraft({ ...saved, agent: { provider: "", modelId: "" } }, saved.sourceKey),
    undefined,
  );
  assert.deepEqual(parseCreateDraft(JSON.parse(JSON.stringify(saved)), saved.sourceKey), {
    ...saved,
    profile: contextualGenerationProfile(saved.profile),
  });
});
test("invalid in-progress timing is restored without losing the Prompt or content-mode state", () => {
  const parsed = parseCreateDraft(
    { ...saved, range: { mode: "custom", startMs: null, endMs: 15000 } },
    saved.sourceKey,
  );
  assert.equal(parsed?.prompt, "Retained prompt");
  assert.equal(Number.isNaN(parsed?.range.startMs), true);
});
test("subtitle revision changes detect text or timing edits and preserve stable manual source keys", () => {
  assert.notEqual(draftRevision("Original text"), draftRevision("Edited text"));
  assert.equal(draftRevision("Original text"), draftRevision("Original text"));
});
