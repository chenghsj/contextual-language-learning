import { LEARNING_LANGUAGES, type LearningLanguage } from "@contextual/core";

export type ReadingSelection = {
  text: string;
  context: string;
  reading: string;
  languageHint?: string;
};
type Detection = { isReliable: boolean; languages: { language: string; percentage: number }[] };
type Detect = (text: string) => Promise<Detection>;

function scriptLanguage(text: string): LearningLanguage | undefined {
  const letters = [...text.matchAll(/\p{Letter}/gu)].length;
  const kana = [...text.matchAll(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)].length;
  const hangul = [...text.matchAll(/\p{Script=Hangul}/gu)].length;
  const thai = [...text.matchAll(/\p{Script=Thai}/gu)].length;
  if (kana && !hangul && !thai && kana / letters >= 0.25) return "ja";
  if (hangul && !kana && !thai && hangul / letters >= 0.5) return "ko";
  if (thai && !kana && !hangul && thai / letters >= 0.5) return "th";
  return undefined;
}

function confidentLanguage(result: Detection, chinese: "zh-TW" | "zh-CN") {
  const candidates = [...result.languages].sort((a, b) => b.percentage - a.percentage);
  const top = candidates[0];
  if (
    !result.isReliable ||
    !top ||
    top.percentage < 80 ||
    top.percentage - (candidates[1]?.percentage ?? 0) < 20
  )
    return undefined;
  const tag = top.language.toLowerCase().replaceAll("_", "-");
  const language =
    tag === "zh"
      ? chinese
      : /^zh-(tw|hant)/.test(tag)
        ? "zh-TW"
        : /^zh-(cn|hans)/.test(tag)
          ? "zh-CN"
          : tag.split("-")[0];
  return LEARNING_LANGUAGES.find(item => item === language);
}

/** Local detection, with explicit ruby readings and nearby prose for ambiguous short words. */
export async function detectSelectionLanguage(
  selection: ReadingSelection,
  chinese: "zh-TW" | "zh-CN",
  detect: Detect = text => chrome.i18n.detectLanguage(text),
): Promise<LearningLanguage | undefined> {
  const text = selection.text.trim();
  if (!/\p{Letter}/u.test(text)) return undefined;
  const annotatedLanguage = LEARNING_LANGUAGES.find(
    language => language === selection.languageHint,
  );
  if (annotatedLanguage) return annotatedLanguage;
  const script = scriptLanguage(text);
  if (script) return script;
  const hanOnly = /^[\p{Script=Han}\p{Punctuation}\p{Number}\s]+$/u.test(text);
  if (hanOnly && scriptLanguage(selection.reading) === "ja") return "ja";
  const fromDetector = async (value: string) => {
    try {
      return confidentLanguage(await detect(value.slice(0, 4096)), chinese);
    } catch {
      return undefined;
    }
  };
  // Kanji-only terms and very short Latin words need their own local context first.
  if ((hanOnly || [...text].length <= 5) && selection.context.trim() !== text) {
    const contextLanguage = await fromDetector(selection.context);
    if (contextLanguage && (!hanOnly || ["ja", "ko", "zh-TW", "zh-CN"].includes(contextLanguage)))
      return contextLanguage;
  }
  return fromDetector(text);
}
