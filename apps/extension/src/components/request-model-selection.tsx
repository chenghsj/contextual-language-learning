import { useEffect, useState } from "react";
import type { AgentInfo, AgentModel, AgentSettings } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { nativeOnce } from "../native/host-client";
import { AiModelSelection } from "./ai-model-selection";
export function RequestModelSelection({
  locale,
  selected,
  providers,
  available,
  onChange,
  onError,
}: {
  locale: UiLocale;
  selected: AgentSettings;
  providers: AgentInfo[];
  available: boolean;
  onChange: (agent: AgentSettings) => void;
  onError: (error: string) => void;
}) {
  const [models, setModels] = useState<AgentModel[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setModels([]);
    if (!available || !selected.provider) return;
    setBusy(true);
    setNotice("");
    void nativeOnce({ id: crypto.randomUUID(), type: "agentModels", settings: selected })
      .then(reply => {
        if (live && reply.type === "agentModels") setModels(reply.models);
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
  return (
    <AiModelSelection
      locale={locale}
      id="request"
      provider={selected.provider}
      modelId={selected.modelId}
      providers={providers}
      models={models}
      available={available}
      busy={busy}
      notice={notice}
      onProvider={provider => onChange({ provider, modelId: "" })}
      onModel={modelId => onChange({ ...selected, modelId, thinkingLevel: undefined })}
      thinkingLevel={selected.thinkingLevel}
      onThinking={thinkingLevel => onChange({ ...selected, thinkingLevel })}
      onRefresh={() => setRefresh(value => value + 1)}
    />
  );
}
