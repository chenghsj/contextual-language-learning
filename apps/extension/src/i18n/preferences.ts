import type { UiLocale } from "./messages";
import {
  LEARNING_LANGUAGES,
  type LearningLanguage,
  type ExplanationLanguage,
} from "@contextual/core";

export type LocalePreference = UiLocale | "auto";

/** Display each language in its own writing system, independent of UI locale. */
export const NATIVE_LANGUAGE_LABELS: Readonly<Record<UiLocale, string>> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
};
export function nativeLanguageName(locale: UiLocale): string {
  return NATIVE_LANGUAGE_LABELS[locale];
}

/** Study/explanation selectors use the active interface language, not endonyms or system locale. */
export const LEARNING_LANGUAGE_LABELS: Readonly<
  Record<UiLocale, Readonly<Record<LearningLanguage, string>>>
> = {
  en: {
    "zh-TW": "Chinese (Traditional)",
    "zh-CN": "Chinese (Simplified)",
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
  },
  "zh-TW": {
    "zh-TW": "中文（繁體）",
    "zh-CN": "中文（簡體）",
    en: "英語",
    ja: "日語",
    ko: "韓語",
    es: "西班牙語",
    fr: "法語",
    de: "德語",
    it: "義大利語",
    pt: "葡萄牙語",
    id: "印尼語",
    th: "泰語",
    ms: "馬來語",
    vi: "越南語",
  },
  "zh-CN": {
    "zh-TW": "中文（繁体）",
    "zh-CN": "中文（简体）",
    en: "英语",
    ja: "日语",
    ko: "韩语",
    es: "西班牙语",
    fr: "法语",
    de: "德语",
    it: "意大利语",
    pt: "葡萄牙语",
    id: "印尼语",
    th: "泰语",
    ms: "马来语",
    vi: "越南语",
  },
  ja: {
    "zh-TW": "中国語（繁体字）",
    "zh-CN": "中国語（簡体字）",
    en: "英語",
    ja: "日本語",
    ko: "韓国語",
    es: "スペイン語",
    fr: "フランス語",
    de: "ドイツ語",
    it: "イタリア語",
    pt: "ポルトガル語",
    id: "インドネシア語",
    th: "タイ語",
    ms: "マレー語",
    vi: "ベトナム語",
  },
  ko: {
    "zh-TW": "중국어 (번체)",
    "zh-CN": "중국어 (간체)",
    en: "영어",
    ja: "일본어",
    ko: "한국어",
    es: "스페인어",
    fr: "프랑스어",
    de: "독일어",
    it: "이탈리아어",
    pt: "포르투갈어",
    id: "인도네시아어",
    th: "태국어",
    ms: "말레이어",
    vi: "베트남어",
  },
};
const CHINESE_EXPLANATION_LABELS: Readonly<
  Record<UiLocale, Readonly<Record<"zh-TW" | "zh-CN", string>>>
> = {
  en: { "zh-TW": "Traditional Chinese", "zh-CN": "Simplified Chinese" },
  "zh-TW": { "zh-TW": "繁體中文", "zh-CN": "簡體中文" },
  "zh-CN": { "zh-TW": "繁体中文", "zh-CN": "简体中文" },
  ja: { "zh-TW": "繁体字中国語", "zh-CN": "簡体字中国語" },
  ko: { "zh-TW": "번체 중국어", "zh-CN": "간체 중국어" },
};
export function learningLanguageName(language: LearningLanguage, locale: UiLocale): string {
  return LEARNING_LANGUAGE_LABELS[locale][language];
}
export const LEARNING_LANGUAGE_SEARCH_COPY: Readonly<
  Record<UiLocale, { search: string; empty: string }>
> = {
  en: { search: "Search languages", empty: "No matching languages" },
  "zh-TW": { search: "搜尋語言", empty: "找不到符合的語言" },
  "zh-CN": { search: "搜索语言", empty: "找不到符合的语言" },
  ja: { search: "言語を検索", empty: "一致する言語がありません" },
  ko: { search: "언어 검색", empty: "일치하는 언어가 없습니다" },
};

export function learningLanguageOptions(locale: UiLocale) {
  const collator = new Intl.Collator(locale);
  return LEARNING_LANGUAGES.map(language => ({
    value: language,
    label: learningLanguageName(language, locale),
    keywords: Object.values(LEARNING_LANGUAGE_LABELS).map(names => names[language]),
  })).sort((a, b) => collator.compare(a.label, b.label) || a.value.localeCompare(b.value));
}
export function explanationLanguageName(language: ExplanationLanguage, locale: UiLocale): string {
  return language === "zh-TW" || language === "zh-CN"
    ? CHINESE_EXPLANATION_LABELS[locale][language]
    : learningLanguageName(language, locale);
}
export type ThemePreference = "system" | "light" | "dark";
export type AppliedTheme = "light" | "dark";

export function localeFromBrowser(language: string | undefined): UiLocale {
  const value = (language ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (value === "ja" || value.startsWith("ja-")) return "ja";
  if (value === "ko" || value.startsWith("ko-")) return "ko";
  if (value === "zh" || value.startsWith("zh-")) {
    if (/(?:^|-)hant(?:-|$)|(?:^|-)(tw|hk|mo)(?:-|$)/.test(value)) return "zh-TW";
    return "zh-CN";
  }
  return "en";
}

export function getBrowserLocale(): UiLocale {
  const chromeLanguage = typeof chrome === "undefined" ? undefined : chrome.i18n?.getUILanguage?.();
  const fallback =
    typeof navigator === "undefined" ? undefined : (navigator.languages?.[0] ?? navigator.language);
  return localeFromBrowser(chromeLanguage || fallback);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return (
    value === "auto" ||
    value === "en" ||
    value === "zh-TW" ||
    value === "zh-CN" ||
    value === "ja" ||
    value === "ko"
  );
}
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): AppliedTheme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}
