import { useEffect, useMemo, useRef, useState } from "react";
import type { LearningLanguage } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { readDraft, writeDraft } from "../lib/draft-db";
import { SubtitleDraft } from "../lib/subtitle-draft";
export function useSubtitleDraft(language: LearningLanguage, locale: UiLocale) {
  const draft = useMemo(() => new SubtitleDraft(language, locale), []);
  const [state, setState] = useState(draft.snapshot);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "failed">("saved");
  useEffect(() => {
    let live = true;
    void readDraft<ReturnType<SubtitleDraft["exportSaved"]>>("subtitles-v1")
      .then(saved => {
        if (live && saved) draft.hydrateSaved(saved);
      })
      .catch(() => {
        if (live) setSaveStatus("failed");
      })
      .finally(() => {
        if (live) {
          loadedRef.current = true;
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [draft]);
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      void writeDraft("subtitles-v1", draft.exportSaved())
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("failed"));
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [
    loaded,
    state.raw,
    state.originalRaw,
    state.timingOverrides,
    state.captionSource,
    state.title,
    state.sourceUrl,
  ]);
  useEffect(() => {
    const unsubscribe = draft.subscribe(setState);
    return () => {
      unsubscribe();
      if (loadedRef.current) void writeDraft("subtitles-v1", draft.exportSaved()).catch(() => {});
      draft.dispose();
    };
  }, [draft]);
  useEffect(() => {
    const flush = () => {
      if (loadedRef.current) void writeDraft("subtitles-v1", draft.exportSaved()).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [draft]);
  useEffect(() => {
    draft.hydrateLanguage(language);
  }, [draft, language]);
  return { draft, state, loaded, saveStatus };
}
