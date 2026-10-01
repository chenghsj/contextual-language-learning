import type { LearningLanguage, PronunciationSegment } from "@immersive/core";

export type PronunciationMode = "off" | "native" | "roman" | "ipa";

export function pronunciationModes(language: LearningLanguage): readonly PronunciationMode[] {
  return language === "ja" || language === "ko" ? ["native", "roman", "off"] : ["ipa", "off"];
}

export function defaultPronunciationMode(language: LearningLanguage): PronunciationMode {
  return language === "ja" || language === "ko" ? "native" : "ipa";
}

const kanaRows: readonly [string, string[]][] = [
  ["あいうえお", ["a", "i", "u", "e", "o"]],
  ["かきくけこ", ["ka", "ki", "ku", "ke", "ko"]],
  ["さしすせそ", ["sa", "shi", "su", "se", "so"]],
  ["たちつてと", ["ta", "chi", "tsu", "te", "to"]],
  ["なにぬねの", ["na", "ni", "nu", "ne", "no"]],
  ["はひふへほ", ["ha", "hi", "fu", "he", "ho"]],
  ["まみむめも", ["ma", "mi", "mu", "me", "mo"]],
  ["やゆよ", ["ya", "yu", "yo"]],
  ["らりるれろ", ["ra", "ri", "ru", "re", "ro"]],
  ["わをん", ["wa", "o", "n"]],
  ["がぎぐげご", ["ga", "gi", "gu", "ge", "go"]],
  ["ざじずぜぞ", ["za", "ji", "zu", "ze", "zo"]],
  ["だぢづでど", ["da", "ji", "zu", "de", "do"]],
  ["ばびぶべぼ", ["ba", "bi", "bu", "be", "bo"]],
  ["ぱぴぷぺぽ", ["pa", "pi", "pu", "pe", "po"]],
];
const kanaMap = new Map<string, string>();
for (const [kana, roman] of kanaRows) {
  Array.from(kana).forEach((letter, index) => kanaMap.set(letter, roman[index]));
}
const smallY: Record<string, string> = { ゃ: "a", ゅ: "u", ょ: "o" };
const smallVowels: Record<string, string> = { ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お" };

function japaneseReading(reading: string): string | null {
  const kana = Array.from(reading).map(char => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  });
  let result = "";
  let doubled = false;
  for (let index = 0; index < kana.length; index++) {
    const char = kana[index];
    if (char === "っ") {
      doubled = true;
      continue;
    }
    if (char === "ー") {
      result += result.slice(-1);
      continue;
    }
    if (/\s/.test(char)) {
      result += char;
      continue;
    }
    const base = kanaMap.get(smallVowels[char] ?? char);
    if (!base) return null;
    let roman = base;
    const next = smallY[kana[index + 1]];
    if (next && roman.endsWith("i")) {
      roman =
        (roman === "shi"
          ? "sh"
          : roman === "chi"
            ? "ch"
            : roman === "ji"
              ? "j"
              : roman.slice(0, -1) + "y") + next;
      index++;
    }
    if (doubled) {
      result += roman.startsWith("ch") ? "t" : roman[0];
      doubled = false;
    }
    result += roman;
  }
  return doubled ? null : result;
}

const koreanOnsets = [
  "g",
  "kk",
  "n",
  "d",
  "tt",
  "r",
  "m",
  "b",
  "pp",
  "s",
  "ss",
  "",
  "j",
  "jj",
  "ch",
  "k",
  "t",
  "p",
  "h",
];
const koreanVowels = [
  "a",
  "ae",
  "ya",
  "yae",
  "eo",
  "e",
  "yeo",
  "ye",
  "o",
  "wa",
  "wae",
  "oe",
  "yo",
  "u",
  "wo",
  "we",
  "wi",
  "yu",
  "eu",
  "ui",
  "i",
];
const koreanCodas = [
  "",
  "k",
  "k",
  "k",
  "n",
  "n",
  "n",
  "t",
  "l",
  "k",
  "m",
  "p",
  "l",
  "l",
  "p",
  "l",
  "m",
  "p",
  "p",
  "t",
  "t",
  "ng",
  "t",
  "t",
  "k",
  "t",
  "p",
  "t",
];
function koreanReading(reading: string): string | null {
  let output = "";
  for (const char of reading) {
    if (/\s|[.,!?]/.test(char)) {
      output += char;
      continue;
    }
    const syllable = char.charCodeAt(0) - 0xac00;
    if (syllable < 0 || syllable >= 11172) return null;
    const onset = Math.floor(syllable / 588);
    const vowel = Math.floor((syllable % 588) / 28);
    const coda = syllable % 28;
    output += koreanOnsets[onset] + koreanVowels[vowel] + koreanCodas[coda];
  }
  return output;
}

/** Convert only saved readings; missing or unsupported readings never invent a fallback. */
export function displayReading(
  language: LearningLanguage,
  mode: PronunciationMode,
  reading: string | undefined,
): string | null {
  if (!reading || mode === "off") return null;
  if (mode === "native" && (language === "ja" || language === "ko")) return reading;
  if (mode === "roman")
    return language === "ja"
      ? japaneseReading(reading)
      : language === "ko"
        ? koreanReading(reading)
        : null;
  return mode === "ipa" && language !== "ja" && language !== "ko" ? reading : null;
}

type RomanAnnotation = { text: string; reading?: string };
const kanaRun = /^[ぁ-ゖァ-ヺー]+$/u;

/** Keep each romanized reading next to its exact source fragment. */
export function romanAnnotations(
  language: LearningLanguage,
  text: string,
  segments?: PronunciationSegment[],
): RomanAnnotation[] | null {
  if (!segments?.length || segments.map(item => item.text).join("") !== text) return null;
  let preceding = "";
  const parts = segments.map(item => {
    // A standalone は after Japanese text is the topic particle even when older saved data says は.
    // Keep context-free kana conversion unchanged, so words such as はは still use ha.
    const particleHa =
      language === "ja" &&
      item.text === "は" &&
      item.reading === "は" &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヶー]$/u.test(preceding);
    preceding += item.text;
    return {
      text: item.text,
      reading: particleHa ? "wa" : (displayReading(language, "roman", item.reading) ?? undefined),
    };
  });
  return parts.some(part => part.reading) ? parts : null;
}

type JapaneseAnnotation = { text: string; reading?: string };
const kanjiRun = /^[\p{Script=Han}々〆ヶ]+$/u;

function hiragana(text: string): string {
  return Array.from(text, char => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  }).join("");
}

/** Align saved hiragana to kanji runs; leave uncertain mixed segments unannotated. */
export function japaneseKanjiAnnotations(text: string, reading: string): JapaneseAnnotation[] {
  const pieces =
    text.match(/[\p{Script=Han}々〆ヶ]+|[ぁ-ゖァ-ヺー]+|[^\p{Script=Han}々〆ヶぁ-ゖァ-ヺー]+/gu) ??
    [];
  const normalized = hiragana(reading).replace(/[\s。、!?！？]/gu, "");
  const result: JapaneseAnnotation[] = [];
  let cursor = 0;
  let pending = "";
  function plain(value: string): void {
    if (result.length && !result[result.length - 1].reading)
      result[result.length - 1].text += value;
    else result.push({ text: value });
  }
  for (const [index, piece] of pieces.entries()) {
    if (kanjiRun.test(piece)) {
      pending += piece;
      continue;
    }
    if (kanaRun.test(piece)) {
      const anchor = hiragana(piece);
      const at = pending ? normalized.indexOf(anchor, cursor + 1) : cursor;
      if (at < 0 || !normalized.startsWith(anchor, at)) return [{ text }];
      if (pending) {
        result.push({ text: pending, reading: normalized.slice(cursor, at) });
        pending = "";
      }
      cursor = at + anchor.length;
    } else if (pending) {
      if (
        pieces.slice(index + 1).some(part => kanjiRun.test(part) || kanaRun.test(part)) ||
        cursor === normalized.length
      )
        return [{ text }];
      result.push({ text: pending, reading: normalized.slice(cursor) });
      pending = "";
      cursor = normalized.length;
    }
    plain(piece);
  }
  if (pending) {
    if (cursor === normalized.length) return [{ text }];
    result.push({ text: pending, reading: normalized.slice(cursor) });
    cursor = normalized.length;
  }
  return cursor === normalized.length ? result : [{ text }];
}
