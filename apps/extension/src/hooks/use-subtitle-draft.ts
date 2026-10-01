import { useEffect, useMemo, useState } from "react";
import type { LearningLanguage } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { SubtitleDraft } from "../lib/subtitle-draft";
export function useSubtitleDraft(language: LearningLanguage, locale: UiLocale) {
  const draft = useMemo(() => new SubtitleDraft(language, locale), []);
  const [state, setState] = useState(draft.snapshot);
  useEffect(() => {
    const unsubscribe = draft.subscribe(setState);
    return () => {
      unsubscribe();
      draft.dispose();
    };
  }, [draft]);
  useEffect(() => {
    draft.hydrateLanguage(language);
  }, [draft, language]);
  return { draft, state };
}
