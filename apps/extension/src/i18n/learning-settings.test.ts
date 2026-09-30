import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { learningSettingsCopy, levelHint, type LearningSettingKey } from "./learning-settings";
import { nativeLanguageName, learningLanguageName, explanationLanguageName } from "./preferences";
import { LEARNING_LANGUAGES, EXPLANATION_LANGUAGES, levelsForTargetLanguage, defaultLevelForTargetLanguage } from "@immersive/core";
import { messages, type UiLocale } from "./messages";
import { SettingInfo } from "../components/setting-info";

const fields: LearningSettingKey[] = [
  "targetLanguage", "level", "instructionLanguage",
  "teachingMode", "sceneCount", "vocabLimit", "exerciseCount",
];
const levels = {
  en: ["A1", "A2", "B1", "B2", "C1", "C2"],
  ja: ["N5", "N4", "N3", "N2", "N1"],
  ko: ["1", "2", "3", "4", "5", "6"],
} as const;
const modes = ["adaptive", "guided", "immersive"] as const;
const locales = Object.keys(messages) as UiLocale[];

test("all five UI locales explain every field and every available dropdown choice", () => {
  assert.deepEqual(Object.keys(learningSettingsCopy).sort(), locales.slice().sort());
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    assert.ok(copy.infoLabel.trim(), locale + " info label");
    for (const field of fields) assert.ok(copy.fieldHints[field].trim(), locale + " " + field);
    for (const language of ["en", "ja", "ko"] as const) {
      assert.ok(copy.targetDescriptions[language].trim(), locale + " target " + language);
      assert.deepEqual(Object.keys(copy.levels[language]), [...levels[language]]);
      for (const level of levels[language]) {
        const option = copy.levels[language][level];
        assert.ok(option.label.trim(), locale + " " + language + " " + level + " label");
        assert.ok(option.description.trim(), locale + " " + language + " " + level + " description");
        assert.notEqual(option.label, level, locale + " " + language + " " + level + " must be understandable");
      }
    }
    for (const language of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
      assert.ok(copy.instructionDescriptions[language].trim(),
        locale + " instruction " + language);
      assert.ok(nativeLanguageName(language).trim());
    }
    for (const mode of modes) {
      assert.ok(copy.modes[mode].label.trim(), locale + " " + mode + " name");
      assert.ok(copy.modes[mode].description.trim(), locale + " " + mode + " help");
      assert.notEqual(copy.modes[mode].label, mode);
    }
  }
});

test("setting help shows only the concise field explanation, without repeating all choices", () => {
  const markup = renderToStaticMarkup(createElement(SettingInfo, {
    label: "Level", infoLabel: "About",
    explanation: "Choose a comfortable starting point.",
  }));
  assert.match(markup, /<details[^>]*class="[^"]*group/);
  assert.match(markup, /<summary[^>]*aria-label="About Level"/);
  assert.match(markup, /aria-controls="/);
  assert.match(markup, /role="note"/);
  assert.match(markup, /Choose a comfortable starting point\./);
  assert.doesNotMatch(markup, /<ul>|<li>|B1 · Intermediate/);
});

test("settings keep stable saved option values rather than persisting translated labels", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /lessonFormat: "contextual-v3"/);
  assert.match(app, /contextualGenerationProfile\(profile\)/);
  assert.doesNotMatch(app, /id="learning-mode"/);
  assert.doesNotMatch(app, /id="learning-exercises"/);
  assert.doesNotMatch(app, /id="learning-vocabulary"/);
  assert.match(app, /LEARNING_LANGUAGES\.map\(language/);
  assert.match(app, /EXPLANATION_LANGUAGES\.map\(value/);
  assert.match(app, /learningLanguageName\(language, uiLocale\)/);
  assert.match(app, /explanationLanguageName\(value, uiLocale\)/);
  assert.match(app, /levelHint\(settingsCopy, profile\.targetLanguage\)/);
  assert.match(app, /settingsCopy.fieldHints.targetLanguage/);
  assert.match(app, /settingsCopy.fieldHints.instructionLanguage/);
  assert.match(app, /t\("lessonLength"\)/);
  assert.match(app, /t\("contextualExamples"\)/);
});

test("task cards use one Tailwind layout below the refresh control", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(app.includes('className="my-[10px] grid gap-[7px]"'), "task layout uses direct Tailwind classes");
  assert.doesNotMatch(css, /\.jobHistoryList\s*\{/);
});

test("navigation uses compact four-column Tailwind utilities", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const classes = app.match(/<nav className="([^"]+)" aria-label=\{t\("navLabel"\)\}/)?.[1] ?? "";
  const button = app.match(/page === "create" \? "([^"]+)"/)?.[1] ?? "";
  assert.ok(classes.includes("grid-cols-4"));
  assert.ok(button.includes("text-[11px]"));
  assert.ok(button.includes("gap-[3px]"));
  assert.ok(button.includes("py-2"));
});

test("the supplied dark tokens and both lesson readers retain Tailwind utilities", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const light = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1];
  const dark = css.match(/^\.dark \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(light && dark, "light and dark theme token blocks must exist");
  assert.match(dark, /--primary:\s*oklch\(0\.6724 0\.1308 38\.7559\)/);
  const legacy = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const contextual = await readFile(new URL("../components/contextual-scene-reader.tsx", import.meta.url), "utf8");
  assert.ok(legacy.includes("grid-cols-3"), "saved V1/V2 study steps retain their layout");
  assert.ok(contextual.includes("border border-border"), "V3 source dialogue remains styled");
  assert.ok(legacy.includes("sticky bottom-0"), "V1/V2 player stays sticky");
  assert.ok(contextual.includes("sticky bottom-0"), "V3 player stays sticky");
  assert.doesNotMatch(css, /^\.scene/m);
});

test("level help follows the selected learning language in every interface locale", async () => {
  const scales = { en: "CEFR", ja: "JLPT", ko: "TOPIK" } as const;
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    for (const language of ["en", "ja", "ko"] as const) {
      const help = levelHint(copy, language);
      assert.ok(help.includes(scales[language]), locale + " " + language + " level scale");
      for (const other of ["en", "ja", "ko"] as const) {
        if (other !== language) assert.ok(!help.includes(scales[other]),
          locale + " " + language + " should not explain " + other);
      }
      assert.ok(help.endsWith(copy.fieldHints.level), locale + " difficulty disclaimer");
      assert.ok(copy.levelHints[language].length > 20, locale + " " + language + " explanation");
    }
  }
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /explanation=\{levelHint\(settingsCopy, profile\.targetLanguage\)\}/);
  assert.match(app, /defaultLevelForTargetLanguage\(language\)/);
  assert.match(app, /onValueChange=\{chooseLearningLanguage\}/);
});

test("each interface locale declares exactly one levelHints block in its own language", async () => {
  const source = await readFile(new URL("./learning-settings.ts", import.meta.url), "utf8");
  const headers = [...source.matchAll(/^  "(en|zh-TW|zh-CN|ja|ko)": \{$/gm)];
  assert.deepEqual(headers.map(match => match[1]), ["en", "zh-TW", "zh-CN", "ja", "ko"]);
  const localeStarts = {
    en: "English uses",
    "zh-TW": "英文使用",
    "zh-CN": "英语使用",
    ja: "英語は",
    ko: "영어는",
  };
  for (let index = 0; index < headers.length; index++) {
    const locale = headers[index][1] as UiLocale;
    const section = source.slice(headers[index].index,
      headers[index + 1]?.index ?? source.indexOf("\n};", headers[index].index));
    assert.equal([...section.matchAll(/^    "levelHints": \{/gm)].length, 1,
      locale + " must declare levelHints exactly once");
    assert.ok(learningSettingsCopy[locale].levelHints.en.startsWith(localeStarts[locale]),
      locale + " must use its own localized level explanation");
  }
});


test("level tooltip displays the complete scale for the selected language in every UI locale", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(app, /items=\{levelOptions\.map\(value => \{/);
  assert.match(app, /settingsCopy\.levels\[profile\.targetLanguage\]\[value\]/);
  const infoSource = await readFile(new URL("../components/setting-info.tsx", import.meta.url), "utf8");
  assert.ok(infoSource.includes('className="mt-[10px] grid'));
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    for (const language of ["en", "ja", "ko"] as const) {
      const items = levels[language].map(value => ({
        value,
        label: copy.levels[language][value].label,
        description: copy.levels[language][value].description,
      }));
      const html = renderToStaticMarkup(createElement(SettingInfo, {
        label: "Level",
        infoLabel: copy.infoLabel,
        explanation: levelHint(copy, language),
        items,
      }));
      assert.match(html, /<ul[^>]*class="[^"]*grid/);
      assert.equal((html.match(/<li>/g) ?? []).length, items.length,
        locale + " " + language + ": one entry per level");
      for (const item of items) {
        assert.ok(html.includes(item.value + " · " + item.label),
          locale + " " + language + ": label for " + item.value);
        assert.ok(html.includes(item.description),
          locale + " " + language + ": description for " + item.value);
      }
    }
  }
});

test("all twelve learning languages have localized names, levels and help without changing interface language", () => {
  const added = ["es", "fr", "de", "it", "pt", "id", "th", "ms", "vi"] as const;
  assert.deepEqual(LEARNING_LANGUAGES, ["en", "ja", "ko", ...added]);
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    for (const language of LEARNING_LANGUAGES) {
      assert.ok(learningLanguageName(language, locale).trim(), locale + " " + language);
      assert.ok(copy.levelHints[language].trim(), locale + " " + language + " hint");
      assert.ok(copy.targetDescriptions[language].trim(), locale + " " + language + " target");
      const options = levelsForTargetLanguage(language);
      assert.deepEqual(Object.keys(copy.levels[language]), [...options]);
      for (const level of options) {
        assert.ok(copy.levels[language][level].label && copy.levels[language][level].description);
      }
      assert.ok(options.includes(defaultLevelForTargetLanguage(language)));
    }
    for (const language of EXPLANATION_LANGUAGES) {
      assert.ok(explanationLanguageName(language, locale).trim(), locale + " " + language + " name");
      assert.ok(copy.instructionDescriptions[language].trim(), locale + " " + language + " explanation");
    }
    for (const language of added) {
      assert.match(levelHint(copy, language), /CEFR/);
      assert.deepEqual(Object.keys(copy.levels[language]), ["A1", "A2", "B1", "B2", "C1", "C2"]);
    }
  }
});


test("setting help is label-aligned and does not repeat general explanations below selects", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const help = await readFile(new URL("../components/setting-info.tsx", import.meta.url), "utf8");
  for (const id of ["learning-target", "learning-level", "learning-length", "contextual-examples", "learning-explanation-language", "ui-language-select", "appearance-select"]) {
    assert.ok(app.includes('htmlFor="' + id + '"'), id + " must have a real label");
  }
  for (const key of ["lessonLengthHint", "contextualExamplesHint", "uiLanguageHint", "appearanceHint"]) {
    assert.ok(app.includes('explanation={t("' + key + '")}'), key + " belongs in info help");
    assert.ok(!app.includes('>{t("' + key + '")}</p>'), key + " must not be duplicated under the select");
  }
  assert.ok(app.includes('relative mb-[6px] flex min-w-0 items-center gap-2'));
  assert.ok(help.includes('className="group m-0 inline-flex size-7'), "info details have no inherited section margins");
  assert.ok(help.includes("trigger.getBoundingClientRect()") && help.includes("window.innerWidth - width - margin"),
    "popover follows its own icon and stays inside the viewport");
  assert.ok(help.includes('focus-visible:outline-2'), "info trigger supports visible keyboard focus");
  assert.ok(help.includes('event.key !== "Escape"') && help.includes('document.addEventListener("pointerdown"'),
    "Escape and outside-click close the native details");
});
