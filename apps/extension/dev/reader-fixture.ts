import {
  validateLearningDocumentV7,
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
} from "@contextual/core";
/** Synthetic preview content, never a live model result. */
export const document = validateLearningDocumentV7({
  schemaVersion: 7,
  execution: {
    workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
    promptVersion: LEARNING_POINTS_PROMPT_VERSION,
    schemaVersion: "7",
    languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
    levelStrategyVersion: LEVEL_STRATEGY_VERSION,
    qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
    inputFingerprint: "0".repeat(64),
    provider: "anthropic",
    modelId: "offline-fixture",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    chunkPlan: [["cue-1", "cue-2", "cue-3"]],
    calls: [],
  },
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: {
    platform: "youtube",
    title: "An original video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
  profile: {
    targetLanguage: "en",
    instructionLanguage: "zh-TW",
    level: "B1",
    sceneCount: 2,
    contextualExampleCount: 2,
  },
  generation: {
    provider: "anthropic",
    modelId: "",
  },
  cues: [
    {
      id: "cue-1",
      startMs: 1000,
      endMs: 2900,
      originalText: "What about dinner?",
    },
    {
      id: "cue-2",
      startMs: 3100,
      endMs: 5500,
      originalText: "I haven't decided yet.",
    },
    {
      id: "cue-3",
      startMs: 5600,
      endMs: 7500,
      originalText: "Let's decide tomorrow.",
    },
  ],
  sections: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Dinner plans",
      context: {
        text: "Someone is asked about dinner and has not decided.",
        evidenceCueIds: ["cue-1"],
      },
      cueIds: ["cue-1", "cue-2", "cue-3"],
      startMs: 1000,
      endMs: 7500,
      translations: [
        {
          cueId: "cue-1",
          text: "晚餐怎麼辦？",
        },
        {
          cueId: "cue-2",
          text: "還沒決定。",
        },
        {
          cueId: "cue-3",
          text: "明天再決定。",
        },
      ],
      contextCueIds: [],
      utterances: [
        {
          id: "u-cue-1",
          cueIds: ["cue-1"],
          meaning: "晚餐怎麼辦？",
          contextExplanation: "",
          contextCueIds: [],
          decision: "basic_only",
          pointIds: [],
          sourceSpans: [
            {
              cueId: "cue-1",
              start: 0,
              end: 18,
            },
          ],
        },
        {
          id: "u-cue-2",
          cueIds: ["cue-2"],
          meaning: "還沒決定。",
          contextExplanation: "",
          contextCueIds: [],
          decision: "explained",
          pointIds: ["00000000-0000-4000-8000-000000000002:p0"],
          sourceSpans: [
            {
              cueId: "cue-2",
              start: 0,
              end: 22,
            },
          ],
        },
        {
          id: "u-cue-3",
          cueIds: ["cue-3"],
          meaning: "明天再決定。",
          contextExplanation: "",
          contextCueIds: [],
          decision: "basic_only",
          pointIds: [],
          sourceSpans: [
            {
              cueId: "cue-3",
              start: 0,
              end: 22,
            },
          ],
        },
      ],
    },
  ],
  points: [
    {
      id: "00000000-0000-4000-8000-000000000002:p0",
      utteranceIds: ["u-cue-2"],
      category: "usage",
      presentation: "core",
      title: "I haven't decided yet.",
      sourceCueIds: ["cue-2"],
      contextCueIds: ["cue-1", "cue-3"],
      explanation:
        "The question about dinner and the tomorrow reply indicate no decision has been made.",
      sourceSpans: [
        {
          cueId: "cue-2",
          start: 0,
          end: 22,
        },
      ],
    },
  ],
  reusableItems: [
    {
      id: "00000000-0000-4000-8000-000000000002:p0:r",
      pointIds: ["00000000-0000-4000-8000-000000000002:p0"],
      kind: "frame",
      sourceForms: [
        {
          cueIds: ["cue-2"],
          text: "I haven't decided yet.",
          sourceSpans: [
            {
              cueId: "cue-2",
              start: 0,
              end: 22,
            },
          ],
        },
      ],
      pattern: "I haven't decided yet.",
      examples: [
        {
          situation: "A friend asks about a trip.",
          dialogue: [
            {
              text: "Have you decided on a trip?",
              translation: "決定旅行了嗎？",
            },
            {
              text: "I haven't decided yet.",
              translation: "我還沒決定。",
            },
          ],
          origin: "ai",
          targetLineIndex: 1,
          targetText: "I haven't decided yet.",
        },
        {
          situation: "A colleague asks about lunch.",
          dialogue: [
            {
              text: "What about lunch?",
              translation: "午餐呢？",
            },
            {
              text: "I haven't decided yet.",
              translation: "我還沒決定。",
            },
          ],
          origin: "ai",
          targetLineIndex: 1,
          targetText: "I haven't decided yet.",
        },
      ],
    },
  ],
});
