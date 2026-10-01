/** Learning languages are independent of the extension's interface languages. */
export const LEARNING_LANGUAGES = [
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "id",
  "th",
  "ms",
  "vi",
] as const;
export type LearningLanguage = (typeof LEARNING_LANGUAGES)[number];

export const EXPLANATION_LANGUAGES = ["zh-TW", "zh-CN", ...LEARNING_LANGUAGES] as const;
export type ExplanationLanguage = (typeof EXPLANATION_LANGUAGES)[number];

export const CEFR_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "id", "th", "ms", "vi"] as const;
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export const TOPIK_LEVELS = ["1", "2", "3", "4", "5", "6"] as const;

/** CEFR languages share levels; Japanese and Korean retain their own scales. */
export function levelsForTargetLanguage(language: LearningLanguage): readonly string[] {
  return language === "ja" ? JLPT_LEVELS : language === "ko" ? TOPIK_LEVELS : CEFR_LEVELS;
}

export function defaultLevelForTargetLanguage(language: LearningLanguage): string {
  return language === "ja" ? "N4" : language === "ko" ? "2" : "B1";
}

/** English names are used only in Agent prompts; user-facing names follow the interface locale. */
export const ENGLISH_LANGUAGE_NAMES: Readonly<Record<ExplanationLanguage, string>> = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  id: "Indonesian",
  th: "Thai",
  ms: "Malay",
  vi: "Vietnamese",
  "zh-TW": "Traditional Chinese",
  "zh-CN": "Simplified Chinese",
};
