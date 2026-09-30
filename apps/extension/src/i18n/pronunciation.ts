import type { LearningLanguage } from "@immersive/core";
import type { UiLocale } from "./messages";
import type { PronunciationMode } from "../components/pronunciation";

const labels = {
  "zh-TW": { title: "發音標註", kana: "假名", actual: "實際讀音", roman: "羅馬字", zhuyin: "臺灣注音", ipa: "IPA", off: "關閉", approximate: "實驗性近似讀音" },
  "zh-CN": { title: "发音标注", kana: "假名", actual: "实际读音", roman: "罗马字", zhuyin: "台湾注音", ipa: "IPA", off: "关闭", approximate: "实验性近似读音" },
  en: { title: "Pronunciation", kana: "Kana", actual: "Actual reading", roman: "Romanization", zhuyin: "Taiwan Zhuyin", ipa: "IPA", off: "Off", approximate: "Experimental approximate reading" },
  ja: { title: "発音表示", kana: "仮名", actual: "実際の読み", roman: "ローマ字", zhuyin: "台湾注音", ipa: "IPA", off: "オフ", approximate: "実験的な近似読み" },
  ko: { title: "발음 표기", kana: "가나", actual: "실제 발음", roman: "로마자", zhuyin: "대만 주음", ipa: "IPA", off: "끄기", approximate: "실험적인 근사 발음" },
} as const;

export function pronunciationCopy(locale: UiLocale, language: LearningLanguage) {
  const copy = labels[locale];
  return {
    ...copy,
    option(mode: PronunciationMode): string {
      return mode === "native" ? language === "ja" ? copy.kana : copy.actual : copy[mode];
    },
  };
}
