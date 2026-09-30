import assert from "node:assert/strict";
import test from "node:test";
import { defaultPronunciationMode, displayReading, pronunciationModes } from "../components/pronunciation";
import { pronunciationCopy } from "./pronunciation";

test("Japanese saved kana supports local romanization and experimental Zhuyin", () => {
  assert.deepEqual(pronunciationModes("ja"), ["native", "roman", "zhuyin", "off"]);
  assert.equal(defaultPronunciationMode("ja"), "native");
  assert.equal(displayReading("ja", "native", "しゅくだい"), "しゅくだい");
  assert.equal(displayReading("ja", "roman", "しゅくだい"), "shukudai");
  assert.equal(displayReading("ja", "roman", "がっこう"), "gakkou");
  assert.equal(displayReading("ja", "zhuyin", "かな"), "ㄎㄚㄋㄚ");
  assert.equal(displayReading("ja", "roman", "未知"), null);
  assert.equal(pronunciationCopy("zh-TW", "ja").approximate, "實驗性近似讀音");
});

test("Korean conversion uses saved actual Hangul reading and omits missing data", () => {
  assert.deepEqual(pronunciationModes("ko"), ["native", "roman", "zhuyin", "off"]);
  assert.equal(displayReading("ko", "native", "한구거"), "한구거");
  assert.equal(displayReading("ko", "roman", "한구거"), "hangugeo");
  assert.equal(displayReading("ko", "zhuyin", "가"), "ㄍㄚ");
  assert.equal(displayReading("ko", "roman", undefined), null);
  assert.equal(displayReading("ko", "roman", "Hangugeo"), null);
});

test("other ten learning languages use saved IPA only", () => {
  for (const language of ["en", "es", "fr", "de", "it", "pt", "id", "th", "ms", "vi"] as const) {
    assert.deepEqual(pronunciationModes(language), ["ipa", "off"]);
    assert.equal(displayReading(language, "ipa", "/kəˈfiː/"), "/kəˈfiː/");
    assert.equal(displayReading(language, "off", "/kəˈfiː/"), null);
  }
});
