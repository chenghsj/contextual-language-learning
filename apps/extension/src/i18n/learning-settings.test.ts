import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  learningSettingsCopy,
  levelHint,
  learningLevelLabel,
  type LearningSettingKey,
} from "./learning-settings";
import {
  nativeLanguageName,
  learningLanguageName,
  explanationLanguageName,
  learningLanguageOptions,
} from "./preferences";
import {
  LEARNING_LANGUAGES,
  EXPLANATION_LANGUAGES,
  levelsForTargetLanguage,
  defaultLevelForTargetLanguage,
  UNRESTRICTED_LEVEL,
} from "@contextual/core";
import { messages, type UiLocale } from "./messages";
import { SettingInfo } from "../components/setting-info";

const fields: LearningSettingKey[] = [
  "targetLanguage",
  "level",
  "instructionLanguage",
  "sceneCount",
];
const levels = {
  en: ["A1", "A2", "B1", "B2", "C1", "C2", UNRESTRICTED_LEVEL],
  ja: ["N5", "N4", "N3", "N2", "N1", UNRESTRICTED_LEVEL],
  ko: ["1", "2", "3", "4", "5", "6", UNRESTRICTED_LEVEL],
} as const;
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
        assert.ok(
          option.description.trim(),
          locale + " " + language + " " + level + " description",
        );
        assert.notEqual(
          option.label,
          level,
          locale + " " + language + " " + level + " must be understandable",
        );
      }
    }
    for (const language of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
      assert.ok(copy.instructionDescriptions[language].trim(), locale + " instruction " + language);
      assert.ok(nativeLanguageName(language).trim());
    }
  }
});

test("setting help shows only the concise field explanation, without repeating all choices", () => {
  const markup = renderToStaticMarkup(
    createElement(SettingInfo, {
      label: "Level",
      infoLabel: "About",
      explanation: "Choose a comfortable starting point.",
    }),
  );
  assert.match(markup, /aria-label="About Level"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /<ul>|<li>|B1 · Intermediate/);
});

test("settings keep stable saved option values rather than persisting translated labels", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  assert.doesNotMatch(app, /lessonFormat:/);
  assert.doesNotMatch(app, /id="learning-mode"/);
  assert.doesNotMatch(app, /id="learning-exercises"/);
  assert.doesNotMatch(app, /id="learning-vocabulary"/);
  // Subtitle availability adds descriptions without replacing stable language IDs or labels.
  assert.match(app, /options=\{learningLanguageOptions\(uiLocale\)\.map\(option => \(\{/);
  assert.match(
    app,
    /\.\.\.option, description: subtitleReaderBlocked \? undefined : subtitleTrackLabel\(option\.value\)/,
  );
  for (const locale of locales) {
    const options = learningLanguageOptions(locale);
    assert.deepEqual(options.map(option => option.value).sort(), [...LEARNING_LANGUAGES].sort());
    for (const option of options) {
      assert.equal(option.label, learningLanguageName(option.value, locale));
    }
  }
  assert.match(app, /<SearchableSelectField id="learning-explanation-language"/);
  assert.match(app, /explanationLanguageName\(option\.value, uiLocale\)/);
  assert.match(app, /levelHint\(settingsCopy, profile\.targetLanguage, profile\.level\)/);
  assert.match(app, /settingsCopy.fieldHints.targetLanguage/);
  assert.match(app, /settingsCopy.fieldHints.instructionLanguage/);
  assert.match(app, /t\("lessonLength"\)/);
  assert.doesNotMatch(app, /id="contextual-examples"|<ExplanationSettings/);
});

test("task cards use one Tailwind layout below the refresh control", async () => {
  const history = await readSource(new URL("../components/task-history.tsx", import.meta.url));
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(
    history.includes('className="my-3 grid gap-1"'),
    "task layout uses the product's 4px spacing step rather than a separate 7px gap",
  );
  assert.doesNotMatch(css, /\.jobHistoryList\s*\{/);
});

test("navigation uses two primary page buttons", async () => {
  const nav = await readSource(new URL("../components/side-panel-navigation.tsx", import.meta.url));
  assert.match(nav, /<nav[^>]*aria-label/);
  assert.match(nav, /<Button variant="ghost" size="sm"/);
  assert.match(nav, /aria-current=\{active === id \? "page" : undefined\}/);
  assert.doesNotMatch(nav, /<TabsTrigger/);
});

test("the supplied dark tokens and V5 reader retain Tailwind utilities", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const light = css.match(/^:root \{([\s\S]*?)^\}/m)?.[1];
  const dark = css.match(/^\.dark \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(light && dark, "light and dark theme token blocks must exist");
  assert.match(dark, /--primary:\s*oklch\(0\.6724 0\.1308 38\.7559\)/);
  const contextual = await readSource(
    new URL("../components/contextual-scene-reader.tsx", import.meta.url),
  );
  assert.ok(contextual.includes("border border-border"), "V5 source dialogue remains styled");
  assert.ok(
    contextual.includes('data-ui="unifiedPlayer"') && contextual.includes("shrink-0 border-t"),
    "player stays outside the scroll area",
  );
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
        if (other !== language)
          assert.ok(
            !help.includes(scales[other]),
            locale + " " + language + " should not explain " + other,
          );
      }
      assert.ok(help.endsWith(copy.fieldHints.level), locale + " difficulty disclaimer");
      assert.ok(copy.levelHints[language].length > 20, locale + " " + language + " explanation");
    }
  }
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  assert.match(
    app,
    /explanation=\{levelHint\(settingsCopy, profile\.targetLanguage, profile\.level\)\}/,
  );
  assert.match(app, /defaultLevelForTargetLanguage\(language\)/);
  assert.match(app, /onValueChange=\{chooseLearningLanguage\}/);
});

test("each interface locale uses its own level explanation", () => {
  const localeStarts = {
    en: "English uses",
    "zh-TW": "英文使用",
    "zh-CN": "英语使用",
    ja: "英語は",
    ko: "영어는",
  };
  for (const locale of locales) {
    assert.ok(learningSettingsCopy[locale].levelHints.en.startsWith(localeStarts[locale]), locale);
  }
});

test("level tooltip displays the complete scale for the selected language in every UI locale", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(app, /items=\{levelOptions\.map\(value => \{/);
  assert.match(app, /settingsCopy\.levels\[profile\.targetLanguage\]\[value\]/);
  const infoSource = await readSource(new URL("../components/setting-info.tsx", import.meta.url));
  assert.ok(infoSource.includes("items.map(item"));
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    for (const language of ["en", "ja", "ko"] as const) {
      const items = levels[language].map(value => ({
        value,
        label: copy.levels[language][value].label,
        description: copy.levels[language][value].description,
      }));
      const html = renderToStaticMarkup(
        createElement(SettingInfo, {
          label: "Level",
          infoLabel: copy.infoLabel,
          explanation: levelHint(copy, language),
          items,
        }),
      );
      assert.match(html, /aria-expanded="false"/);
      for (const item of items) {
        assert.ok(
          item.label && item.description,
          locale + " " + language + ": localized level " + item.value,
        );
      }
    }
  }
});

test("all fourteen learning languages have localized names, levels and help without changing interface language", () => {
  const added = ["es", "fr", "de", "it", "pt", "id", "th", "ms", "vi", "zh-TW", "zh-CN"] as const;
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
      assert.ok(
        explanationLanguageName(language, locale).trim(),
        locale + " " + language + " name",
      );
      assert.ok(
        copy.instructionDescriptions[language].trim(),
        locale + " " + language + " explanation",
      );
    }
    for (const language of added) {
      assert.match(levelHint(copy, language), /CEFR/);
      assert.deepEqual(Object.keys(copy.levels[language]), [
        "A1",
        "A2",
        "B1",
        "B2",
        "C1",
        "C2",
        UNRESTRICTED_LEVEL,
      ]);
    }
  }
});

test("unrestricted labels and help are localized without exposing the saved option ID", () => {
  for (const locale of locales) {
    const copy = learningSettingsCopy[locale];
    for (const language of LEARNING_LANGUAGES) {
      const option = copy.levels[language][UNRESTRICTED_LEVEL];
      assert.equal(learningLevelLabel(locale, UNRESTRICTED_LEVEL), option.label);
      assert.equal(levelHint(copy, language, UNRESTRICTED_LEVEL), option.description);
      assert.doesNotMatch(option.description, /CEFR|JLPT|TOPIK/);
      const html = renderToStaticMarkup(
        createElement(SettingInfo, {
          label: "Level",
          infoLabel: copy.infoLabel,
          explanation: levelHint(copy, language, UNRESTRICTED_LEVEL),
          items: [{ value: UNRESTRICTED_LEVEL, valueLabel: "", ...option }],
        }),
      );
      assert.doesNotMatch(html, /unrestricted ·/);
    }
    assert.equal(learningLevelLabel(locale, "N3"), "N3");
  }
});

test("learning help is label-aligned without duplicating explanations below each control", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const help = await readSource(new URL("../components/setting-info.tsx", import.meta.url));
  for (const id of [
    "learning-target",
    "learning-level",
    "learning-length",
    "learning-explanation-language",
  ]) {
    assert.ok(app.includes('htmlFor="' + id + '"'), id + " must have a real label");
  }
  for (const key of ["lessonLengthHint"]) {
    assert.ok(app.includes('explanation={t("' + key + '")}'), key + " belongs in info help");
    assert.ok(
      !app.includes('>{t("' + key + '")}</p>'),
      key + " must not be duplicated under the select",
    );
  }
  assert.ok(app.includes("relative mb-[6px] flex min-w-0 items-center gap-2"));
  assert.ok(help.includes('<Button variant="ghost" size="icon"'));
  assert.ok(help.includes("<PopoverContent collisionPadding={8}"));
  assert.ok(help.includes("max-w-[calc(100vw-16px)]"));
});
