import type { LearningLanguage } from "./languages";

/** Checks notation, not whether a pronunciation is correct for the quoted text. */
export function validPronunciationReading(reading: string, language: LearningLanguage): boolean {
  if (language === "ja") return /^[\u3040-\u309fー\s・]+$/u.test(reading);
  if (language === "ko") return /^[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\s·]+$/u.test(reading);
  if (language === "zh-TW") return /[ㄅ-ㄩ]/u.test(reading) && /^[ㄅ-ㄩˉˊˇˋ˙\s]+$/u.test(reading);
  if (language === "zh-CN")
    return (
      /[aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/iu.test(reading) &&
      /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿê\s'’-]+$/iu.test(reading)
    );
  return /^\/[^/]+\/$/u.test(reading);
}
