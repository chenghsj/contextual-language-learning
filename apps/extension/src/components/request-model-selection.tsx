import React, { useEffect, useState } from "react";
import type { AgentInfo, AgentModel, AgentSettings } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { nativeOnce } from "../native/host-client";
import { AiModelSelection } from "./ai-model-selection";
import { Button } from "./ui/button";
import { piCopy } from "../i18n/pi";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";
export function RequestModelSelection({
  locale,
  selected,
  providers,
  available,
  onChange,
  onReady,
  onConfigure,
}: {
  locale: UiLocale;
  selected: AgentSettings;
  providers: AgentInfo[];
  available: boolean;
  onChange: (agent: AgentSettings) => void;
  onReady: (ready: boolean) => void;
  onConfigure: () => void;
}) {
  const [models, setModels] = useState<AgentModel[]>([]),
    [busy, setBusy] = useState(true),
    [catalogProvider, setCatalogProvider] = useState(""),
    [notice, setNotice] = useState(""),
    [warning, setWarning] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    if (!available || !selected.provider) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setNotice("");
    setWarning("");
    void nativeOnce({ id: crypto.randomUUID(), type: "agentModels", settings: selected })
      .then(reply => {
        if (!live) return;
        if (reply.type !== "agentModels") throw new Error("Invalid model catalog");
        setModels(reply.models);
        setNotice(reply.notice ?? "");
        setWarning(reply.warning ?? "");
        setCatalogProvider(selected.provider);
      })
      .catch(error => {
        if (live) setNotice(String(error));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [available, selected.provider, refresh]);
  const ui = piCopy[locale];
  const provider = providers.find(item => item.installed && item.id === selected.provider);
  const currentModels = catalogProvider === selected.provider ? models : [];
  const model = selected.modelId
    ? currentModels.find(item => item.id === selected.modelId)
    : currentModels.find(item => !item.disabled);
  const ready = !!(
    available &&
    provider &&
    !busy &&
    !notice &&
    model &&
    !model.disabled &&
    (!selected.thinkingLevel || model.thinkingLevels?.includes(selected.thinkingLevel))
  );
  useEffect(() => {
    onReady(ready);
    return () => onReady(false);
  }, [ready, onReady]);
  return (
    <section className="mt-4 grid min-w-0 gap-2" data-ui="requestAi">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="grid min-w-0 gap-1">
          <h3 className="text-xs font-semibold">{ui.title}</h3>
          {provider && (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="min-w-0 text-[13px] wrap-anywhere">{provider.label}</p>
              <p className="text-xs text-muted-foreground" role="status">
                {busy ? ui.loading : available ? ui.connected : ui.disconnected}
              </p>
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={onConfigure}>
          {sidePanelLayoutCopy[locale].setup}
        </Button>
      </div>
      <AiModelSelection
        request
        locale={locale}
        id="request"
        provider={selected.provider}
        modelId={selected.modelId}
        providers={providers}
        models={currentModels}
        available={available}
        busy={busy}
        notice={notice}
        warning={warning}
        onProvider={provider => onChange({ provider, modelId: "" })}
        onModel={modelId => onChange({ ...selected, modelId, thinkingLevel: undefined })}
        thinkingLevel={selected.thinkingLevel}
        onThinking={thinkingLevel => onChange({ ...selected, thinkingLevel })}
        onRefresh={() => {
          setBusy(true);
          setRefresh(value => value + 1);
        }}
      />
    </section>
  );
}
