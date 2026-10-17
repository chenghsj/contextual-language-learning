import {
  explanationPreferences,
  type ExplanationType,
  type GenerationRequest,
  type LearningLanguage,
} from "@contextual/core";

export const LANGUAGE_STRATEGIES: Record<LearningLanguage, string> = {
  "zh-TW":
    "Taiwan Mandarin in Traditional Chinese: preserve original characters without script conversion; use Taiwan Traditional Chinese for new examples. Identify meaningful words and constructions without relying on spaces. Explain relevant classifiers, aspect particles, word order, complements, ellipsis and sentence-final particles. Distinguish contextual polyphonic readings and general tone changes from recorded delivery; use reliable Zhuyin readings with tone marks.",
  "zh-CN":
    "Mainland Mandarin in Simplified Chinese: preserve original characters without script conversion; use Mainland Simplified Chinese for new examples. Identify meaningful words and constructions without relying on spaces. Explain relevant classifiers, aspect particles, word order, complements, ellipsis and sentence-final particles. Distinguish contextual polyphonic readings and general tone changes from recorded delivery; use reliable tone-marked Hanyu Pinyin readings.",
  en: "English: preserve phrasal verbs, collocations and sentence frames; explain tense, aspect, contractions and conversational register when relevant.",
  ja: "Japanese: preserve predicate endings, particles and meaningful constructions; explain omitted arguments, contractions, politeness and contextual kana readings. Do not split by spaces.",
  ko: "Korean: preserve meaningful predicate endings and particles; explain speech levels, honorifics, contractions and reliable Hangul sound changes. Do not treat every morpheme as a reusable expression.",
  es: "Spanish: preserve meaningful verb and clitic constructions; explain conjugation, aspect, agreement and contextual forms of address.",
  fr: "French: preserve verb constructions and collocations; explain pronouns, agreement, spoken omission and formal versus informal usage.",
  de: "German: preserve separable-verb relationships and verb frames; explain clause order, cases and modal constructions in their full sentence context.",
  it: "Italian: preserve verb and clitic constructions; explain conjugation, agreement, common contractions and contextual register.",
  pt: "Portuguese: preserve meaningful verb and pronoun constructions; explain conjugation, contractions and register without assuming an unsupported regional variety.",
  id: "Indonesian: identify meaningful collocations and clause units; explain affixes, colloquial forms, aspect markers and contextual address.",
  th: "Thai: identify semantic phrase boundaries without relying on spaces; preserve constructions and sentence-final particles, explain address and reliable pronunciation without inferring recorded tone or intonation.",
  ms: "Malay: identify meaningful collocations and clause units; explain affixes, aspect markers, colloquial forms and contextual address without conflating Malay with Indonesian.",
  vi: "Vietnamese: preserve multi-syllable lexical units and constructions; explain aspect markers, classifiers and contextual address. Spaces are not a reliable word boundary for semantic segmentation.",
};

const EXPLANATION_GUIDANCE: Record<ExplanationType, { normal: string; detailed: string }> = {
  vocabulary: {
    normal:
      "Explain the contextual word meaning, essential collocations and restrictions needed to understand this sentence.",
    detailed:
      "Explain why this meaning fits; add relevant confusing-word or collocation contrasts and usage restrictions. Do not enumerate unrelated dictionary senses.",
  },
  grammar: {
    normal: "Explain the structure and function needed to understand this sentence.",
    detailed:
      "Explain how the form produces the meaning, necessary component relationships or omitted elements, and relevant differences if a related form replaces it. Do not turn the note into a full grammar chapter.",
  },
  chunks: {
    normal:
      "Give meaningful understanding units, their meanings and how they combine into the complete sentence. Essential relationships belong in Normal too.",
    detailed:
      "Clarify relevant dependency, modification or scope relationships; distinguish understanding segments from reusable expressions, and identify fixed and replaceable parts of genuine reusable frames. Never label arbitrary segments as fixed expressions.",
  },
  usage: {
    normal:
      "Explain the communicative function, register and effect supported by the supplied dialogue.",
    detailed:
      "Compare relevant alternative wording for directness, politeness or stance and explain usage limits. Mark comparisons as illustrative, not video evidence; preserve uncertainty about character intentions and relationships.",
  },
  pronunciation: {
    normal:
      "Provide reliable readings and text-supported pronunciation hints needed for this sentence; without audio analysis, never assert the actor's actual stress, reduction, linking or intonation.",
    detailed:
      "Explain relevant language-specific sound-spelling relationships, sound changes or listening cues. Distinguish general pronunciation rules from the recording.",
  },
  culture: {
    normal:
      "Explain only background or forms of address needed for this sentence and supported by the supplied material.",
    detailed:
      "Explain how that supported background affects the sentence's meaning or use. Omit unsupported background, unrelated trivia and national or group stereotypes.",
  },
};

/** Teaching-only guidance: selection stages receive preferences, not extra output requirements. */
export function explanationDepthStrategy(request: GenerationRequest): string {
  const { enabled, emphasized } = explanationPreferences(request.profile);
  if (!enabled.length)
    return "All explanation supplements are Off; preserve basic meaning and context only.";
  return [
    "Explanation depth rules apply to existing wordNotes, chunks and notes; do not add depth fields to the JSON.",
    "Normal must be sufficient to understand the selected original sentence; never withhold essential explanation for Detailed.",
    "Detailed first satisfies Normal, then adds useful reasons, relationships, contrasts or usage limits at the same learner level. Each addition must resolve an additional understanding or usage question.",
    "There is no minimum word count, note count or length multiplier. If no useful, reliable extension exists, do not expand; simple sentences may have similar Normal and Detailed explanations.",
    "Explain each knowledge point fully once in its most appropriate field or category. Other categories must add a distinct contribution, not repeat the translation, wordNotes, chunk meanings or another note. Enabled categories are optional perspectives, not a checklist to fill in every sentence.",
    "Adapt background assumptions and explain necessary terminology for the selected proficiency. Do not increase difficulty or introduce more technical language merely because Detailed is selected.",
    ...enabled.map(type => {
      const guidance = EXPLANATION_GUIDANCE[type];
      return `${type} (${emphasized.includes(type) ? "Detailed" : "Normal"}): ${guidance.normal}${emphasized.includes(type) ? " Additional guidance: " + guidance.detailed : ""}`;
    }),
  ].join("\n");
}

export function teachingStrategy(request: GenerationRequest): string {
  const { enabled, emphasized } = explanationPreferences(request.profile);
  return [
    LANGUAGE_STRATEGIES[request.profile.targetLanguage],
    "Enabled explanation types: " +
      JSON.stringify(enabled) +
      ". Disabled supplements MUST NOT be generated.",
    "Emphasized explanation types: " +
      JSON.stringify(emphasized) +
      ". These enabled types use Detailed; other enabled types use Normal. Empty means balanced Normal explanations. Disabled types remain Off.",
    "Explanation depth never raises the learner level or changes the requested scene, focus-expression or contextual-example counts.",
    "Use the selected language-specific proficiency scale as a guide to selection and explanation burden; do not invent an official exam level for each chunk.",
    "Always preserve original text, basic meaning and source-grounded context. Even with no enabled supplements these remain available.",
    "Provide explanations and comparisons, never quizzes, exercises, scores or requests for learner answers. Only add cultural background supported by the supplied material; do not invent cultural claims.",
  ].join("\n");
}
