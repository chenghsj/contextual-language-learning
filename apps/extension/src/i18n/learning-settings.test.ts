import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { learningSettingsCopy, levelHint, type LearningSettingKey } from "./learning-settings";
import { nativeLanguageName } from "./preferences";
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
  assert.match(markup, /<details[^>]*class="settingInfo"/);
  assert.match(markup, /<summary[^>]*aria-label="About Level"/);
  assert.match(markup, /aria-controls="/);
  assert.match(markup, /role="note"/);
  assert.match(markup, /Choose a comfortable starting point\./);
  assert.doesNotMatch(markup, /<ul>|<li>|B1 · Intermediate/);
});

test("settings keep stable saved option values rather than persisting translated labels", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  for (const mode of modes) assert.ok(app.includes('value: "' + mode + '"'));
  for (const language of ["en", "ja", "ko"] as const) {
    assert.ok(app.includes('value: "' + language + '"') || app.includes('["zh-TW", "zh-CN", "en", "ja", "ko"]'));
  }
  for (const field of fields) {
    if (field === "level") {
      assert.match(app, /levelHint\(settingsCopy, profile\.targetLanguage\)/);
    } else {
      assert.ok(app.includes('settingsCopy.fieldHints.' + field), "missing help for " + field);
    }
  }
});

test("task cards start below the refresh control with consistent spacing", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(app, /className="jobHistoryList"/);
  assert.match(css, /\.jobHistoryList\s*\{[^}]*margin-top:\s*12px/);
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
  assert.match(app, /targetLanguage, level: targetLanguage === "en" \? "B1" : targetLanguage === "ja" \? "N4" : "2"/);
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
  assert.match(css, /\.settingInfoLevels \{[^}]*display: grid/);
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
      assert.match(html, /class="settingInfoLevels"/);
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
