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
  for (const mode of modes) assert.match(app, new RegExp('value="' + mode + '"'));
  for (const language of ["en", "ja", "ko"] as const) {
    assert.match(app, new RegExp('value="' + language + '"'));
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
