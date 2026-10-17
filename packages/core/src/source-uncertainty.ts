/** Recognize explicit uncertainty disclosures in supported explanation languages. */
const uncertainty =
  /未明|不明|不詳|未知|不確定|不确定|未確定|unclear|uncertain|ambiguous|불명|불확실|알 수 없|inciert[oa]|desconocid|incertain|inconnu|illisible|unklar|unsicher|unbekannt|unlesbar|incert[oa]|non chiar|poco chiar|sconosciut|illeggibile|não clar|nao clar|pouco clar|desconhecid|ilegível|tidak jelas|tak jelas|tidak pasti|tak pasti|tidak diketahui|kabur|không rõ|không chắc|chưa rõ|không xác định|ไม่ชัดเจน|ไม่แน่ชัด|ไม่แน่นอน|ไม่ทราบ/iu;
export function hasUncertaintyDisclosure(text: string): boolean {
  return uncertainty.test(text.normalize("NFC")) || /\[\?+\]/u.test(text);
}
