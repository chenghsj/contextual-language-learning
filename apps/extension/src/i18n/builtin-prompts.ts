import type { UiLocale } from "./messages";
import { promptTemplates } from "./custom-content";

export type BuiltinPromptKey = keyof typeof promptTemplates;
const prompts = {
  en: promptTemplates,
  "zh-TW": {
    summary: "為提供的內容撰寫清楚、有條理的摘要，包含重點與簡短回顧。使用 Markdown 標題與清單。",
    vocabulary: "根據提供的內容製作詞彙指南，包含詞義、原文例句與練習例句。使用 Markdown 格式。",
    grammar: "說明提供內容中的實用文法，引用原文例句並加入練習題。使用 Markdown 格式。",
    shadowing: "使用原文句子製作跟讀練習指南，包含節奏提示與建議的練習順序。使用 Markdown 格式。",
    quiz: "根據提供的內容製作測驗，並在最後附上答案與解釋。使用 Markdown 格式。",
  },
  "zh-CN": {
    summary: "为提供的内容撰写清楚、有条理的摘要，包含重点与简短回顾。使用 Markdown 标题与列表。",
    vocabulary: "根据提供的内容制作词汇指南，包含词义、原文例句与练习例句。使用 Markdown 格式。",
    grammar: "说明提供内容中的实用语法，引用原文例句并加入练习题。使用 Markdown 格式。",
    shadowing: "使用原文句子制作跟读练习指南，包含节奏提示与建议的练习顺序。使用 Markdown 格式。",
    quiz: "根据提供的内容制作测验，并在最后附上答案与解释。使用 Markdown 格式。",
  },
  ja: {
    summary:
      "提供された内容を明確に整理して要約し、重要な点と短いまとめを含めてください。Markdown の見出しと箇条書きを使ってください。",
    vocabulary:
      "提供された内容から語彙ガイドを作成し、意味、原文の例文、練習用の例文を含めてください。Markdown を使ってください。",
    grammar:
      "提供された内容の実用的な文法を、原文の例文を引用して説明し、練習問題を加えてください。Markdown を使ってください。",
    shadowing:
      "原文の文をそのまま使ってシャドーイングの練習ガイドを作成し、リズムのヒントと練習順序を含めてください。Markdown を使ってください。",
    quiz: "提供された内容に基づくクイズを作成し、最後に解答と解説を付けてください。Markdown を使ってください。",
  },
  ko: {
    summary:
      "제공된 내용을 명확하게 정리하여 요약하고, 핵심 내용과 짧은 정리를 포함해 주세요. Markdown 제목과 목록을 사용해 주세요.",
    vocabulary:
      "제공된 내용으로 어휘 가이드를 만들고, 뜻과 원문 예문, 연습 예문을 포함해 주세요. Markdown을 사용해 주세요.",
    grammar:
      "제공된 내용의 유용한 문법을 원문 예문과 함께 설명하고 연습 문제를 추가해 주세요. Markdown을 사용해 주세요.",
    shadowing:
      "원문 문장을 그대로 사용해 쉐도잉 연습 가이드를 만들고, 리듬 안내와 권장 연습 순서를 포함해 주세요. Markdown을 사용해 주세요.",
    quiz: "제공된 내용을 바탕으로 퀴즈를 만들고 마지막에 정답과 해설을 추가해 주세요. Markdown을 사용해 주세요.",
  },
} satisfies Record<UiLocale, Record<BuiltinPromptKey, string>>;
const outputLanguage = {
  en: "Write in English.",
  "zh-TW": "請使用繁體中文撰寫。",
  "zh-CN": "请使用简体中文撰写。",
  ja: "日本語で書いてください。",
  ko: "한국어로 작성해 주세요.",
} satisfies Record<UiLocale, string>;

export function builtinPrompt(key: BuiltinPromptKey, locale: UiLocale): string {
  return prompts[locale][key] + "\n" + outputLanguage[locale];
}

/** Recognize unchanged defaults, including previously saved English-only templates. */
export function identifyBuiltinPrompt(prompt: string): BuiltinPromptKey | undefined {
  return (Object.keys(promptTemplates) as BuiltinPromptKey[]).find(key =>
    (Object.keys(prompts) as UiLocale[]).some(
      locale =>
        prompt === builtinPrompt(key, locale) ||
        prompt === promptTemplates[key] + `\nWrite in ${locale}.`,
    ),
  );
}
