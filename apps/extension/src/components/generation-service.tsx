import React, { useEffect, useState } from "react";
import type { AgentInfo, AgentSettings } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { piCopy } from "../i18n/pi";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { nativeOnce } from "../native/host-client";
import { Button } from "./ui/button";
import { PiFeedback } from "./pi-feedback";

/** Summarize the saved service; account and model changes belong in Settings. */
export function GenerationService({
  locale,
  selected,
  providers,
  available,
  disabled,
  onReady,
  onConfigure,
}: {
  locale: UiLocale;
  selected: AgentSettings;
  providers: AgentInfo[];
  available: boolean;
  disabled: boolean;
  onReady: (ready: boolean) => void;
  onConfigure: () => void;
}) {
  const ui = sidePanelLayoutCopy[locale],
    pi = piCopy[locale];
  const [busy, setBusy] = useState(false);
  const [modelLabel, setModelLabel] = useState("");
  const [stale, setStale] = useState(false);
  const [warning, setWarning] = useState("");
  const connected = providers.filter(provider => provider.installed);
  const provider = connected.find(provider => provider.id === selected.provider);
  useEffect(() => {
    let live = true;
    onReady(false);
    setStale(false);
    setWarning("");
    setModelLabel(selected.modelId || pi.automatic);
    if (!available || !provider) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void nativeOnce({ id: crypto.randomUUID(), type: "agentModels", settings: selected })
      .then(reply => {
        if (!live) return;
        if (reply.type !== "agentModels") throw new Error("Invalid model catalog");
        const model = selected.modelId
          ? reply.models.find(model => model.id === selected.modelId)
          : reply.models.find(model => !model.disabled);
        const valid =
          !reply.notice &&
          !!model &&
          !model.disabled &&
          (!selected.thinkingLevel || !!model.thinkingLevels?.includes(selected.thinkingLevel));
        setModelLabel(model?.label || selected.modelId || pi.automatic);
        setWarning(reply.warning ?? "");
        setStale(!valid);
        onReady(valid);
      })
      .catch(() => {
        if (live) {
          setStale(true);
          onReady(false);
        }
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [available, selected.provider, selected.modelId, provider?.id, onReady]);
  return (
    <div className="my-3 grid gap-2" data-ui="generationService">
      {provider ? (
        <>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 break-words">
              {provider.label} · {modelLabel}
            </span>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onConfigure}>
              {ui.setup}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {busy ? pi.loading : available ? pi.connected : pi.unavailable}
          </p>
          {stale && (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground" role="status">
                {pi.stale}
              </p>
              <Button variant="ghost" className="justify-start px-0" onClick={onConfigure}>
                {ui.setup}
              </Button>
            </div>
          )}
          {!stale && warning && (
            <PiFeedback locale={locale} message={warning} context="modelRefresh" />
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{ui.noService}</p>
          <Button variant="outline" onClick={onConfigure}>
            {ui.setup}
          </Button>
        </>
      )}
    </div>
  );
}
