import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPronunciationMode,
  displayReading,
  japaneseKanjiAnnotations,
  pronunciationModes,
  romanAnnotations,
} from "../components/pronunciation";
import { pronunciationCopy } from "./pronunciation";

test("Japanese saved kana supports local romanization", () => {
  assert.deepEqual(pronunciationModes("ja"), ["native", "roman", "off"]);
  assert.equal(defaultPronunciationMode("ja"), "native");
  assert.equal(displayReading("ja", "native", "しゅくだい"), "しゅくだい");
  assert.equal(displayReading("ja", "roman", "しゅくだい"), "shukudai");
  assert.equal(displayReading("ja", "roman", "がっこう"), "gakkou");
  assert.equal(displayReading("ja", "roman", "未知"), null);
  assert.equal(pronunciationCopy("zh-TW", "ja").option("roman"), "羅馬字");
});

test("Japanese kana labels only kanji while preserving the original sentence", () => {
  assert.deepEqual(japaneseKanjiAnnotations("面白い設定ですね。", "おもしろいせっていですね"), [
    { text: "面白", reading: "おもしろ" },
    { text: "い" },
    { text: "設定", reading: "せってい" },
    { text: "ですね。" },
  ]);
  assert.deepEqual(japaneseKanjiAnnotations("いくら", "いくら"), [{ text: "いくら" }]);
  assert.deepEqual(japaneseKanjiAnnotations("食べ物", "たべもの"), [
    { text: "食", reading: "た" },
    { text: "べ" },
    { text: "物", reading: "もの" },
  ]);
  assert.deepEqual(japaneseKanjiAnnotations("昨日。", "きのう"), [
    { text: "昨日", reading: "きのう" },
    { text: "。" },
  ]);
  assert.deepEqual(japaneseKanjiAnnotations("漢。字", "かんじ"), [{ text: "漢。字" }]);
});

test("roman readings stay attached to saved source chunks without inventing kana pronunciation", () => {
  const segments = [
    { text: "面白い", reading: "おもしろい" },
    { text: "設定", reading: "せってい" },
    { text: "ですね。" },
  ];
  assert.deepEqual(romanAnnotations("ja", "面白い設定ですね。", segments), [
    { text: "面白い", reading: "omoshiroi" },
    { text: "設定", reading: "settei" },
    { text: "ですね。", reading: undefined },
  ]);
  assert.deepEqual(romanAnnotations("ja", "ですね。", [{ text: "ですね。", reading: "ですね" }]), [
    { text: "ですね。", reading: "desune" },
  ]);
  assert.equal(romanAnnotations("ja", "different", segments), null);
  assert.deepEqual(romanAnnotations("ko", "한국어", [{ text: "한국어", reading: "한구거" }]), [
    { text: "한국어", reading: "hangugeo" },
  ]);
});

test("Japanese particle は uses wa while lexical は keeps ha", () => {
  assert.deepEqual(
    romanAnnotations("ja", "命はキャラです。", [
      { text: "命", reading: "いのち" },
      { text: "は", reading: "は" },
      { text: "キャラ", reading: "きゃら" },
      { text: "です。", reading: "です" },
    ]),
    [
      { text: "命", reading: "inochi" },
      { text: "は", reading: "wa" },
      { text: "キャラ", reading: "kyara" },
      { text: "です。", reading: "desu" },
    ],
  );
  assert.deepEqual(
    romanAnnotations("ja", "歯は", [
      { text: "歯", reading: "は" },
      { text: "は", reading: "は" },
    ]),
    [
      { text: "歯", reading: "ha" },
      { text: "は", reading: "wa" },
    ],
  );
  assert.deepEqual(
    romanAnnotations("ja", "あ、は", [
      { text: "あ", reading: "あ" },
      { text: "、" },
      { text: "は", reading: "は" },
    ]),
    [
      { text: "あ", reading: "a" },
      { text: "、", reading: undefined },
      { text: "は", reading: "ha" },
    ],
  );
  assert.equal(displayReading("ja", "roman", "はは"), "haha");
  assert.equal(displayReading("ja", "roman", "は"), "ha");
});

test("Korean conversion uses saved actual Hangul reading and omits missing data", () => {
  assert.deepEqual(pronunciationModes("ko"), ["native", "roman", "off"]);
  assert.equal(displayReading("ko", "native", "한구거"), "한구거");
  assert.equal(displayReading("ko", "roman", "한구거"), "hangugeo");
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
