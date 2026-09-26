import { useEffect, useState } from "react";
import { type CustomAgentConfig, type CustomAgentImport, type HostMessage } from "@immersive/core";
import { AGENT_CONFIG_PROMPT, jsonForEdit, parseAgentImport } from "../agent-import";
import { agentOnboardingCopy } from "../i18n/agent-onboarding";
import type { UiLocale } from "../i18n/messages";
import { Button } from "./ui/button";

type Once = (request: { id: string; type: string; [key: string]: unknown }) => Promise<HostMessage>;

/** Each Agent is an imported definition; no provider-specific preset is needed. */
export function CustomAgentSettings({ locale, available, selectedProvider, selectedModelId,
  selectedProfileDir, nativeOnce, onSaved, onRemoved, onSelect,
}: {
  locale: UiLocale; available: boolean; selectedProvider: string; selectedModelId: string;
  selectedProfileDir?: string; nativeOnce: Once;
  onSaved: (id: string, created: boolean) => void; onRemoved: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const ui = agentOnboardingCopy[locale];
  const [agents, setAgents] = useState<CustomAgentConfig[]>([]);
  const [json, setJson] = useState("");
  const [editing, setEditing] = useState<CustomAgentConfig | null>(null);
  const [validated, setValidated] = useState<CustomAgentImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void nativeOnce({ id: crypto.randomUUID(), type: "customAgentList" }).then(reply => {
      if (active && reply.type === "customAgentList") setAgents(reply.agents);
    }).catch(error => {
      if (active) {
        setFailed(true);
        setStatus(error instanceof Error ? error.message : ui.error);
      }
    });
    return () => { active = false; };
    // Listing is keyed to Host availability, not unstable parent callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  function report(error: unknown): void {
    setFailed(true);
    setStatus(error instanceof Error ? error.message : ui.error);
  }
  function edit(agent: CustomAgentConfig): void {
    const { id: _id, ...definition } = agent;
    setEditing(agent);
    setJson(jsonForEdit(definition));
    setValidated(null);
    setStatus("");
    setFailed(false);
  }
  function resetEditor(): void {
    setEditing(null);
    setJson("");
    setValidated(null);
    setStatus("");
    setFailed(false);
  }
  function validate(): void {
    try {
      const config = parseAgentImport(json);
      setValidated(config);
      setFailed(false);
      setStatus(ui.valid);
    } catch (error) {
      setValidated(null);
      report(error);
    }
  }
  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(AGENT_CONFIG_PROMPT);
      setFailed(false);
      setStatus(ui.copied);
    } catch (error) { report(error); }
  }
  async function detect(): Promise<void> {
    if (!validated || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const reply = await nativeOnce({ id: crypto.randomUUID(),
        type: "customAgentProbe", executable: validated.executable });
      if (reply.type !== "customAgentProbed") throw new Error(ui.error);
      setFailed(!reply.installed);
      setStatus(reply.installed ? ui.detected + ": " + (reply.resolved ?? validated.executable) : ui.missing);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function testAgent(): Promise<void> {
    if (!validated || !available || busy || !window.confirm(ui.testWarning)) return;
    setBusy(true);
    setStatus("");
    try {
      const config: CustomAgentConfig = {
        ...validated, id: editing?.id ?? "custom-" + crypto.randomUUID().replaceAll("-", "").slice(0, 24),
      };
      const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentTest",
        config, modelId: editing?.id === selectedProvider ? selectedModelId : "",
        ...(editing?.id === selectedProvider && selectedProfileDir
          ? { accountConfigDir: selectedProfileDir } : {}) });
      if (reply.type !== "customAgentTested") throw new Error(ui.error);
      setFailed(false);
      setStatus(ui.tested);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function save(): Promise<void> {
    if (!validated || !available || busy) return;
    setBusy(true);
    setStatus("");
    try {
      if (editing) {
        const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentSave",
          config: { ...validated, id: editing.id } });
        if (reply.type !== "customAgentList") throw new Error(ui.error);
        setAgents(reply.agents);
        onSaved(editing.id, false);
        resetEditor();
        setStatus(ui.updated);
      } else {
        const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentImport",
          config: validated });
        if (reply.type !== "customAgentImported") throw new Error(ui.error);
        setAgents(reply.agents);
        onSaved(reply.agent.id, true);
        resetEditor();
        setStatus(ui.saved);
      }
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function remove(agent: CustomAgentConfig): Promise<void> {
    if (!available || busy || !window.confirm(ui.confirmRemove)) return;
    setBusy(true);
    setStatus("");
    try {
      const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentRemove",
        agentId: agent.id });
      if (reply.type !== "customAgentList") throw new Error(ui.error);
      setAgents(reply.agents);
      if (editing?.id === agent.id) resetEditor();
      onRemoved(agent.id);
      setFailed(false);
      setStatus(ui.removed);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }

  return <section className="mt-3 grid min-w-0 gap-3" data-ui="customAgentSettings">
    <h3 className="text-sm font-semibold">{ui.heading}</h3>
    <p className="text-xs leading-relaxed text-muted-foreground">{ui.hint}</p>
    {agents.length === 0 && <p className="text-xs text-muted-foreground">{ui.empty}</p>}
    {agents.map(agent => <div key={agent.id} className="grid min-w-0 gap-2 border border-border p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0"><strong className="block text-sm wrap-anywhere">{agent.label}</strong>
          <p className="text-xs text-muted-foreground wrap-anywhere">{agent.executable}</p></div>
        {selectedProvider === agent.id && <span className="shrink-0 text-xs text-primary">{ui.inUse}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || selectedProvider === agent.id}
          onClick={() => onSelect(agent.id)}>{ui.use}</Button>
        <Button variant="outline" size="sm" disabled={busy}
          onClick={() => edit(agent)}>{ui.edit}</Button>
        <Button variant="outline" size="sm" disabled={busy}
          onClick={() => void remove(agent)}>{ui.remove}</Button>
      </div>
    </div>)}
    <details className="min-w-0 border border-border p-3" open={agents.length === 0 ? true : undefined}>
      <summary className="cursor-pointer text-sm font-semibold">{ui.add}</summary>
      <div className="mt-3 grid min-w-0 gap-3">
        <div className="grid gap-2">
          <strong className="text-xs">{ui.prompt}</strong>
          <p className="text-xs leading-relaxed text-muted-foreground">{ui.promptHelp}</p>
          <Button variant="outline" size="sm" onClick={() => void copyPrompt()}>{ui.copy}</Button>
        </div>
        <div className="grid gap-2">
          <strong className="text-xs">{ui.import}</strong>
          <p className="text-xs leading-relaxed text-muted-foreground">{ui.importHelp}</p>
          <label htmlFor="import-agent-json" className="text-xs font-semibold">{ui.import}</label>
          <textarea id="import-agent-json" rows={7} value={json} placeholder={ui.placeholder}
            disabled={busy} onChange={event => {
              setJson(event.target.value); setValidated(null); setStatus(""); setFailed(false);
            }}
            className="w-full min-w-0 resize-y rounded-[var(--radius)] border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-ring" />
          <Button variant="outline" size="sm" disabled={busy || !json.trim()}
            onClick={validate}>{ui.validate}</Button>
          {validated && <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-border p-2 text-xs">
            <strong>{ui.preview}</strong>
            <span className="wrap-anywhere">{validated.executable}</span>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(validated.args)}</pre>
          </div>}
          {!available && <p className="text-xs text-muted-foreground">{ui.noHost}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!available || busy || !validated}
              onClick={() => void detect()}>{ui.detect}</Button>
            <Button variant="outline" size="sm" disabled={!available || busy || !validated}
              onClick={() => void testAgent()}>{ui.test}</Button>
            <Button size="sm" disabled={!available || busy || !validated}
              onClick={() => void save()}>{editing ? ui.saveChanges : ui.save}</Button>
            {editing && <Button variant="ghost" size="sm" disabled={busy}
              onClick={resetEditor}>{ui.cancel}</Button>}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{ui.safety}</p>
      </div>
    </details>
    {status && <p className={failed ? "text-xs text-destructive wrap-anywhere" :
      "text-xs text-muted-foreground wrap-anywhere"} role="status">{status}</p>}
  </section>;
}
