import type { LearningLanguage } from "@immersive/core";

export type PronunciationMode = "off" | "native" | "roman" | "zhuyin" | "ipa";

export function pronunciationModes(language: LearningLanguage): readonly PronunciationMode[] {
  return language === "ja" || language === "ko"
    ? ["native", "roman", "zhuyin", "off"] : ["ipa", "off"];
}

export function defaultPronunciationMode(language: LearningLanguage): PronunciationMode {
  return language === "ja" || language === "ko" ? "native" : "ipa";
}

const kanaRows: readonly [string, string[], string[]][] = [
  ["あいうえお", ["a", "i", "u", "e", "o"], ["ㄚ", "ㄧ", "ㄨ", "ㄝ", "ㄛ"]],
  ["かきくけこ", ["ka", "ki", "ku", "ke", "ko"], ["ㄎㄚ", "ㄎㄧ", "ㄎㄨ", "ㄎㄝ", "ㄎㄛ"]],
  ["さしすせそ", ["sa", "shi", "su", "se", "so"], ["ㄙㄚ", "ㄒㄧ", "ㄙㄨ", "ㄙㄝ", "ㄙㄛ"]],
  ["たちつてと", ["ta", "chi", "tsu", "te", "to"], ["ㄊㄚ", "ㄑㄧ", "ㄘㄨ", "ㄊㄝ", "ㄊㄛ"]],
  ["なにぬねの", ["na", "ni", "nu", "ne", "no"], ["ㄋㄚ", "ㄋㄧ", "ㄋㄨ", "ㄋㄝ", "ㄋㄛ"]],
  ["はひふへほ", ["ha", "hi", "fu", "he", "ho"], ["ㄏㄚ", "ㄏㄧ", "ㄈㄨ", "ㄏㄝ", "ㄏㄛ"]],
  ["まみむめも", ["ma", "mi", "mu", "me", "mo"], ["ㄇㄚ", "ㄇㄧ", "ㄇㄨ", "ㄇㄝ", "ㄇㄛ"]],
  ["やゆよ", ["ya", "yu", "yo"], ["ㄧㄚ", "ㄧㄨ", "ㄧㄛ"]],
  ["らりるれろ", ["ra", "ri", "ru", "re", "ro"], ["ㄌㄚ", "ㄌㄧ", "ㄌㄨ", "ㄌㄝ", "ㄌㄛ"]],
  ["わをん", ["wa", "o", "n"], ["ㄨㄚ", "ㄛ", "ㄣ"]],
  ["がぎぐげご", ["ga", "gi", "gu", "ge", "go"], ["ㄍㄚ", "ㄍㄧ", "ㄍㄨ", "ㄍㄝ", "ㄍㄛ"]],
  ["ざじずぜぞ", ["za", "ji", "zu", "ze", "zo"], ["ㄗㄚ", "ㄐㄧ", "ㄗㄨ", "ㄗㄝ", "ㄗㄛ"]],
  ["だぢづでど", ["da", "ji", "zu", "de", "do"], ["ㄉㄚ", "ㄐㄧ", "ㄗㄨ", "ㄉㄝ", "ㄉㄛ"]],
  ["ばびぶべぼ", ["ba", "bi", "bu", "be", "bo"], ["ㄅㄚ", "ㄅㄧ", "ㄅㄨ", "ㄅㄝ", "ㄅㄛ"]],
  ["ぱぴぷぺぽ", ["pa", "pi", "pu", "pe", "po"], ["ㄆㄚ", "ㄆㄧ", "ㄆㄨ", "ㄆㄝ", "ㄆㄛ"]],
];
const kanaMap = new Map<string, [string, string]>();
for (const [kana, roman, zhuyin] of kanaRows) {
  Array.from(kana).forEach((letter, index) => kanaMap.set(letter, [roman[index], zhuyin[index]]));
}
const smallY: Record<string, [string, string]> = {
  "ゃ": ["a", "ㄚ"], "ゅ": ["u", "ㄨ"], "ょ": ["o", "ㄛ"],
};
const smallVowels: Record<string, string> = { "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お" };

function japaneseReading(reading: string, mode: "roman" | "zhuyin"): string | null {
  const kana = Array.from(reading).map(char => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  });
  let result = "";
  let doubled = false;
  for (let index = 0; index < kana.length; index++) {
    const char = kana[index];
    if (char === "っ") { doubled = true; continue; }
    if (char === "ー") { if (mode === "roman") result += result.slice(-1); continue; }
    if (/\s/.test(char)) { result += char; continue; }
    const base = kanaMap.get(smallVowels[char] ?? char);
    if (!base) return null;
    let roman = base[0];
    let zhuyin = base[1];
    const next = smallY[kana[index + 1]];
    if (next && roman.endsWith("i")) {
      roman = (roman === "shi" ? "sh" : roman === "chi" ? "ch" : roman === "ji" ? "j"
        : roman.slice(0, -1) + "y") + next[0];
      zhuyin = zhuyin.replace(/ㄧ$/, "") + "ㄧ" + next[1];
      index++;
    }
    if (doubled) { if (mode === "roman") result += roman.startsWith("ch") ? "t" : roman[0]; doubled = false; }
    result += mode === "roman" ? roman : zhuyin;
  }
  return doubled ? null : result;
}

const koreanOnsets = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const koreanVowels = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const koreanCodas = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "p", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
const koreanOnsetZhuyin = ["ㄍ", "ㄍ", "ㄋ", "ㄉ", "ㄉ", "ㄌ", "ㄇ", "ㄅ", "ㄅ", "ㄙ", "ㄙ", "", "ㄐ", "ㄐ", "ㄑ", "ㄎ", "ㄊ", "ㄆ", "ㄏ"];
const koreanVowelZhuyin = ["ㄚ", "ㄝ", "ㄧㄚ", "ㄧㄝ", "ㄜ", "ㄝ", "ㄧㄜ", "ㄧㄝ", "ㄛ", "ㄨㄚ", "ㄨㄝ", "ㄨㄝ", "ㄧㄛ", "ㄨ", "ㄨㄜ", "ㄨㄝ", "ㄨㄧ", "ㄧㄨ", "ㄜ", "ㄨㄧ", "ㄧ"];
const koreanCodaZhuyin = ["", "ㄎ", "ㄎ", "ㄎ", "ㄣ", "ㄣ", "ㄣ", "ㄊ", "ㄦ", "ㄎ", "ㄇ", "ㄅ", "ㄦ", "ㄦ", "ㄅ", "ㄦ", "ㄇ", "ㄅ", "ㄅ", "ㄊ", "ㄊ", "ㄥ", "ㄊ", "ㄊ", "ㄎ", "ㄊ", "ㄅ", "ㄊ"];

function koreanReading(reading: string, mode: "roman" | "zhuyin"): string | null {
  let output = "";
  for (const char of reading) {
    if (/\s|[.,!?]/.test(char)) { output += char; continue; }
    const syllable = char.charCodeAt(0) - 0xac00;
    if (syllable < 0 || syllable >= 11172) return null;
    const onset = Math.floor(syllable / 588);
    const vowel = Math.floor((syllable % 588) / 28);
    const coda = syllable % 28;
    output += mode === "roman"
      ? koreanOnsets[onset] + koreanVowels[vowel] + koreanCodas[coda]
      : koreanOnsetZhuyin[onset] + koreanVowelZhuyin[vowel] + koreanCodaZhuyin[coda];
  }
  return output;
}

/** Convert only saved readings; missing or unsupported readings never invent a fallback. */
export function displayReading(language: LearningLanguage, mode: PronunciationMode, reading: string | undefined): string | null {
  if (!reading || mode === "off") return null;
  if (mode === "native" && (language === "ja" || language === "ko")) return reading;
  if (mode === "roman") return language === "ja" ? japaneseReading(reading, mode)
    : language === "ko" ? koreanReading(reading, mode) : null;
  if (mode === "zhuyin") return language === "ja" ? japaneseReading(reading, mode)
    : language === "ko" ? koreanReading(reading, mode) : null;
  return mode === "ipa" && language !== "ja" && language !== "ko" ? reading : null;
}
