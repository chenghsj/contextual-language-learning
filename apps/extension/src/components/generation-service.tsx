import React, { useEffect, useState } from "react";
import type { AgentInfo, AgentSettings } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { piCopy } from "../i18n/pi";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { savedAgentModel } from "../i18n/agent-model-preferences";
import { nativeOnce } from "../native/host-client";
import { Button } from "./ui/button";
import { SearchableSelectField } from "./searchable-select-field";

/** A per-generation service choice never writes the saved default or credentials. */
export function GenerationService({ locale, selected, defaultAgent, providers, available, modelPreferences,
  disabled, onChange, onReady, onConfigure }: {
  locale: UiLocale; selected: AgentSettings; defaultAgent: AgentSettings; providers: AgentInfo[];
  available: boolean; modelPreferences: Record<string, string>; disabled: boolean;
  onChange: (agent: AgentSettings | null) => void; onReady: (ready: boolean) => void; onConfigure: () => void;
}) {
  const ui = sidePanelLayoutCopy[locale], pi = piCopy[locale];
  const [busy, setBusy] = useState(false);
  const [modelLabel, setModelLabel] = useState("");
  const [stale, setStale] = useState(false);
  const connected = providers.filter(provider => provider.installed);
  const provider = connected.find(provider => provider.id === selected.provider);
  useEffect(() => {
    let live = true;
    onReady(false); setStale(false); setModelLabel(selected.modelId || pi.automatic);
    if (!available || !provider) { setBusy(false); return; }
    setBusy(true);
    void nativeOnce({ id: crypto.randomUUID(), type: "agentModels", settings: selected }).then(reply => {
      if (!live) return;
      if (reply.type !== "agentModels") throw new Error("Invalid model catalog");
      const model = reply.models.find(model => model.id === selected.modelId);
      const valid = !selected.modelId || !!model;
      setModelLabel(model?.label || selected.modelId || pi.automatic);
      setStale(!valid); onReady(valid);
    }).catch(() => { if (live) { setStale(true); onReady(false); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [available, selected.provider, selected.modelId, provider?.id, onReady]);
  return <div className="my-3 grid gap-2" data-ui="generationService">
    {provider ? <>
      <SearchableSelectField ariaLabel={ui.chooseService} value={selected.provider}
        disabled={disabled || !available}
        options={connected.map(item => ({ value: item.id,
          label: `${item.label} · ${item.id === selected.provider ? modelLabel || selected.modelId || pi.automatic : savedAgentModel(item.id, undefined, modelPreferences) || pi.automatic}` }))}
        copy={{ search: ui.searchService, empty: ui.noMatchingService }}
        onValueChange={providerId => onChange(providerId === defaultAgent.provider ? null : {
          provider: providerId, modelId: savedAgentModel(providerId, undefined, modelPreferences)
        })} />
      <p className="text-xs text-muted-foreground" role="status">{busy ? pi.loading : available ? pi.connected : pi.unavailable}</p>
      {stale && <div className="grid gap-1"><p className="text-xs text-muted-foreground" role="status">{pi.stale}</p>
        <Button variant="ghost" className="justify-start px-0" onClick={onConfigure}>{ui.setup}</Button></div>}
    </> : <><p className="text-xs text-muted-foreground">{ui.noService}</p><Button variant="outline" onClick={onConfigure}>{ui.setup}</Button></>}
  </div>;
}
