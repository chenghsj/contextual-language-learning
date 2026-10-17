import type { UiLocale } from "./messages";
import type { LearningLanguage } from "@contextual/core";
import { learningLanguageName } from "./preferences";

/** Compact reader controls retain full language names in the menu and accessible label. */
export function selectionSpeechLanguageName(language: LearningLanguage, locale: UiLocale) {
  if (locale === "en") return language.toUpperCase();
  const chinese = {
    "zh-TW": { "zh-TW": "繁中", "zh-CN": "簡中" },
    "zh-CN": { "zh-TW": "繁中", "zh-CN": "简中" },
    ja: { "zh-TW": "繁体", "zh-CN": "簡体" },
    ko: { "zh-TW": "번체", "zh-CN": "간체" },
  };
  if (language === "zh-TW" || language === "zh-CN") return chinese[locale][language];
  if (locale === "zh-TW" || locale === "zh-CN") {
    const short = {
      "zh-TW": { es: "西語", it: "義語", pt: "葡語" },
      "zh-CN": { es: "西语", it: "意语", pt: "葡语" },
    };
    if (language === "es" || language === "it" || language === "pt") return short[locale][language];
  }
  return learningLanguageName(language, locale);
}

export function selectionSpeechCopy(locale: UiLocale) {
  return {
    automatic: { en: "Auto", "zh-TW": "自動", "zh-CN": "自动", ja: "自動", ko: "자동" }[locale],
    automaticLanguage: {
      en: "Detect automatically",
      "zh-TW": "自動偵測",
      "zh-CN": "自动识别",
      ja: "自動判定",
      ko: "자동 감지",
    }[locale],
    detectingLanguage: {
      en: "Detecting…",
      "zh-TW": "辨識中…",
      "zh-CN": "识别中…",
      ja: "判定中…",
      ko: "감지 중…",
    }[locale],
    chooseLanguage: {
      en: "Choose language",
      "zh-TW": "選擇語言",
      "zh-CN": "选择语言",
      ja: "言語を選択",
      ko: "언어 선택",
    }[locale],
    selectedOriginal: {
      en: "Read selected original",
      "zh-TW": "朗讀選取原文",
      "zh-CN": "朗读选取原文",
      ja: "選択した原文を読み上げ",
      ko: "선택한 원문 읽기",
    }[locale],
    selectionHint: {
      en: "Select an original word or sentence to read aloud.",
      "zh-TW": "選取原文詞語或句子後即可朗讀。",
      "zh-CN": "选取原文词语或句子后即可朗读。",
      ja: "原文の単語や文を選択して読み上げます。",
      ko: "원문의 단어나 문장을 선택하여 읽어 주세요.",
    }[locale],
  };
}
