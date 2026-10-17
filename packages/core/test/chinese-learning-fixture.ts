import {
  GenerationRequestSchema,
  validateTeachingBatch,
  validateLearningDocumentV7,
  type TeachingInput,
  type PronunciationSegment,
} from "../src/index";

/** Synthetic Mandarin dialogue; usable in offline pipeline and browser acceptance checks. */
export function chineseLearningFixture(language: "zh-TW" | "zh-CN") {
  const traditional = language === "zh-TW";
  const question = traditional ? "你要買幾杯茶？" : "你要买几杯茶？";
  const answer = traditional ? "我要買兩杯茶。" : "我要买两杯茶。";
  const quantity = traditional ? "兩杯茶" : "两杯茶";
  const reading = (text: string, zhuyin: string, pinyin: string): PronunciationSegment => ({
    text,
    reading: traditional ? zhuyin : pinyin,
  });
  const request = GenerationRequestSchema.parse({
    id: "00000000-0000-4000-8000-000000000081",
    outputSchemaVersion: 7,
    source: { platform: "import", title: "Buying tea" },
    agent: { provider: "openai", modelId: "offline" },
    profile: {
      targetLanguage: language,
      instructionLanguage: "en",
      level: "A2",
      sceneCount: 2,
      contextualExampleCount: 1,
      enabledExplanations: ["grammar", "pronunciation"],
    },
    cues: [
      { id: "q", originalText: question, startMs: 0, endMs: 1800 },
      { id: "a", originalText: answer, startMs: 2000, endMs: 3800 },
    ],
  });
  const input: TeachingInput = {
    scene: {
      id: "00000000-0000-4000-8000-000000000082",
      dialogueCueIds: ["q", "a"],
      contextCueIds: [],
      utterances: [
        { id: "u1", cueIds: ["q"], sourceSpans: [{ cueId: "q", start: 0, end: question.length }] },
        { id: "u2", cueIds: ["a"], sourceSpans: [{ cueId: "a", start: 0, end: answer.length }] },
      ],
      learningValue: "Understanding quantities of drinks",
      opportunities: [],
    },
    requiredUtteranceIds: ["u1", "u2"],
    sourceWindow: request.cues,
    existingPoints: [],
    existingReusableItems: [],
  };
  const raw = {
    risks: [],
    status: "complete",
    sceneId: input.scene.id,
    title: "Buying two cups of tea",
    context: {
      text: "One person asks how many cups of tea to buy; the other answers two.",
      evidenceCueIds: ["q", "a"],
    },
    translations: [
      { cueId: "q", text: "How many cups of tea do you want to buy?" },
      { cueId: "a", text: "I want to buy two cups of tea." },
    ],
    utterances: [
      {
        id: "u1",
        meaning: "A question about the number of cups.",
        contextExplanation: "The following line gives the quantity.",
        contextCueIds: ["a"],
        decision: "basic_only",
        pointIds: [],
      },
      {
        id: "u2",
        meaning: "The speaker wants two cups of tea.",
        contextExplanation: "This answers the preceding quantity question.",
        contextCueIds: ["q"],
        decision: "explained",
        pointIds: ["p1"],
      },
    ],
    points: [
      {
        id: "p1",
        utteranceIds: ["u2"],
        category: "grammar",
        presentation: "core",
        title: "Counting cups with 杯",
        sourceCueIds: ["a"],
        contextCueIds: ["q"],
        explanation:
          "杯 counts cups of a drink. The number comes before 杯 and the drink comes after it; here the quantity is two.",
        sourceSpans: [{ cueId: "a", start: 3, end: 6 }],
      },
    ],
    reusableItems: [
      {
        id: "r1",
        pointIds: ["p1"],
        kind: "frame",
        sourceForms: [
          { cueIds: ["a"], sourceSpans: [{ cueId: "a", start: 3, end: 6 }], text: quantity },
        ],
        pattern: "number + 杯 + drink",
        examples: [
          {
            origin: "ai",
            situation: "Ordering a drink",
            dialogue: [
              { text: "你要喝什麼？", translation: "What would you like to drink?" },
              {
                text: "我想喝一杯茶。",
                translation: "I would like a cup of tea.",
                pronunciation: [
                  reading("我", "ㄨㄛˇ", "wǒ"),
                  reading("想", "ㄒㄧㄤˇ", "xiǎng"),
                  reading("喝", "ㄏㄜ", "hē"),
                  reading("一杯", "ㄧ ㄅㄟ", "yī bēi"),
                  reading("茶", "ㄔㄚˊ", "chá"),
                  { text: "。" },
                ],
              },
            ].map(line => ({
              ...line,
              text: traditional ? line.text : line.text.replace("什麼", "什么"),
            })),
            targetLineIndex: 1,
            targetText: "一杯茶",
          },
        ],
      },
    ],
    pronunciations: [
      {
        cueId: "a",
        segments: [
          reading("我", "ㄨㄛˇ", "wǒ"),
          reading("要", "ㄧㄠˋ", "yào"),
          reading(traditional ? "買" : "买", "ㄇㄞˇ", "mǎi"),
          reading(traditional ? "兩杯" : "两杯", "ㄌㄧㄤˇ ㄅㄟ", "liǎng bēi"),
          reading("茶", "ㄔㄚˊ", "chá"),
          { text: "。" },
        ],
      },
    ],
  };
  const result = validateTeachingBatch(raw, input, request.profile, "chinese");
  const document = validateLearningDocumentV7({
    schemaVersion: 7,
    id: request.id,
    createdAt: "2026-10-10T00:00:00.000Z",
    source: request.source,
    profile: request.profile,
    generation: request.agent,
    cues: request.cues,
    sections: [result.section],
    points: result.points,
    reusableItems: result.reusableItems,
  });
  return { request, input, raw, document, result };
}
