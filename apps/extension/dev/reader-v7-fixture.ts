import {
  validateLearningDocumentV7,
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
} from "@contextual/core";
export const v7Fixture = validateLearningDocumentV7({
  id: "39bb7a54-9e78-4c1c-9ad0-5bee2a588d2d",
  createdAt: "2026-10-09T00:00:00.000Z",
  source: {
    platform: "import",
    url: "https://www.youtube.com/watch?v=preview-only",
    title: "Time and reference",
  },
  profile: {
    targetLanguage: "en",
    instructionLanguage: "zh-TW",
    level: "B1",
    sceneCount: 2,
    contextualExampleCount: 1,
    enabledExplanations: ["vocabulary", "grammar", "usage"],
    emphasizedExplanations: ["grammar"],
  },
  generation: {
    provider: "openai",
    modelId: "offline",
  },
  cues: [
    {
      id: "cue-1",
      startMs: 0,
      endMs: 1800,
      originalText: "Why were you still home?",
    },
    {
      id: "cue-2",
      startMs: 2000,
      endMs: 3800,
      originalText: "I was about to head out when you called.",
    },
  ],
  schemaVersion: 7,
  execution: {
    workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
    promptVersion: LEARNING_POINTS_PROMPT_VERSION,
    schemaVersion: "7",
    languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
    levelStrategyVersion: LEVEL_STRATEGY_VERSION,
    qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
    inputFingerprint: "0".repeat(64),
    provider: "openai",
    modelId: "offline",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    chunkPlan: [["cue-1", "cue-2"]],
    calls: [],
  },
  sections: [
    {
      id: "aaae537a-a92d-4c28-b8c2-2701002eef2f",
      cueIds: ["cue-1", "cue-2"],
      contextCueIds: [],
      startMs: 0,
      endMs: 3800,
      title: "正準備出門時接到電話",
      context: {
        text: "一方詢問對方為何當時還在家，對方說接到電話時正準備出門。",
        evidenceCueIds: ["cue-1", "cue-2"],
      },
      translations: [
        {
          cueId: "cue-1",
          text: "你那時為什麼還在家？",
        },
        {
          cueId: "cue-2",
          text: "你打來時，我正準備出門。",
        },
      ],
      utterances: [
        {
          id: "u1",
          meaning: "詢問對方當時為何仍在家。",
          contextExplanation: "後一句回應這個問題；字幕沒有說明人物關係。",
          contextCueIds: ["cue-2"],
          decision: "basic_only",
          pointIds: [],
          cueIds: ["cue-1"],
          sourceSpans: [
            {
              cueId: "cue-1",
              start: 0,
              end: 24,
            },
          ],
        },
        {
          id: "u2",
          meaning: "電話打來的當下，說話者已準備出門，但尚未出發。",
          contextExplanation: "這句回應為何當時還在家；原文沒有交代之後是否出門。",
          contextCueIds: ["cue-1"],
          decision: "explained",
          pointIds: ["batch:p1", "batch:p2", "batch:p3"],
          cueIds: ["cue-2"],
          sourceSpans: [
            {
              cueId: "cue-2",
              start: 0,
              end: 40,
            },
          ],
        },
      ],
    },
  ],
  points: [
    {
      id: "batch:p1",
      utteranceIds: ["u2"],
      category: "grammar",
      presentation: "core",
      title: "過去某刻正要做某事",
      sourceCueIds: ["cue-2"],
      contextCueIds: ["cue-1"],
      explanation:
        "was about to + 動詞原形表示在過去那一刻正要做某事，焦點是動作即將開始。這裡尚未完成出門；和 was heading out 描述已在出門過程中的焦點不同。",
      sourceSpans: [
        {
          cueId: "cue-2",
          start: 0,
          end: 40,
        },
      ],
    },
    {
      id: "batch:p2",
      utteranceIds: ["u2"],
      category: "vocabulary",
      presentation: "core",
      title: "head out：出門、離開此處",
      sourceCueIds: ["cue-2"],
      contextCueIds: ["cue-1"],
      explanation:
        "head out 在這裡表示出門或離開目前所在的地方；前一句 home 說明此處是在談離家出門。",
      sourceSpans: [
        {
          cueId: "cue-2",
          start: 0,
          end: 40,
        },
      ],
    },
    {
      id: "batch:p3",
      utteranceIds: ["u2"],
      category: "grammar",
      presentation: "core",
      title: "when 連接兩件事的時間",
      sourceCueIds: ["cue-2"],
      contextCueIds: [],
      explanation:
        "when you called 指出電話打來的時間點；主句說明那一刻的準備狀態。這個時間關係本身不表示電話造成取消出門，也不能據此確定事情後來的結果。",
      sourceSpans: [
        {
          cueId: "cue-2",
          start: 0,
          end: 40,
        },
      ],
    },
  ],
  reusableItems: [
    {
      id: "batch:r1",
      pointIds: ["batch:p1"],
      kind: "frame",
      sourceForms: [
        {
          cueIds: ["cue-2"],
          text: "was about to head out",
          sourceSpans: [
            {
              cueId: "cue-2",
              start: 2,
              end: 23,
            },
          ],
        },
      ],
      pattern: "be about to + 動詞原形",
      examples: [
        {
          origin: "ai",
          situation: "同事詢問會議何時開始。",
          dialogue: [
            {
              text: "Are we ready?",
              translation: "我們準備好了嗎？",
            },
            {
              text: "Yes, we are about to start.",
              translation: "好了，我們正要開始。",
            },
          ],
          targetLineIndex: 1,
          targetText: "are about to start",
        },
      ],
    },
    {
      id: "batch:r2",
      pointIds: ["batch:p2"],
      kind: "expression",
      sourceForms: [
        {
          cueIds: ["cue-2"],
          text: "head out",
          sourceSpans: [
            {
              cueId: "cue-2",
              start: 15,
              end: 23,
            },
          ],
        },
      ],
      examples: [
        {
          origin: "ai",
          situation: "朋友在門口確認是否出發。",
          dialogue: [
            {
              text: "Shall we head out now?",
              translation: "我們現在出發好嗎？",
            },
            {
              text: "Yes, I am ready.",
              translation: "好，我準備好了。",
            },
          ],
          targetLineIndex: 0,
          targetText: "head out",
        },
      ],
    },
  ],
});

/** A separate synthetic source for cross-caption utterance/fragment acceptance. */
export function crossCueV7Fixture() {
  const doc = structuredClone(v7Fixture);
  doc.profile.enabledExplanations!.push("chunks");
  doc.cues[1] = { ...doc.cues[1], originalText: "I was about to head out", endMs: 2700 };
  doc.cues.push({ id: "cue-3", originalText: "when you called.", startMs: 2700, endMs: 3800 });
  const scene = doc.sections[0];
  scene.cueIds.push("cue-3");
  scene.context.evidenceCueIds.push("cue-3");
  scene.translations[1].text = "我正準備要出門。";
  scene.translations.push({ cueId: "cue-3", text: "這時你打來。" });
  scene.utterances[1].cueIds.push("cue-3");
  scene.utterances[1].sourceSpans[0].end = doc.cues[1].originalText.length;
  scene.utterances[1].sourceSpans.push({
    cueId: "cue-3",
    start: 0,
    end: doc.cues.find(c => c.id === "cue-3")!.originalText.length,
  });
  scene.utterances[1].chunks = [
    {
      id: "cross-frame",
      spans: [
        { cueId: "cue-2", start: 2, end: 14 },
        { cueId: "cue-3", start: 0, end: 4 },
      ],
      meaning: "正要做某事，這時另一件事發生。",
    },
  ];
  doc.points[0].sourceCueIds = ["cue-2", "cue-3"];
  doc.points[0].sourceSpans = [
    { cueId: "cue-2", start: 2, end: 14 },
    { cueId: "cue-3", start: 0, end: 4 },
  ];
  doc.points[1].sourceSpans = [{ cueId: "cue-2", start: 15, end: 23 }];
  doc.points[2].sourceCueIds = ["cue-3"];
  doc.points[2].sourceSpans = [{ cueId: "cue-3", start: 0, end: doc.cues[2].originalText.length }];
  return validateLearningDocumentV7(doc);
}

/** Explicit synthetic omissions for browser acceptance, not generated learning quality evidence. */
export function readingGapV7Fixture() {
  const doc = structuredClone(v7Fixture);
  const scene = doc.sections[0];
  doc.execution = {
    workflowVersion: "learning-points-v6-2",
    promptVersion: "learning-points-prompts-5",
    schemaVersion: "7",
    languageStrategyVersion: "learning-language-strategies-4",
    levelStrategyVersion: "learning-level-strategies-1",
    qualityStrategyVersion: "learning-quality-1",
    inputFingerprint: "0".repeat(64),
    provider: doc.generation.provider,
    modelId: doc.generation.modelId,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    chunkPlan: [doc.cues.map(c => c.id)],
    calls: [],
    pronunciationDiagnostics: [
      {
        id: "preview-source",
        batchId: "s0",
        sceneId: scene.id,
        path: "/pronunciations/0",
        cueId: scene.cueIds[0],
        code: "invalid_reading",
        action: "omitted",
      },
      {
        id: "preview-example",
        batchId: "s0",
        sceneId: scene.id,
        path: "/reusableItems/0/examples/0/dialogue/0/pronunciation",
        itemId: doc.reusableItems[0].id,
        exampleIndex: 0,
        lineIndex: 0,
        code: "empty_annotation",
        action: "omitted",
      },
    ],
  };
  return validateLearningDocumentV7(doc);
}

/** Long source/readings for layout and keyboard acceptance only. */
export function longReadingV7Fixture(language: "ja" | "ko") {
  const doc = structuredClone(v7Fixture);
  doc.profile.targetLanguage = language;
  doc.profile.enabledExplanations = [
    "vocabulary",
    "grammar",
    "usage",
    "chunks",
    "pronunciation",
    "culture",
  ];
  doc.profile.emphasizedExplanations = [];
  doc.profile.level = language === "ja" ? "N3" : "3";
  const lines =
    language === "ja"
      ? [
          "出かける前に、先生からもらった資料をもう一度確認しておきたいと思います。",
          "もし明日の会議までに資料の内容を確認できれば、みんなで具体的な予定を相談して決められると思います。",
        ]
      : [
          "내일 회의가 시작되기 전에 선생님께 받은 자료를 다시 한번 확인해 두려고 해요.",
          "내일 회의 전까지 자료 내용을 확인할 수 있으면, 다 같이 구체적인 계획을 의논해서 정할 수 있을 것 같아요.",
        ];
  doc.cues.forEach((cue, i) => {
    cue.originalText = lines[i];
  });
  const scene = doc.sections[0];
  scene.title = "長句與讀音換行驗證";
  scene.context.text = "固定合成長句，驗證讀音、語塊和操作狀態。";
  scene.translations.forEach((t, i) => {
    t.text = i
      ? "如果能先確認資料，就可以一起討論具體計畫。"
      : "出門前想先再確認一次老師給的資料。";
  });
  const split = lines[1].indexOf(language === "ja" ? "、" : ",") + 1;
  scene.pronunciations = doc.cues.map((c, i) => ({
    cueId: c.id,
    segments:
      i === 0
        ? [
            {
              text: c.originalText,
              reading:
                language === "ja"
                  ? "でかけるまえにせんせいからもらったしりょうをもういちどかくにんしておきたいとおもいます"
                  : "내일 회의가 시작뙤기 전에 선생님께 바든 자료를 다시 한번 화긴해 두려고 해요",
            },
          ]
        : [
            {
              text: c.originalText.slice(0, split),
              reading:
                language === "ja"
                  ? "もしあしたのかいぎまでにしりょうのないようをかくにんできれば"
                  : "내일 회의 전까지 자료 내용을 화긴할 쑤 이쓰면",
            },
            {
              text: c.originalText.slice(split),
              reading:
                language === "ja"
                  ? "みんなでぐたいてきなよていをそうだんしてきめられるとおもいます"
                  : "다 가치 구체저긴 계획을 의논해서 정할 쑤 이쓸 껃 가타요",
            },
          ],
  }));
  scene.utterances.forEach(u => {
    u.sourceSpans = u.cueIds.map(id => ({
      cueId: id,
      start: 0,
      end: doc.cues.find(c => c.id === id)!.originalText.length,
    }));
    u.decision = "basic_only";
    u.pointIds = [];
    u.meaning = "確認資料後再一起討論計畫。";
    u.contextExplanation = "條件先成立，再討論後續安排。";
  });
  scene.utterances[1].chunks = [
    {
      id: "condition",
      spans: [{ cueId: "cue-2", start: 0, end: split }],
      meaning: "先確認資料這個條件。",
    },
    {
      id: "result",
      spans: [{ cueId: "cue-2", start: split, end: lines[1].length }],
      meaning: "再一起討論並決定具體計畫。",
    },
  ];
  doc.points = [];
  doc.reusableItems = [];
  return validateLearningDocumentV7(doc);
}

/** One original subtitle, two teaching units; no guessed sub-cue timing. */
export function withinCueV7Fixture() {
  const doc = structuredClone(v7Fixture),
    scene = doc.sections[0],
    cue = doc.cues[1];
  const split = cue.originalText.indexOf(" when");
  scene.utterances = [
    scene.utterances[0],
    ...[0, 1].map(i => ({
      ...scene.utterances[1],
      id: "topic-" + i,
      pointIds: [],
      decision: "basic_only" as const,
      meaning: i ? "電話打來的時間。" : "那時正要離開。",
      contextExplanation: "",
      cueIds: [cue.id],
      sourceSpans: [
        { cueId: cue.id, start: i ? split : 0, end: i ? cue.originalText.length : split },
      ],
    })),
  ];
  scene.utterances[0].pointIds = [];
  scene.utterances[0].decision = "basic_only";
  doc.points = [];
  doc.reusableItems = [];
  return validateLearningDocumentV7(doc);
}
