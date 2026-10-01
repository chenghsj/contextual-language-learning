import type { LearningDocument } from "@immersive/core";
export const document: LearningDocument = {
  schemaVersion: 4, id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "An original video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    sceneCount: 2, contextualExampleCount: 2 },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "cue-1", startMs: 1000, endMs: 2900, originalText: "What about dinner?" },
    { id: "cue-2", startMs: 3100, endMs: 5500, originalText: "I haven't decided yet." },
    { id: "cue-3", startMs: 5600, endMs: 7500, originalText: "Let's decide tomorrow." },
  ],
  sections: [{
    id: "00000000-0000-4000-8000-000000000002",
    title: "Dinner plans", context: "Someone is asked about dinner and has not decided.",
    cueIds: ["cue-1", "cue-2", "cue-3"],
    startMs: 1000, endMs: 7500,
    translations: [
      { cueId: "cue-1", text: "晚餐怎麼辦？" },
      { cueId: "cue-2", text: "還沒決定。" },
      { cueId: "cue-3", text: "明天再決定。" },
    ],
    focusItems: [{
      expression: "I haven't decided yet.", sourceCueIds: ["cue-2"],
      meaning: "我還沒決定。",
      contextExplanation: "The question about dinner and the tomorrow reply indicate no decision has been made.",
      contextCueIds: ["cue-1", "cue-3"],
      wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Not decided so far." }],
      examples: [
        { situation: "A friend asks about a trip.", dialogue: [
          { text: "Have you decided on a trip?", translation: "決定旅行了嗎？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
        { situation: "A colleague asks about lunch.", dialogue: [
          { text: "What about lunch?", translation: "午餐呢？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
      ],
    }],
  }],
};
