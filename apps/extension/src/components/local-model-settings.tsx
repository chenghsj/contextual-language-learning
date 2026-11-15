import React, { useEffect, useState } from "react";
import { LocalModelInputSchema, type LocalModelConfig } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { localModelCopy } from "../i18n/local-model";
import { piFeedback } from "../i18n/pi-feedback";
import { nativeOnce } from "../native/host-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const initial: LocalModelConfig = {
  baseUrl: "http://localhost:11434/v1",
  modelId: "",
  contextWindow: 32768,
  maxTokens: 8192,
  reasoning: false,
};
export function LocalModelSettings({
  locale,
  available,
  onSaved,
  onDirty,
  onBusy,
}: {
  locale: UiLocale;
  available: boolean;
  onSaved: (config: LocalModelConfig) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const ui = localModelCopy[locale];
  const [config, setConfig] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "save" | "">("");
  const [error, setError] = useState("");
  const [tested, setTested] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void nativeOnce({ id: crypto.randomUUID(), type: "getLocalModelConfig" })
      .then(reply => {
        if (!active) return;
        setConfig(reply.config ?? initial);
        setSaved(reply.config ?? initial);
        setHasKey(reply.hasApiKey);
      })
      .catch(() => {
        if (active) setError(ui.loadFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const dirty = JSON.stringify(config) !== JSON.stringify(saved) || !!apiKey || clearKey;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(!!busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  function update<K extends keyof LocalModelConfig>(key: K, value: LocalModelConfig[K]) {
    setConfig(current => ({ ...current, [key]: value }));
    setError("");
    setTested(false);
    if (key === "baseUrl") setModels([]);
  }
  async function run(action: "test" | "save") {
    const parsed = LocalModelInputSchema.safeParse({
      config,
      apiKey: apiKey || (clearKey ? "" : undefined),
    });
    // Testing the endpoint is useful before a model has been selected.
    const input =
      action === "test" && !config.modelId.trim()
        ? LocalModelInputSchema.safeParse({
            config: { ...config, modelId: "connection-test" },
            apiKey: apiKey || (clearKey ? "" : undefined),
          })
        : parsed;
    if (!input.success) {
      setError(ui.invalid);
      return;
    }
    setBusy(action);
    setError("");
    setTested(false);
    try {
      if (action === "test") {
        const reply = await nativeOnce({
          id: crypto.randomUUID(),
          type: "testLocalModelConfig",
          ...input.data,
        });
        setModels(reply.modelIds);
        if (!config.modelId && reply.modelIds[0]) update("modelId", reply.modelIds[0]);
        setTested(true);
      } else {
        const reply = await nativeOnce({
          id: crypto.randomUUID(),
          type: "setLocalModelConfig",
          ...input.data,
        });
        if (reply.config) {
          setConfig(reply.config);
          setSaved(reply.config);
        }
        setHasKey(reply.hasApiKey);
        setApiKey("");
        setClearKey(false);
        if (reply.config) await onSaved(reply.config);
      }
    } catch (cause) {
      const message = String(cause);
      setError(
        /credential|Keychain|DPAPI/i.test(message) || action === "save"
          ? piFeedback(locale, message).message
          : /model list/.test(message)
            ? ui.invalidList
            : ui.failed,
      );
    } finally {
      setBusy("");
    }
  }
  const disabled = !available || loading || !!busy;
  return (
    <form
      data-ui="local-model-settings"
      className="grid min-w-0 gap-3"
      aria-busy={loading || !!busy}
      onSubmit={event => {
        event.preventDefault();
        void run("save");
      }}
    >
      <p className="text-ui-body text-muted-foreground">{ui.hint}</p>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="local-model-address" className="text-xs font-semibold">
            {ui.address}
          </label>
          <Input
            id="local-model-address"
            type="url"
            required
            value={config.baseUrl}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="http://localhost:11434/v1"
            onChange={event => update("baseUrl", event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="local-model-id" className="text-xs font-semibold">
            {ui.model}
          </label>
          <Input
            id="local-model-id"
            required
            value={config.modelId}
            list="local-model-options"
            autoCapitalize="none"
            spellCheck={false}
            onChange={event => update("modelId", event.target.value)}
          />
          <datalist id="local-model-options">
            {models.map(id => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="local-model-key" className="text-xs font-semibold">
            {ui.key}
          </label>
          <Input
            id="local-model-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={
              hasKey && config.baseUrl.replace(/\/+$/, "") === saved.baseUrl && !clearKey
                ? ui.savedKey
                : ""
            }
            onChange={event => {
              setApiKey(event.target.value);
              setError("");
              setTested(false);
            }}
          />
          {hasKey && (
            <label className="flex min-h-9 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={clearKey}
                onChange={event => {
                  setClearKey(event.target.checked);
                  setTested(false);
                }}
              />
              {ui.clearKey}
            </label>
          )}
        </div>
        <details className="min-w-0">
          <summary className="min-h-9 cursor-pointer py-2 text-ui-heading font-semibold focus-visible:outline focus-visible:outline-ring">
            {ui.advanced}
          </summary>
          <div className="grid gap-3 pt-1">
            {(["contextWindow", "maxTokens"] as const).map(key => (
              <div key={key} className="grid gap-1.5">
                <label htmlFor={`local-model-${key}`} className="text-xs font-semibold">
                  {key === "contextWindow" ? ui.context : ui.output}
                </label>
                <Input
                  id={`local-model-${key}`}
                  type="number"
                  min={key === "maxTokens" ? 256 : 1024}
                  max={key === "maxTokens" ? config.contextWindow : 2000000}
                  step={1}
                  required
                  value={Number.isNaN(config[key]) ? "" : config[key]}
                  onChange={event => update(key, event.target.valueAsNumber)}
                />
              </div>
            ))}
            <label className="flex min-h-9 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={config.reasoning}
                onChange={event => update("reasoning", event.target.checked)}
              />
              {ui.reasoning}
            </label>
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void run("test")}>
            {busy === "test" ? ui.testing : ui.test}
          </Button>
          <Button type="submit">{busy === "save" ? ui.saving : ui.save}</Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="break-words text-ui-body text-destructive">
          {error}
        </p>
      )}
      {tested && (
        <p role="status" className="break-words text-ui-body text-muted-foreground">
          {models.length ? `${ui.tested} ${models.join(", ")}` : ui.empty}
        </p>
      )}
    </form>
  );
}
