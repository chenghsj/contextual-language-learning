import type { UiLocale } from "./messages";
import type { LearningProfile, LearningLanguage } from "@immersive/core";
import { learningLanguageName } from "./preferences";

export type LearningSettingKey = "targetLanguage" | "level" | "instructionLanguage" | "sceneCount";
export type SettingOptionInfo = { label: string; description: string };
export type LearningSettingsCopy = {
  infoLabel: string;
  fieldHints: Record<LearningSettingKey, string>;
  levelHints: Record<LearningProfile["targetLanguage"], string>;
  targetDescriptions: Record<LearningProfile["targetLanguage"], string>;
  instructionDescriptions: Record<LearningProfile["instructionLanguage"], string>;
  levels: Record<LearningProfile["targetLanguage"], Record<string, SettingOptionInfo>>;
};

type OriginalTarget = "en" | "ja" | "ko";
type OriginalExplanation = "zh-TW" | "zh-CN" | OriginalTarget;
type OriginalLearningSettingsCopy = Omit<
  LearningSettingsCopy,
  "levelHints" | "targetDescriptions" | "instructionDescriptions" | "levels"
> & {
  levelHints: Record<OriginalTarget, string>;
  targetDescriptions: Record<OriginalTarget, string>;
  instructionDescriptions: Record<OriginalExplanation, string>;
  levels: Record<OriginalTarget, Record<string, SettingOptionInfo>>;
};

/** Keep existing localized guidance while sharing CEFR descriptions for new languages. */
const originalLearningSettingsCopy: Record<UiLocale, OriginalLearningSettingsCopy> = {
  en: {
    infoLabel: "Information about",
    fieldHints: {
      targetLanguage:
        "Choose the language you want to learn. The subtitle phrases and example sentences stay in that language.",
      level: "This sets your lesson difficulty; it is not a proficiency test.",
      instructionLanguage:
        "Choose the language used to explain meanings, grammar and answers. Original subtitle lines stay in the learning language.",
      sceneCount:
        "Maximum selected scenes for the entire video (1–6). The AI chooses only meaningful conversations and may select fewer.",
    },
    levelHints: {
      en: "English uses CEFR (A1–C2): A1 is beginner and C2 is proficient. Choose a level that matches the dialogue you can currently understand.",
      ja: "Japanese uses JLPT (N5–N1): N5 is beginner and N1 is advanced. Choose a level that matches the dialogue you can currently understand.",
      ko: "Korean uses TOPIK (1–6): level 1 is beginner and level 6 is advanced. Choose a level that matches the dialogue you can currently understand.",
    },
    targetDescriptions: {
      en: "Learn from English subtitle lines.",
      ja: "Learn from Japanese subtitle lines.",
      ko: "Learn from Korean subtitle lines.",
    },
    instructionDescriptions: {
      en: "Explain meanings and grammar in English.",
      "zh-TW": "Explain meanings and grammar in Traditional Chinese.",
      "zh-CN": "Explain meanings and grammar in Simplified Chinese.",
      ja: "Explain meanings and grammar in Japanese.",
      ko: "Explain meanings and grammar in Korean.",
    },
    levels: {
      en: {
        A1: {
          label: "Beginner",
          description: "Very common words and simple everyday phrases.",
        },
        A2: {
          label: "Elementary",
          description: "Short exchanges about familiar daily activities.",
        },
        B1: {
          label: "Intermediate",
          description: "Main ideas, common situations and personal opinions.",
        },
        B2: {
          label: "Upper-intermediate",
          description: "Longer dialogue, more complex vocabulary and arguments.",
        },
        C1: {
          label: "Advanced",
          description: "Nuance, implied meaning and demanding topics.",
        },
        C2: {
          label: "Proficient",
          description: "Subtle meaning and complex or idiomatic expression.",
        },
      },
      ja: {
        N5: {
          label: "Beginner",
          description: "Basic greetings, short sentences and essential words.",
        },
        N4: {
          label: "Elementary",
          description: "Common daily phrases and simple conversations.",
        },
        N3: {
          label: "Intermediate",
          description: "Everyday conversations at a more natural pace.",
        },
        N2: {
          label: "Upper-intermediate",
          description: "Longer discussions, news-like topics and nuance.",
        },
        N1: {
          label: "Advanced",
          description: "Complex expressions and subtle, abstract meaning.",
        },
      },
      ko: {
        "1": {
          label: "Beginner",
          description: "Basic greetings and very simple daily phrases.",
        },
        "2": {
          label: "Elementary",
          description: "Familiar situations and short everyday conversations.",
        },
        "3": {
          label: "Intermediate",
          description: "Routine social topics and longer conversations.",
        },
        "4": {
          label: "Upper-intermediate",
          description: "Detailed explanations and less familiar subjects.",
        },
        "5": {
          label: "Advanced",
          description: "Complex topics and more subtle expression.",
        },
        "6": {
          label: "Proficient",
          description: "Nuanced meaning across demanding contexts.",
        },
      },
    },
  },
  "zh-TW": {
    infoLabel: "設定說明：",
    fieldHints: {
      targetLanguage: "選擇你要學的語言。字幕原句和學習例句會保留該語言。",
      level: "這是教材難度設定，不是能力測驗結果。",
      instructionLanguage: "選擇單字意思、文法與答案解說使用的語言；字幕原句仍保留學習語言。",
      sceneCount:
        "整部影片最多挑選 1～6 個有上下文的對話場景。若沒有足夠合適的內容，AI 會挑得更少。",
    },
    levelHints: {
      en: "英文使用 CEFR（A1～C2）分級，A1 為入門、C2 為精通。請依目前能理解的英文對話選擇難度。",
      ja: "日文使用 JLPT（N5～N1）分級，N5 為入門、N1 為進階。請依目前能理解的日文對話選擇難度。",
      ko: "韓文使用 TOPIK（1～6）分級，1 級為入門、6 級為進階。請依目前能理解的韓文對話選擇難度。",
    },
    targetDescriptions: {
      en: "從英文字幕學英文。",
      ja: "從日文字幕學日文。",
      ko: "從韓文字幕學韓文。",
    },
    instructionDescriptions: {
      en: "以英文解說單字與文法。",
      "zh-TW": "以繁體中文解說單字與文法。",
      "zh-CN": "以簡體中文解說單字與文法。",
      ja: "以日文解說單字與文法。",
      ko: "以韓文解說單字與文法。",
    },
    levels: {
      en: {
        A1: {
          label: "入門",
          description: "理解常見單字、簡單句子和日常用語。",
        },
        A2: {
          label: "初級",
          description: "理解熟悉生活情境的短對話。",
        },
        B1: {
          label: "中級",
          description: "掌握常見話題、主要意思與個人想法。",
        },
        B2: {
          label: "中高級",
          description: "理解較長對話、複雜詞彙和論點。",
        },
        C1: {
          label: "進階",
          description: "理解言外之意、語氣和較難的主題。",
        },
        C2: {
          label: "精通",
          description: "理解細微語意、慣用表達及複雜內容。",
        },
      },
      ja: {
        N5: {
          label: "入門",
          description: "基本招呼、簡單短句與基礎單字。",
        },
        N4: {
          label: "初級",
          description: "常見生活用語與簡單會話。",
        },
        N3: {
          label: "中級",
          description: "理解較自然速度的日常對話。",
        },
        N2: {
          label: "中高級",
          description: "較長討論、新聞式主題與語意差異。",
        },
        N1: {
          label: "進階",
          description: "複雜表達、抽象內容與細微語意。",
        },
      },
      ko: {
        "1": {
          label: "入門",
          description: "基本招呼和非常簡單的日常用語。",
        },
        "2": {
          label: "初級",
          description: "熟悉情境與簡短日常會話。",
        },
        "3": {
          label: "中級",
          description: "一般社交話題與較長對話。",
        },
        "4": {
          label: "中高級",
          description: "較詳細的說明與不熟悉的主題。",
        },
        "5": {
          label: "進階",
          description: "複雜主題與較細膩的表達。",
        },
        "6": {
          label: "精通",
          description: "理解高難度內容與細微語意。",
        },
      },
    },
  },
  "zh-CN": {
    infoLabel: "设置说明：",
    fieldHints: {
      targetLanguage: "选择你要学习的语言。字幕原句和学习例句会保留该语言。",
      level: "这是教材难度设置，不是能力测试结果。",
      instructionLanguage: "选择词义、语法和答案讲解使用的语言；字幕原句仍保留学习语言。",
      sceneCount:
        "整部影片最多挑选 1～6 个有上下文的对话场景。没有足够合适的内容时，AI 会选得更少。",
    },
    levelHints: {
      en: "英语使用 CEFR（A1～C2）分级，A1 为入门、C2 为精通。请根据目前能理解的英语对话选择难度。",
      ja: "日语使用 JLPT（N5～N1）分级，N5 为入门、N1 为高级。请根据目前能理解的日语对话选择难度。",
      ko: "韩语使用 TOPIK（1～6）分级，1 级为入门、6 级为高级。请根据目前能理解的韩语对话选择难度。",
    },
    targetDescriptions: {
      en: "通过英语字幕学习英语。",
      ja: "通过日语字幕学习日语。",
      ko: "通过韩语字幕学习韩语。",
    },
    instructionDescriptions: {
      en: "使用英语讲解词义和语法。",
      "zh-TW": "使用繁体中文讲解词义和语法。",
      "zh-CN": "使用简体中文讲解词义和语法。",
      ja: "使用日语讲解词义和语法。",
      ko: "使用韩语讲解词义和语法。",
    },
    levels: {
      en: {
        A1: {
          label: "入门",
          description: "理解常见单词、简单句子与日常用语。",
        },
        A2: {
          label: "初级",
          description: "理解熟悉生活场景中的简短对话。",
        },
        B1: {
          label: "中级",
          description: "理解常见话题、主要意思与个人观点。",
        },
        B2: {
          label: "中高级",
          description: "理解较长对话、复杂词汇和论点。",
        },
        C1: {
          label: "高级",
          description: "理解言外之意、语气和较难的主题。",
        },
        C2: {
          label: "精通",
          description: "理解细微语义、习惯表达及复杂内容。",
        },
      },
      ja: {
        N5: {
          label: "入门",
          description: "基本问候、简单短句和基础词汇。",
        },
        N4: {
          label: "初级",
          description: "常见生活用语与简单会话。",
        },
        N3: {
          label: "中级",
          description: "理解较自然语速的日常对话。",
        },
        N2: {
          label: "中高级",
          description: "较长讨论、新闻类话题与语义差异。",
        },
        N1: {
          label: "高级",
          description: "复杂表达、抽象内容与细微语义。",
        },
      },
      ko: {
        "1": {
          label: "入门",
          description: "基本问候和非常简单的日常用语。",
        },
        "2": {
          label: "初级",
          description: "熟悉场景与简短日常会话。",
        },
        "3": {
          label: "中级",
          description: "一般社交话题与较长对话。",
        },
        "4": {
          label: "中高级",
          description: "较详细的说明与不熟悉的话题。",
        },
        "5": {
          label: "高级",
          description: "复杂话题与较细腻的表达。",
        },
        "6": {
          label: "精通",
          description: "理解高难度内容与细微语义。",
        },
      },
    },
  },
  ja: {
    infoLabel: "設定の説明：",
    fieldHints: {
      targetLanguage: "学習したい言語を選びます。字幕の原文や例文はその言語のままです。",
      level: "教材の難易度を設定します。実際の語学力を判定する試験ではありません。",
      instructionLanguage:
        "語彙の意味、文法、解答の説明に使う言語を選びます。字幕の原文は学習言語のままです。",
      sceneCount:
        "動画全体から選ぶ会話シーンの上限（1～6）。適切な場面が少ない場合は、より少ない数を選びます。",
    },
    levelHints: {
      en: "英語は CEFR（A1～C2）を使います。A1 は入門、C2 は熟達です。現在理解できる英語の会話に合わせて選んでください。",
      ja: "日本語は JLPT（N5～N1）を使います。N5 は入門、N1 は上級です。現在理解できる日本語の会話に合わせて選んでください。",
      ko: "韓国語は TOPIK（1～6級）を使います。1級は入門、6級は上級です。現在理解できる韓国語の会話に合わせて選んでください。",
    },
    targetDescriptions: {
      en: "英語の字幕から英語を学びます。",
      ja: "日本語の字幕から日本語を学びます。",
      ko: "韓国語の字幕から韓国語を学びます。",
    },
    instructionDescriptions: {
      en: "英語で意味と文法を説明します。",
      "zh-TW": "繁体字中国語で意味と文法を説明します。",
      "zh-CN": "簡体字中国語で意味と文法を説明します。",
      ja: "日本語で意味と文法を説明します。",
      ko: "韓国語で意味と文法を説明します。",
    },
    levels: {
      en: {
        A1: {
          label: "入門",
          description: "よく使う単語と簡単な日常表現。",
        },
        A2: {
          label: "初級",
          description: "身近な場面での短い会話。",
        },
        B1: {
          label: "中級",
          description: "よくある話題の要点や意見。",
        },
        B2: {
          label: "中上級",
          description: "長めの会話、複雑な語彙や議論。",
        },
        C1: {
          label: "上級",
          description: "含意、ニュアンスや難しい話題。",
        },
        C2: {
          label: "熟達",
          description: "微妙な意味や複雑な慣用表現。",
        },
      },
      ja: {
        N5: {
          label: "入門",
          description: "挨拶、短い文、基本的な語彙。",
        },
        N4: {
          label: "初級",
          description: "よく使う日常表現と簡単な会話。",
        },
        N3: {
          label: "中級",
          description: "自然に近い速さの日常会話。",
        },
        N2: {
          label: "中上級",
          description: "長めの議論やニュース、細かな意味。",
        },
        N1: {
          label: "上級",
          description: "複雑な表現、抽象的な話題や含意。",
        },
      },
      ko: {
        "1": {
          label: "入門",
          description: "基本的な挨拶と簡単な日常表現。",
        },
        "2": {
          label: "初級",
          description: "身近な場面での短い会話。",
        },
        "3": {
          label: "中級",
          description: "日常の社会的話題や長めの会話。",
        },
        "4": {
          label: "中上級",
          description: "詳しい説明や慣れない話題。",
        },
        "5": {
          label: "上級",
          description: "複雑な話題と細かな表現。",
        },
        "6": {
          label: "熟達",
          description: "難しい内容や微妙な意味。",
        },
      },
    },
  },
  ko: {
    infoLabel: "설정 설명:",
    fieldHints: {
      targetLanguage: "학습할 언어를 선택합니다. 자막 원문과 예문은 해당 언어로 유지됩니다.",
      level: "교재의 난이도를 설정하는 것이며 실제 언어 능력을 평가하는 시험은 아닙니다.",
      instructionLanguage:
        "어휘 의미, 문법 및 정답 설명에 사용할 언어를 선택합니다. 자막 원문은 학습 언어 그대로 유지됩니다.",
      sceneCount:
        "동영상 전체에서 고를 대화 장면의 상한(1~6개)입니다. 적합한 장면이 적으면 더 적게 선택합니다.",
    },
    levelHints: {
      en: "영어는 CEFR(A1~C2)을 사용합니다. A1은 입문, C2는 숙련 단계입니다. 현재 이해할 수 있는 영어 대화 수준에 맞춰 선택하세요.",
      ja: "일본어는 JLPT(N5~N1)을 사용합니다. N5는 입문, N1은 고급 단계입니다. 현재 이해할 수 있는 일본어 대화 수준에 맞춰 선택하세요.",
      ko: "한국어는 TOPIK(1~6급)을 사용합니다. 1급은 입문, 6급은 고급 단계입니다. 현재 이해할 수 있는 한국어 대화 수준에 맞춰 선택하세요.",
    },
    targetDescriptions: {
      en: "영어 자막으로 영어를 학습합니다.",
      ja: "일본어 자막으로 일본어를 학습합니다.",
      ko: "한국어 자막으로 한국어를 학습합니다.",
    },
    instructionDescriptions: {
      en: "영어로 어휘와 문법을 설명합니다.",
      "zh-TW": "번체 중국어로 어휘와 문법을 설명합니다.",
      "zh-CN": "간체 중국어로 어휘와 문법을 설명합니다.",
      ja: "일본어로 어휘와 문법을 설명합니다.",
      ko: "한국어로 어휘와 문법을 설명합니다.",
    },
    levels: {
      en: {
        A1: {
          label: "입문",
          description: "자주 쓰는 단어와 간단한 일상 표현.",
        },
        A2: {
          label: "초급",
          description: "익숙한 상황에서의 짧은 대화.",
        },
        B1: {
          label: "중급",
          description: "일반적인 주제의 요점과 의견.",
        },
        B2: {
          label: "중상급",
          description: "긴 대화, 복잡한 어휘와 논의.",
        },
        C1: {
          label: "고급",
          description: "함축적 의미, 뉘앙스와 어려운 주제.",
        },
        C2: {
          label: "숙련",
          description: "미묘한 의미와 복잡한 관용 표현.",
        },
      },
      ja: {
        N5: {
          label: "입문",
          description: "기본 인사, 짧은 문장과 기초 어휘.",
        },
        N4: {
          label: "초급",
          description: "흔한 일상 표현과 간단한 대화.",
        },
        N3: {
          label: "중급",
          description: "자연스러운 속도의 일상 대화.",
        },
        N2: {
          label: "중상급",
          description: "긴 논의, 뉴스와 세부적인 의미.",
        },
        N1: {
          label: "고급",
          description: "복잡한 표현, 추상적 주제와 함축적 의미.",
        },
      },
      ko: {
        "1": {
          label: "입문",
          description: "기본 인사와 아주 간단한 일상 표현.",
        },
        "2": {
          label: "초급",
          description: "익숙한 상황에서의 짧은 대화.",
        },
        "3": {
          label: "중급",
          description: "일반적인 사회 주제와 긴 대화.",
        },
        "4": {
          label: "중상급",
          description: "상세한 설명과 낯선 주제.",
        },
        "5": {
          label: "고급",
          description: "복잡한 주제와 세밀한 표현.",
        },
        "6": {
          label: "숙련",
          description: "난도 높은 내용과 미묘한 의미.",
        },
      },
    },
  },
};

type AddedLanguage = Exclude<LearningLanguage, OriginalTarget>;
const ADDED_LANGUAGES: readonly AddedLanguage[] = [
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "id",
  "th",
  "ms",
  "vi",
];

const localizedCEFRHint: Record<UiLocale, (name: string) => string> = {
  en: name =>
    name +
    " uses CEFR (A1–C2): A1 is beginner and C2 is proficient. Choose a level that matches the dialogue you can understand.",
  "zh-TW": name =>
    name + "使用 CEFR（A1～C2）分級，A1 為入門、C2 為精通。請依目前能理解的對話選擇難度。",
  "zh-CN": name =>
    name + "使用 CEFR（A1～C2）分级，A1 为入门、C2 为精通。请根据目前能理解的对话选择难度。",
  ja: name =>
    name +
    "は CEFR（A1～C2）を使います。A1 は入門、C2 は熟達です。理解できる会話に合わせて選んでください。",
  ko: name =>
    name +
    "는 CEFR(A1~C2)을 사용합니다. A1은 입문, C2는 숙련 단계입니다. 이해할 수 있는 대화에 맞춰 선택하세요.",
};
const localizedTargetDescription: Record<UiLocale, (name: string) => string> = {
  en: name => "Learn from " + name + " subtitle lines.",
  "zh-TW": name => "透過" + name + "字幕學習。",
  "zh-CN": name => "通过" + name + "字幕学习。",
  ja: name => name + "の字幕から学びます。",
  ko: name => name + " 자막으로 학습합니다.",
};
const localizedInstructionDescription: Record<UiLocale, (name: string) => string> = {
  en: name => "Explain meanings and grammar in " + name + ".",
  "zh-TW": name => "使用" + name + "講解詞義和文法。",
  "zh-CN": name => "使用" + name + "讲解词义和语法。",
  ja: name => name + "で意味と文法を説明します。",
  ko: name => name + "로 어휘와 문법을 설명합니다.",
};

export const learningSettingsCopy: Record<UiLocale, LearningSettingsCopy> = Object.fromEntries(
  (Object.entries(originalLearningSettingsCopy) as [UiLocale, OriginalLearningSettingsCopy][]).map(
    ([locale, base]) => {
      const names = ADDED_LANGUAGES.map(
        language => [language, learningLanguageName(language, locale)] as const,
      );
      return [
        locale,
        {
          ...base,
          levelHints: {
            ...base.levelHints,
            ...Object.fromEntries(
              names.map(([code, name]) => [code, localizedCEFRHint[locale](name)]),
            ),
          },
          targetDescriptions: {
            ...base.targetDescriptions,
            ...Object.fromEntries(
              names.map(([code, name]) => [code, localizedTargetDescription[locale](name)]),
            ),
          },
          instructionDescriptions: {
            ...base.instructionDescriptions,
            ...Object.fromEntries(
              names.map(([code, name]) => [code, localizedInstructionDescription[locale](name)]),
            ),
          },
          levels: {
            ...base.levels,
            ...Object.fromEntries(ADDED_LANGUAGES.map(code => [code, base.levels.en])),
          },
        },
      ];
    },
  ),
) as Record<UiLocale, LearningSettingsCopy>;

/** Provide the selected language's level scale without listing unrelated exams. */
export function levelHint(
  copy: LearningSettingsCopy,
  language: LearningProfile["targetLanguage"],
): string {
  return copy.levelHints[language] + " " + copy.fieldHints.level;
}
