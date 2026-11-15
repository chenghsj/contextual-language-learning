import assert from "node:assert/strict";
import { test } from "node:test";
import { speechSamples } from "./speech";

test("downloaded Siri voices outside lesson languages have a native-language preview sentence", () => {
  const languages = [
    "ar-SA",
    "da-DK",
    "fi-FI",
    "he-IL",
    "kk-KZ",
    "lt-LT",
    "nb-NO",
    "nl-NL",
    "ru-RU",
    "sv-SE",
    "tr-TR",
    "zh-HK",
  ];
  for (const language of languages) {
    const sample = speechSamples[language] ?? speechSamples[language.split("-")[0]];
    assert.ok(sample?.trim(), `Missing Siri preview sentence for ${language}`);
  }
});
