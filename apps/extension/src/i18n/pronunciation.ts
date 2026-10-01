import type { LearningLanguage } from "@immersive/core";
import type { UiLocale } from "./messages";
import type { PronunciationMode } from "../components/pronunciation";

const labels = {
  "zh-TW": { title: "發音標註", kana: "假名", actual: "實際讀音", roman: "羅馬字", ipa: "IPA", off: "關閉", placement: "讀音會顯示在有標註的原字幕與例句旁。", unavailable: "本場景沒有已儲存的發音標註；切換選項不會產生讀音。" },
  "zh-CN": { title: "发音标注", kana: "假名", actual: "实际读音", roman: "罗马字", ipa: "IPA", off: "关闭", placement: "读音会显示在有标注的原字幕与例句旁。", unavailable: "本场景没有已保存的发音标注；切换选项不会生成读音。" },
  en: { title: "Pronunciation", kana: "Kana", actual: "Actual reading", roman: "Romanization", ipa: "IPA", off: "Off", placement: "Readings appear with annotated source subtitles and example lines.", unavailable: "This scene has no saved pronunciation annotations; switching modes cannot generate them." },
  ja: { title: "発音表示", kana: "仮名", actual: "実際の読み", roman: "ローマ字", ipa: "IPA", off: "オフ", placement: "読みは注釈のある元字幕と例文に表示されます。", unavailable: "この場面には保存済みの発音注釈がありません。表示を切り替えても読みは生成されません。" },
  ko: { title: "발음 표기", kana: "가나", actual: "실제 발음", roman: "로마자", ipa: "IPA", off: "끄기", placement: "발음은 표기가 저장된 원본 자막과 예문에 표시됩니다.", unavailable: "이 장면에는 저장된 발음 표기가 없습니다. 표시 방식을 바꿔도 발음이 생성되지는 않습니다." },
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
