import type { UiLocale } from "./messages";

export type LocalePreference = UiLocale | "auto";
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
  const fallback = typeof navigator === "undefined" ? undefined : navigator.languages?.[0] ?? navigator.language;
  return localeFromBrowser(chromeLanguage || fallback);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || value === "en" || value === "zh-TW" ||
    value === "zh-CN" || value === "ja" || value === "ko";
}
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): AppliedTheme {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}
