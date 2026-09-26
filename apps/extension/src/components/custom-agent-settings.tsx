import { useEffect, useState } from "react";
import { CustomAgentConfigSchema, type CustomAgentConfig, type HostMessage } from "@immersive/core";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";
import { translate, type UiLocale } from "../i18n/messages";

type Once = (request: { id: string; type: string; [key: string]: unknown }) => Promise<HostMessage>;
const templates: Record<string, Partial<CustomAgentConfig>> = {
  gemini: { label: "Gemini CLI", executable: "gemini", args: ["--output-format", "json"],
    promptMode: "stdin", outputMode: "stdout-json", modelArgument: "--model" },
  argument: { label: "", executable: "", args: ["--prompt", "{prompt}"],
    promptMode: "argument", outputMode: "stdout-json" },
  stdin: { label: "", executable: "", args: [], promptMode: "stdin", outputMode: "stdout-json" },
  file: { label: "", executable: "", args: ["--output", "{output}"],
    promptMode: "stdin", outputMode: "file-json" },
};
function fresh(): CustomAgentConfig {
  return { id: "custom-" + crypto.randomUUID().replaceAll("-", "").slice(0, 24),
    label: "", executable: "", args: ["--prompt", "{prompt}"],
    promptMode: "argument", outputMode: "stdout-json" };
}
function lines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function CustomAgentSettings({ locale, available, selectedProvider, selectedModelId,
  selectedProfileDir, nativeOnce, onSaved, onRemoved,
}: {
  locale: UiLocale; available: boolean; selectedProvider: string; selectedModelId: string;
  selectedProfileDir?: string; nativeOnce: Once; onSaved: (id: string) => void;
  onRemoved: (id: string) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [agents, setAgents] = useState<CustomAgentConfig[]>([]);
  const [draft, setDraft] = useState<CustomAgentConfig>(fresh);
  const [argv, setArgv] = useState("--prompt\n{prompt}");
  const [modelArgv, setModelArgv] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const update = (patch: Partial<CustomAgentConfig>) => setDraft(previous => ({ ...previous, ...patch }));
  const config = () => ({ ...draft, args: lines(argv), modelListArgs: lines(modelArgv),
    modelArgument: draft.modelArgument?.trim() || undefined,
    profileEnvVar: draft.profileEnvVar?.trim() || undefined });
  const report = (error: unknown) => {
    setFailed(true);
    setStatus(error instanceof Error ? error.message : t("customAgentError"));
  };

  useEffect(() => {
    if (!available) return;
    let active = true;
    void nativeOnce({ id: crypto.randomUUID(), type: "customAgentList" }).then(reply => {
      if (active && reply.type === "customAgentList") setAgents(reply.agents);
    }).catch(error => { if (active) report(error); });
    return () => { active = false; };
    // Only reload on availability changes, not each parent render of nativeOnce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  function edit(value: CustomAgentConfig): void {
    setDraft(value); setArgv(value.args.join("\n"));
    setModelArgv((value.modelListArgs ?? []).join("\n"));
    setTemplate(""); setStatus(""); setFailed(false);
  }
  function chooseTemplate(value: string): void {
    setTemplate(value);
    const preset = templates[value];
    if (!preset) return;
    update({ modelArgument: undefined, modelListArgs: undefined, profileEnvVar: undefined, ...preset });
    setArgv((preset.args ?? []).join("\n")); setModelArgv("");
  }
  async function probe(): Promise<void> {
    setBusy(true); setStatus(""); setFailed(false);
    try {
      const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentProbe",
        executable: draft.executable.trim() });
      if (reply.type !== "customAgentProbed") throw new Error(t("customAgentError"));
      setStatus(reply.installed ? t("customAgentDetected") + ": " + (reply.resolved ?? draft.executable)
        : t("customAgentNotFound"));
      setFailed(!reply.installed);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function submit(action: "save" | "test"): Promise<void> {
    const valid = CustomAgentConfigSchema.safeParse(config());
    if (!valid.success) { report(valid.error.issues[0]?.message ?? t("customAgentError")); return; }
    setBusy(true); setStatus(""); setFailed(false);
    try {
      const reply = await nativeOnce(action === "save"
        ? { id: crypto.randomUUID(), type: "customAgentSave", config: valid.data }
        : { id: crypto.randomUUID(), type: "customAgentTest", config: valid.data,
          modelId: selectedProvider === valid.data.id ? selectedModelId : "",
          ...(selectedProvider === valid.data.id && selectedProfileDir
            ? { accountConfigDir: selectedProfileDir } : {}) });
      if (action === "save" && reply.type === "customAgentList") {
        setAgents(reply.agents); setStatus(t("customAgentSaved")); onSaved(valid.data.id);
      } else if (action === "test" && reply.type === "customAgentTested") {
        setStatus(t("customAgentTestPassed") + ": " + reply.label);
      } else throw new Error(t("customAgentError"));
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function remove(value: CustomAgentConfig): Promise<void> {
    if (!window.confirm(t("customAgentRemoveConfirm"))) return;
    setBusy(true); setStatus(""); setFailed(false);
    try {
      const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentRemove",
        agentId: value.id });
      if (reply.type !== "customAgentList") throw new Error(t("customAgentError"));
      setAgents(reply.agents);
      if (draft.id === value.id) edit(fresh());
      onRemoved(value.id);
      setStatus(t("customAgentRemoved"));
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }

  return <details className="mt-[15px] rounded-[var(--radius)] border border-border px-[11px] py-[10px] text-xs [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:font-semibold" data-ui="agentProfileAdvanced">
    <summary className="cursor-pointer font-semibold">{t("customAgentsHeading")}</summary>
    <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("customAgentsHint")}</p>
    {agents.length > 0 && <div className="mt-3 grid gap-2">
      {agents.map(value => <div key={value.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border border-border p-2 [&_span]:min-w-0 [&_span]:flex-1 [&_span]:wrap-anywhere [&_strong]:block [&_small]:block [&_small]:text-[11px] [&_small]:text-muted-foreground">
        <span><strong>{value.label}</strong><small>{value.executable}</small></span>
        <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
          <Button variant="outline" size="sm" disabled={busy}
            onClick={() => edit(value)}>{t("customAgentEdit")}</Button>
          <Button variant="outline" size="sm" disabled={busy}
            onClick={() => void remove(value)}>{t("customAgentRemove")}</Button>
        </div>
      </div>)}
    </div>}
    <div className="grid min-w-0 gap-[11px] pt-[11px] [&_label]:min-w-0 [&_label]:gap-[5px] [&_label]:text-xs [&_[data-ui=agentProfileAdvanced]]:m-0 [&_[data-ui=agentProfileAdvanced]>label]:mt-[10px] [&_[data-ui=actions]]:gap-[6px]">
      <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentTemplate")}
        <SelectField ariaLabel={t("customAgentTemplate")} disabled={busy}
          value={template} onValueChange={chooseTemplate} options={[
            { value: "", label: t("customAgentManual") },
            { value: "gemini", label: "Gemini CLI" },
            { value: "argument", label: t("customAgentArgumentTemplate") },
            { value: "stdin", label: t("customAgentStdinTemplate") },
            { value: "file", label: t("customAgentFileTemplate") },
          ]} />
      </label>
      <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentName")}
        <Input disabled={busy} maxLength={80} value={draft.label}
          placeholder={t("customAgentNamePlaceholder")}
          onChange={event => update({ label: event.target.value })} />
      </label>
      <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentExecutable")}
        <Input disabled={busy} maxLength={1024} value={draft.executable}
          placeholder={t("customAgentExecutablePlaceholder")}
          onChange={event => update({ executable: event.target.value })} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
        <Button variant="outline" size="sm" disabled={!available || busy || !draft.executable.trim()}
          onClick={() => void probe()}>{t("customAgentDetect")}</Button>
      </div>
      <details className="mt-[10px] rounded-[var(--radius)] border border-border px-[11px] py-[10px] text-xs [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:font-semibold" data-ui="agentProfileAdvanced">
        <summary className="cursor-pointer font-semibold">{t("customAgentAdvanced")}</summary>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentPromptMode")}
          <SelectField ariaLabel={t("customAgentPromptMode")} value={draft.promptMode}
            disabled={busy} onValueChange={value =>
              update({ promptMode: value as CustomAgentConfig["promptMode"] })}
            options={[{ value: "argument", label: t("customAgentArgument") },
              { value: "stdin", label: t("customAgentStdin") }]} />
        </label>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentOutputMode")}
          <SelectField ariaLabel={t("customAgentOutputMode")} value={draft.outputMode}
            disabled={busy} onValueChange={value =>
              update({ outputMode: value as CustomAgentConfig["outputMode"] })}
            options={[{ value: "stdout-json", label: t("customAgentStdout") },
              { value: "file-json", label: t("customAgentFile") }]} />
        </label>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentArgs")}
          <textarea className="block w-full min-w-0 resize-y rounded-[var(--radius)] border border-border bg-background px-[10px] py-[9px] font-mono text-xs leading-[1.5] text-foreground wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1" disabled={busy} rows={4}
            aria-label={t("customAgentArgs")} value={argv}
            onChange={event => setArgv(event.target.value)} />
        </label>
        <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("customAgentPlaceholders")}</p>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentModelArgument")}
          <Input disabled={busy} maxLength={64} value={draft.modelArgument ?? ""}
            placeholder="--model" onChange={event => update({ modelArgument: event.target.value })} />
        </label>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentModelsCommand")}
          <textarea className="block w-full min-w-0 resize-y rounded-[var(--radius)] border border-border bg-background px-[10px] py-[9px] font-mono text-xs leading-[1.5] text-foreground wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1" disabled={busy} rows={2}
            aria-label={t("customAgentModelsCommand")} value={modelArgv}
            onChange={event => setModelArgv(event.target.value)} />
        </label>
        <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("customAgentProfileEnv")}
          <Input disabled={busy} value={draft.profileEnvVar ?? ""} placeholder="GEMINI_CLI_HOME"
            onChange={event => update({ profileEnvVar: event.target.value })} />
        </label>
      </details>
      <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("customAgentSafety")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(fresh())}>
          {t("customAgentNew")}</Button>
        <Button variant="outline" size="sm" disabled={!available || busy}
          onClick={() => void submit("test")}>{t("customAgentTest")}</Button>
        <Button size="sm" disabled={!available || busy}
          onClick={() => void submit("save")}>{t("customAgentSave")}</Button>
      </div>
      {status && <p className={failed ? "my-[5px] text-[11px] text-destructive wrap-anywhere" : "my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"} data-ui={failed ? undefined : "hint"} role="status">{status}</p>}
    </div>
  </details>;
}
