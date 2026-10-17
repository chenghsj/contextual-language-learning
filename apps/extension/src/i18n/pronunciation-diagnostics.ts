import type { UiLocale } from "./messages";
import type { PronunciationDiagnostic } from "@contextual/core";
const messages = {
  "zh-TW": {
    missing: "部分讀音未提供",
    count: (n: number) => `${n} 處讀音缺漏`,
    normalized: "讀音表記已統一",
    repaired: "讀音已修復",
    invalid_reading: "讀音格式不符",
    empty_reading: "讀音欄位為空",
    empty_annotation: "標註沒有可用讀音",
    reading_normalized: "讀音表記調整",
    annotation_alignment: "讀音標註與例句文字不符",
  },
  "zh-CN": {
    missing: "部分读音未提供",
    count: (n: number) => `${n} 处读音缺漏`,
    normalized: "读音表记已统一",
    repaired: "读音已修复",
    invalid_reading: "读音格式不符",
    empty_reading: "读音字段为空",
    empty_annotation: "标注没有可用读音",
    reading_normalized: "读音表记调整",
    annotation_alignment: "读音标注与例句文字不符",
  },
  en: {
    missing: "Some readings unavailable",
    count: (n: number) => `${n} reading gaps`,
    normalized: "Reading format normalized",
    repaired: "Reading repaired",
    invalid_reading: "Invalid reading format",
    empty_reading: "Empty reading",
    empty_annotation: "No usable reading in annotation",
    reading_normalized: "Reading format adjustment",
    annotation_alignment: "Reading annotation does not match example text",
  },
  ja: {
    missing: "一部の読みは未提供です",
    count: (n: number) => `読みの不足：${n}か所`,
    normalized: "読みの表記を統一",
    repaired: "読みを修復",
    invalid_reading: "読みの形式が不正",
    empty_reading: "読みが空です",
    empty_annotation: "使用できる読みがありません",
    reading_normalized: "読みの表記調整",
    annotation_alignment: "読みの注記が例文と一致しません",
  },
  ko: {
    missing: "일부 발음 표기가 제공되지 않았습니다",
    count: (n: number) => `발음 표기 누락 ${n}곳`,
    normalized: "발음 표기 형식 정리",
    repaired: "발음 표기 수정",
    invalid_reading: "잘못된 발음 표기 형식",
    empty_reading: "빈 발음 표기",
    empty_annotation: "사용 가능한 발음 표기 없음",
    reading_normalized: "발음 표기 형식 조정",
    annotation_alignment: "발음 표기와 예문 불일치",
  },
};
export const pronunciationDiagnosticCopy = (locale: UiLocale) => messages[locale];
export function pronunciationDiagnosticLabel(locale: UiLocale, d: PronunciationDiagnostic) {
  const copy = messages[locale];
  return `${d.action === "normalized" ? copy.normalized : d.action === "repaired" ? copy.repaired : copy.missing} · ${copy[d.code]}`;
}
