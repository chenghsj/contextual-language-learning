import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { translate, type UiLocale } from "../i18n/messages";
import {
  isLocalePreference,
  isThemePreference,
  nativeLanguageName,
  type LocalePreference,
  type ThemePreference,
} from "../i18n/preferences";

/** Controlled interface preferences; values stay independent of their translated labels. */
export function AppearancePreferences({
  locale,
  browserLocale,
  localePreference,
  themePreference,
  onLocale,
  onTheme,
}: {
  locale: UiLocale;
  browserLocale: UiLocale;
  localePreference: LocalePreference;
  themePreference: ThemePreference;
  onLocale: (value: LocalePreference) => void;
  onTheme: (value: ThemePreference) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <label
            className="m-0 min-w-0 text-xs font-semibold leading-5"
            htmlFor="ui-language-select"
          >
            {t("uiLanguage")}
          </label>
        </div>
        <Select
          value={localePreference}
          onValueChange={next => {
            if (isLocalePreference(next)) onLocale(next);
          }}
        >
          <SelectTrigger
            id="ui-language-select"
            aria-label={t("uiLanguage")}
            aria-describedby="ui-language-hint"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {t("browserLanguage")} · {nativeLanguageName(browserLocale)}
            </SelectItem>
            <SelectItem value="en">{nativeLanguageName("en")}</SelectItem>
            <SelectItem value="zh-TW">{nativeLanguageName("zh-TW")}</SelectItem>
            <SelectItem value="zh-CN">{nativeLanguageName("zh-CN")}</SelectItem>
            <SelectItem value="ja">{nativeLanguageName("ja")}</SelectItem>
            <SelectItem value="ko">{nativeLanguageName("ko")}</SelectItem>
          </SelectContent>
        </Select>
        <p id="ui-language-hint" className="mt-2 text-xs text-muted-foreground">
          {t("uiLanguageHint")}
        </p>
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <label
            className="m-0 min-w-0 text-xs font-semibold leading-5"
            htmlFor="appearance-select"
          >
            {t("appearance")}
          </label>
        </div>
        <Select
          value={themePreference}
          onValueChange={next => {
            if (isThemePreference(next)) onTheme(next);
          }}
        >
          <SelectTrigger id="appearance-select" aria-label={t("appearance")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t("themeSystem")}</SelectItem>
            <SelectItem value="light">{t("themeLight")}</SelectItem>
            <SelectItem value="dark">{t("themeDark")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
