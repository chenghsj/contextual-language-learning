import React, { useEffect, useId, useState, useSyncExternalStore } from "react";
import { readAloudVoicesForLanguage, findSystemVoice, type SpeechSettings } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { speechCopy, speechLanguageOptions, speechSamples } from "../i18n/speech";
import { windowsNarratorCopy, windowsNarratorHelpUrl } from "../i18n/windows-narrator";
import { useSystemSpeech, SpeechButton, SpeechStatus } from "./system-speech";
import { SearchableSelectField } from "./searchable-select-field";
import { Button } from "./ui/button";
import { SelectField } from "./ui/select";
import { SiriVoiceDownloads } from "./siri-voice-downloads";
import { FlaskConical, RefreshCw } from "lucide-react";
import { IconTooltip } from "./icon-tooltip";

export function SpeechSettingsPanel({
  locale,
  defaultLanguage,
  onManageVoices,
  restoreManageFocus,
}: {
  locale: UiLocale;
  defaultLanguage: string;
  onManageVoices: (language: string) => void;
  restoreManageFocus?: () => void;
}) {
  const speech = useSystemSpeech();
  if (!speech) return null;
  return (
    <ConnectedSpeechSettings
      locale={locale}
      defaultLanguage={defaultLanguage}
      speech={speech}
      onManageVoices={onManageVoices}
      restoreManageFocus={restoreManageFocus}
    />
  );
}
function ConnectedSpeechSettings({
  locale,
  defaultLanguage,
  speech,
  onManageVoices,
  restoreManageFocus,
}: {
  locale: UiLocale;
  defaultLanguage: string;
  speech: NonNullable<ReturnType<typeof useSystemSpeech>>;
  onManageVoices: (language: string) => void;
  restoreManageFocus?: () => void;
}) {
  const copy = speechCopy(locale);
  const [language, setLanguage] = useState(defaultLanguage);
  const [saveError, setSaveError] = useState(false);
  const scope = useId();
  const state = useSyncExternalStore(speech.controller.subscribe, speech.controller.snapshot);
  const narrator = windowsNarratorCopy(locale);
  const isNarrator =
    state.experimentalBackend === "windows-narrator" ||
    state.voices?.some(voice => voice.engine === "narrator");
  const heading = (
    <h3 className="flex flex-wrap items-center gap-2 text-ui-heading font-semibold">
      {copy.title}
      {isNarrator && (
        <span className="inline-flex items-center gap-1 text-ui-label font-normal text-muted-foreground">
          <FlaskConical className="size-3.5" aria-hidden="true" />
          {narrator.experimental}
        </span>
      )}
    </h3>
  );
  useEffect(() => {
    void speech.controller.listVoices().catch(() => {});
    return () => {
      void speech.controller.stop(scope).catch(() => {});
    };
  }, [speech.controller, scope]);
  const voices = readAloudVoicesForLanguage(state.voices ?? [], language);
  const selected = speech.settings.voices[language];
  const refreshButton = (
    <IconTooltip label={copy.refresh}>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        aria-label={copy.refresh}
        disabled={state.loading}
        onClick={() => {
          void speech.controller.listVoices(true).catch(() => {});
        }}
      >
        <RefreshCw
          className={state.loading ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"}
          aria-hidden="true"
        />
      </Button>
    </IconTooltip>
  );
  const save = (settings: SpeechSettings) => {
    setSaveError(false);
    void speech.controller.stop().catch(() => {});
    void speech.saveSettings(settings).catch(() => setSaveError(true));
  };
  if (state.availability !== "ready")
    return (
      <section className="grid min-w-0 gap-4 border-t border-border pt-6" aria-label={copy.title}>
        {heading}
        <SpeechStatus locale={locale} language={language} />
      </section>
    );
  return (
    <section className="grid min-w-0 gap-4 border-t border-border pt-6" aria-label={copy.title}>
      {heading}
      {isNarrator ? (
        <div className="grid min-w-0 gap-2" data-ui="windows-narrator-experimental">
          <p className="text-ui-label font-medium">{narrator.title}</p>
          <p className="text-ui-label leading-relaxed text-muted-foreground">{narrator.hint}</p>
          <p className="text-ui-label leading-relaxed">{narrator.setup}</p>
          <a
            href={windowsNarratorHelpUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="w-fit text-ui-label underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {narrator.help}
          </a>
        </div>
      ) : (
        <p className="text-ui-label leading-relaxed text-muted-foreground">{copy.hint}</p>
      )}
      <div className="grid gap-1">
        <label htmlFor={scope + "-language"} className="text-xs">
          {copy.language}
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <SelectField
              id={scope + "-language"}
              ariaLabel={copy.language}
              value={language}
              onValueChange={value => {
                void speech.controller.stop().catch(() => {});
                setLanguage(value);
              }}
              options={speechLanguageOptions(locale)}
            />
          </div>
          {refreshButton}
        </div>
      </div>
      {voices.length > 0 && (
        <>
          <div className="grid gap-1">
            <label htmlFor={scope + "-voice"} className="text-xs">
              {copy.voice}
            </label>
            <SearchableSelectField
              id={scope + "-voice"}
              ariaLabel={copy.voice}
              value={findSystemVoice(voices, selected)?.id ?? "auto"}
              disabled={state.loading || !speech.ready || !voices.length}
              onValueChange={value => {
                const next = { ...speech.settings.voices };
                if (value === "auto") delete next[language];
                else next[language] = value;
                save({ ...speech.settings, voices: next });
              }}
              options={[
                { value: "auto", label: copy.automatic },
                ...voices.map(voice => ({
                  value: voice.id,
                  label: [
                    voice.name,
                    voice.language,
                    voice.engine === "narrator" ? narrator.experimental : null,
                    voice.neural
                      ? copy.qualityNeural
                      : voice.quality === "premium"
                        ? copy.qualityPremium
                        : voice.quality === "enhanced"
                          ? copy.qualityEnhanced
                          : voice.quality === "default"
                            ? copy.qualityDefault
                            : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                })),
              ]}
              copy={{ search: copy.search, empty: copy.noResults }}
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor={scope + "-rate"} className="text-xs">
              {copy.rate}
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-ui="speech-trial">
              <div className="min-w-24 flex-1">
                <SelectField
                  id={scope + "-rate"}
                  ariaLabel={copy.rate}
                  value={String(speech.settings.rate)}
                  onValueChange={rate => save({ ...speech.settings, rate: Number(rate) })}
                  options={[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => ({
                    value: String(rate),
                    label: rate + "×",
                  }))}
                  disabled={!speech.ready}
                />
              </div>
              <SpeechButton
                variant="outline"
                size="sm"
                className="h-9 gap-2 text-xs"
                locale={locale}
                speechKey="test"
                scope={scope}
                language={language}
                text={speechSamples[language] ?? ""}
                label={copy.test}
                disabled={state.loading}
              >
                {copy.test}
              </SpeechButton>
            </div>
          </div>
        </>
      )}
      {saveError && (
        <p role="alert" className="text-ui-body text-destructive wrap-anywhere">
          {copy.saveFailed}
        </p>
      )}
      <SpeechStatus locale={locale} language={language} />
      <SiriVoiceDownloads
        controller={speech.controller}
        language={language}
        locale={locale}
        ready={speech.ready}
        onManage={onManageVoices}
        restoreManageFocus={restoreManageFocus}
      />
    </section>
  );
}
