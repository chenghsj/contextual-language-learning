import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
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
  onSaved: (id: string, created: boolean, config: CustomAgentImport) => void; onRemoved: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const ui = agentOnboardingCopy[locale];
  const [agents, setAgents] = useState<CustomAgentConfig[]>([]);
  const [json, setJson] = useState("");
  const [editing, setEditing] = useState<CustomAgentConfig | null>(null);
  const [validated, setValidated] = useState<CustomAgentImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  const editPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
  }, []);

  useEffect(() => {
    if (editing) editPanelRef.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);

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
    if (copyFeedback === "copying") return;
    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
      copyResetRef.current = null;
    }
    setCopyFeedback("copying");
    try {
      await navigator.clipboard.writeText(AGENT_CONFIG_PROMPT);
      setCopyFeedback("copied");
      copyResetRef.current = window.setTimeout(() => {
        setCopyFeedback("idle");
        copyResetRef.current = null;
      }, 2_000);
    } catch {
      // Clipboard permissions can fail; never claim that the prompt was copied.
      setCopyFeedback("failed");
    }
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
    setTesting("draft");
    setFailed(false);
    setStatus(ui.testing);
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
    finally { setTesting(null); setBusy(false); }
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
        onSaved(editing.id, false, validated);
        resetEditor();
        setStatus(ui.updated);
      } else {
        const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentImport",
          config: validated });
        if (reply.type !== "customAgentImported") throw new Error(ui.error);
        setAgents(reply.agents);
        onSaved(reply.agent.id, true, validated);
        resetEditor();
        setStatus(ui.saved);
      }
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function testSavedAgent(agent: CustomAgentConfig): Promise<void> {
    if (!available || busy || !window.confirm(ui.testWarning)) return;
    setBusy(true);
    setTesting(agent.id);
    setFailed(false);
    setStatus(ui.testing);
    try {
      const reply = await nativeOnce({ id: crypto.randomUUID(), type: "customAgentTest",
        config: agent, modelId: agent.id === selectedProvider ? selectedModelId : "",
        ...(agent.id === selectedProvider && selectedProfileDir
          ? { accountConfigDir: selectedProfileDir } : {}) });
      if (reply.type !== "customAgentTested") throw new Error(ui.error);
      setFailed(false);
      setStatus(ui.tested);
    } catch (error) { report(error); }
    finally { setTesting(null); setBusy(false); }
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

  // Existing-Agent edits must never appear inside the Add Agent onboarding disclosure.
  function renderJsonEditor() {
    return <div className="grid gap-2">
          <strong className="text-xs">{editing ? ui.edit : ui.import}</strong>
          {!editing && <p className="text-xs leading-relaxed text-muted-foreground">{ui.importHelp}</p>}
          <label htmlFor={editing ? "edit-agent-json" : "import-agent-json"} className="text-xs font-semibold">{editing ? ui.edit : ui.import}</label>
          <textarea id={editing ? "edit-agent-json" : "import-agent-json"} rows={7} value={json} placeholder={ui.placeholder}
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
              aria-busy={testing === "draft"} onClick={() => void testAgent()}>
              {testing === "draft" && <span className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
              {testing === "draft" ? ui.testing : ui.test}
            </Button>
            <Button size="sm" disabled={!available || busy || !validated}
              onClick={() => void save()}>{editing ? ui.saveChanges : ui.save}</Button>
          </div>
        </div>;
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
        <Button variant="outline" size="sm" disabled={!available || busy}
          aria-busy={testing === agent.id} onClick={() => void testSavedAgent(agent)}>
          {testing === agent.id && <span className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
          {testing === agent.id ? ui.testing : ui.test}
        </Button>
        <Button variant="outline" size="sm" disabled={!available || busy}
          onClick={() => void remove(agent)}>{ui.remove}</Button>
      </div>
    </div>)}
    {editing && <section ref={editPanelRef}
      className="grid min-w-0 gap-3 rounded-[var(--radius)] border border-border bg-card p-3"
      aria-label={ui.edit + " · " + editing.label} data-ui="editAgentPanel">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold wrap-anywhere">{ui.edit} · {editing.label}</h4>
        <Button variant="ghost" size="sm" disabled={busy} onClick={resetEditor}>{ui.cancel}</Button>
      </div>
      {renderJsonEditor()}
      <p className="text-xs leading-relaxed text-muted-foreground">{ui.safety}</p>
    </section>}
    {!editing && <details className="min-w-0 border border-border p-3" open={agents.length === 0 ? true : undefined}>
      <summary className="cursor-pointer text-sm font-semibold">{ui.add}</summary>
      <div className="mt-3 grid min-w-0 gap-3">
        <div className="grid gap-2">
          <strong className="text-xs">{ui.prompt}</strong>
          <p className="text-xs leading-relaxed text-muted-foreground">{ui.promptHelp}</p>
          <Button variant="outline" size="sm" disabled={copyFeedback === "copying"}
            onClick={() => void copyPrompt()}>
            {copyFeedback === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copyFeedback === "copied" ? ui.copied :
              copyFeedback === "copying" ? ui.copying : ui.copy}
          </Button>
          {copyFeedback === "copied" && <span className="sr-only" role="status" aria-live="polite">{ui.copied}</span>}
          {copyFeedback === "failed" && <p className="text-xs text-destructive" role="alert">{ui.copyFailed}</p>}
        </div>
        {renderJsonEditor()}
        <p className="text-xs leading-relaxed text-muted-foreground">{ui.safety}</p>
      </div>
    </details>}
    {status && <p className={failed ? "text-xs text-destructive wrap-anywhere" :
      "text-xs text-muted-foreground wrap-anywhere"} role="status" aria-live="polite">{status}</p>}
  </section>;
}
