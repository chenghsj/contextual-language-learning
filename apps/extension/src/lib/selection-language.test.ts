import assert from "node:assert/strict";
import test from "node:test";
import { detectSelectionLanguage } from "./selection-language";

const selection = (text: string, context = text, reading = "") => ({ text, context, reading });
const reliable = (language: string) => async () => ({
  isReliable: true,
  languages: [{ language, percentage: 99 }],
});

test("selected scripts and explicit kana readings identify Japanese, Korean and Thai locally", async () => {
  const unavailable = async () => {
    throw new Error("No detector");
  };
  for (const [text, language] of [
    ["学校に行きます。", "ja"],
    ["안녕하세요", "ko"],
    ["สวัสดี", "th"],
  ]) {
    assert.equal(await detectSelectionLanguage(selection(text), "zh-TW", unavailable), language);
  }
  assert.equal(
    await detectSelectionLanguage(
      selection("漫研", "1. 漫研manken", "まんけん"),
      "zh-TW",
      reliable("zh"),
    ),
    "ja",
  );
});

test("short kanji and Latin words use their paragraph, not the whole document's language", async () => {
  const contexts: string[] = [];
  assert.equal(
    await detectSelectionLanguage(selection("学校", "学校に行きます。"), "zh-TW", async text => {
      contexts.push(text);
      return { isReliable: true, languages: [{ language: "ja", percentage: 95 }] };
    }),
    "ja",
  );
  assert.deepEqual(contexts, ["学校に行きます。"]);
  assert.equal(
    await detectSelectionLanguage(
      selection("no", "No quiero ir a la escuela."),
      "zh-TW",
      reliable("es"),
    ),
    "es",
  );
  assert.equal(
    await detectSelectionLanguage(
      selection("這個詞語「わ」在此用來表示主題。"),
      "zh-TW",
      reliable("zh"),
    ),
    "zh-TW",
  );
  assert.equal(
    await detectSelectionLanguage(
      selection("Bonjour, comment allez-vous aujourd'hui?"),
      "zh-TW",
      reliable("fr"),
    ),
    "fr",
  );
});

test("uncertain or unsupported results require a manual language instead of defaulting to English", async () => {
  for (const result of [
    { isReliable: false, languages: [{ language: "en", percentage: 100 }] },
    {
      isReliable: true,
      languages: [
        { language: "en", percentage: 55 },
        { language: "fr", percentage: 45 },
      ],
    },
    { isReliable: true, languages: [{ language: "ru", percentage: 100 }] },
  ])
    assert.equal(
      await detectSelectionLanguage(selection("ambiguous word"), "zh-TW", async () => result),
      undefined,
    );
  assert.equal(
    await detectSelectionLanguage(selection("123?!"), "zh-TW", reliable("en")),
    undefined,
  );
});

test("Chinese script tags choose the corresponding speech language", async () => {
  assert.equal(
    await detectSelectionLanguage(selection("这是中文句子"), "zh-TW", reliable("zh-CN")),
    "zh-CN",
  );
  assert.equal(
    await detectSelectionLanguage(selection("這是中文句子"), "zh-CN", reliable("zh-Hant")),
    "zh-TW",
  );
  assert.equal(
    await detectSelectionLanguage(selection("中文句子"), "zh-CN", reliable("zh")),
    "zh-CN",
  );
});

test("standard lesson source language identifies kanji-only selections without guessing Chinese", async () => {
  assert.equal(
    await detectSelectionLanguage(
      { ...selection("漫画"), languageHint: "ja" },
      "zh-TW",
      reliable("zh"),
    ),
    "ja",
  );
  assert.equal(
    await detectSelectionLanguage(
      { ...selection("bonjour"), languageHint: "fr" },
      "zh-TW",
      reliable("en"),
    ),
    "fr",
  );
  assert.equal(
    await detectSelectionLanguage(
      { ...selection("unknown"), languageHint: "unsupported" },
      "zh-TW",
      async () => ({ isReliable: false, languages: [] }),
    ),
    undefined,
  );
});
