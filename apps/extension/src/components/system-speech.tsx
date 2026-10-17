import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Square, Volume2 } from "lucide-react";
import { readAloudVoicesForLanguage, type SpeechSettings } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { speechCopy } from "../i18n/speech";
import { windowsNarratorCopy } from "../i18n/windows-narrator";
import { SpeechController } from "../native/speech-controller";
import type { PreferencesStore } from "../lib/preferences-store";
import { Button } from "./ui/button";

type SpeechContextValue = {
  controller: SpeechController;
  settings: SpeechSettings;
  ready: boolean;
  saveSettings(settings: SpeechSettings): Promise<void>;
};
const SpeechContext = createContext<SpeechContextValue | null>(null);
export const useSystemSpeech = () => useContext(SpeechContext);

export function SystemSpeechProvider({
  children,
  store,
  controller: provided,
}: {
  children: React.ReactNode;
  store?: PreferencesStore;
  controller?: SpeechController;
}) {
  const [controller] = useState(() => provided ?? new SpeechController());
  const [settings, setSettings] = useState<SpeechSettings>({ rate: 1, voices: {} });
  const [ready, setReady] = useState(!store);
  useEffect(() => {
    let live = true;
    const unsubscribe = store?.subscribe(value => {
      if (live) setSettings(value.speech ?? { rate: 1, voices: {} });
    });
    void store
      ?.load()
      .then(value => {
        if (live) {
          setSettings(value.speech ?? { rate: 1, voices: {} });
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
      unsubscribe?.();
      controller.dispose();
    };
  }, [controller, store]);
  useEffect(() => {
    if (ready) void controller.listVoices().catch(() => {});
  }, [controller, ready]);
  const saveSettings = async (next: SpeechSettings) => {
    if (store) await store.saveSpeech(next);
    else setSettings(next);
  };
  return (
    <SpeechContext.Provider value={{ controller, settings, ready, saveSettings }}>
      {children}
    </SpeechContext.Provider>
  );
}

export function SpeechButton({
  locale,
  speechKey,
  scope,
  text,
  segments,
  language,
  label,
  beforeSpeak,
  disabled,
  ...props
}: {
  locale: UiLocale;
  speechKey: string;
  scope: string;
  text: string;
  segments?: readonly string[];
  language: string;
  label?: string;
  beforeSpeak?: (isCurrent: () => boolean) => Promise<void>;
} & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const speech = useSystemSpeech();
  if (!speech) return null;
  return (
    <ConnectedSpeechButton
      {...props}
      disabled={disabled}
      speech={speech}
      locale={locale}
      speechKey={speechKey}
      scope={scope}
      text={text}
      segments={segments}
      language={language}
      label={label}
      beforeSpeak={beforeSpeak}
    />
  );
}
function ConnectedSpeechButton({
  speech,
  locale,
  speechKey,
  scope,
  text,
  segments,
  language,
  label,
  beforeSpeak,
  disabled,
  ...props
}: {
  speech: SpeechContextValue;
  locale: UiLocale;
  speechKey: string;
  scope: string;
  text: string;
  segments?: readonly string[];
  language: string;
  label?: string;
  beforeSpeak?: (isCurrent: () => boolean) => Promise<void>;
} & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const state = useSyncExternalStore(speech.controller.subscribe, speech.controller.snapshot);
  const copy = speechCopy(locale);
  const active = state.active?.key === speechKey && state.active.scope === scope;
  if (
    !active &&
    (state.availability !== "ready" ||
      !readAloudVoicesForLanguage(state.voices ?? [], language).length)
  )
    return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 [&_svg]:size-3.5"
      {...props}
      disabled={disabled || !speech.ready || !text.trim()}
      aria-label={active ? copy.stop : (label ?? copy.play)}
      title={active ? copy.stop : (label ?? copy.play)}
      aria-pressed={active}
      onClick={() => {
        if (active) void speech.controller.stop(scope).catch(() => {});
        else
          void speech.controller.speak(
            speechKey,
            scope,
            text,
            language,
            speech.settings,
            beforeSpeak,
            undefined,
            segments,
          );
      }}
    >
      {active ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      {props.children && (active ? copy.stop : props.children)}
    </Button>
  );
}

export function SpeechStatus({ locale, language }: { locale: UiLocale; language?: string }) {
  const speech = useSystemSpeech();
  if (!speech) return null;
  return (
    <ConnectedSpeechStatus controller={speech.controller} locale={locale} language={language} />
  );
}
function ConnectedSpeechStatus({
  controller,
  locale,
  language,
}: {
  controller: SpeechController;
  locale: UiLocale;
  language?: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const copy = speechCopy(locale);
  const narrator = windowsNarratorCopy(locale);
  const isNarrator = state.experimentalBackend === "windows-narrator";
  if (state.loading || state.availability === "unknown")
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {copy.loading}
      </p>
    );
  if (state.availability === "unsupported")
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {copy.unsupported}
      </p>
    );
  if (state.availability === "unavailable")
    return (
      <div className="grid min-w-0 gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          {copy.unavailable}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 justify-self-start text-xs"
          onClick={() => {
            void controller.listVoices(true).catch(() => {});
          }}
        >
          {copy.retry}
        </Button>
      </div>
    );
  if (language && !readAloudVoicesForLanguage(state.voices ?? [], language).length)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {isNarrator ? narrator.empty : copy.empty}
      </p>
    );
  if (state.error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {state.errorKind === "voice"
          ? isNarrator
            ? narrator.empty
            : copy.empty
          : isNarrator
            ? narrator.failed
            : copy.failed}
      </p>
    );
  return (
    <span role="status" className="sr-only">
      {state.active ? speechCopy(locale).speaking : ""}
    </span>
  );
}
