import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationRequest } from "@immersive/core";
import { sectionPrompt, teachingModeInstruction } from "./prompt";

const makeRequest = (mode: GenerationRequest["profile"]["mode"]): GenerationRequest => ({
  id: "11111111-1111-4111-8111-111111111111",
  source: { title: "A video", platform: "youtube" },
  profile: {
    targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    mode, maxNewVocabulary: 8, exerciseCount: 3,
  },
  agent: { provider: "claude", modelId: "" },
  cues: [{ id: "cue-1", startMs: 1000, endMs: 3000, originalText: "I need to decide." }],
});

test("every displayed teaching mode has a distinct, actionable generation instruction", () => {
  const modes = ["adaptive", "guided", "immersive"] as const;
  const instructions = modes.map(teachingModeInstruction);
  assert.equal(new Set(instructions).size, 3);
  assert.match(instructions[0], /learner level/i);
  assert.match(instructions[1], /step-by-step.*instruction language/i);
  assert.match(instructions[2], /target-language practice/i);
  for (const mode of modes) {
    const prompt = sectionPrompt(makeRequest(mode), makeRequest(mode).cues, 0, 1, "");
    assert.ok(prompt.includes(teachingModeInstruction(mode)));
    assert.match(prompt, /explanatory prose in: zh-TW/);
    assert.match(prompt, /Original expressions\/examples must remain in target language: en/);
  }
});
