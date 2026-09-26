import { useEffect, useMemo, useState } from "react";
import type { CustomAgentDefinition, HostMessage } from "@immersive/core";
import type { MessageKey, MessageParams } from "../i18n/messages";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { SelectField } from "./ui/select";
import { CUSTOM_AGENT_TEMPLATES } from "../custom-agent-templates";

type NativeRequest = (request: { id: string; type: string; [key: string]: unknown }) => Promise<HostMessage>;
type T = (key: MessageKey, params?: MessageParams) => string;

function slug(label: string): string {
  const body = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 30);
  return "custom-" + (body || "agent");
}

export function CustomAgentSettings(props: {
  nativeRequest: NativeRequest; onCatalogChanged(): void; t: T;
}): React.JSX.Element {
  const { nativeRequest, onCatalogChanged, t } = props;
  const [agents, setAgents] = useState<CustomAgentDefinition[]>([]);
  const [editingId, setEditingId] = useState("");
  const [label, setLabel] = useState("");
  const [executable, setExecutable] = useState("");
  const [argsText, setArgsText] = useState("");
  const [modelArgument, setModelArgument] = useState("");
  const [responsePath, setResponsePath] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const [promptMode, setPromptMode] = useState<"argument" | "stdin">("argument");
  const [outputMode, setOutputMode] = useState<"stdout-json" | "file-json" | "ndjson-text">("stdout-json");
  const [profileEnvVar, setProfileEnvVar] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState(180);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const definition = useMemo<CustomAgentDefinition>(() => ({
    id: editingId || slug(label),
    label: label.trim(),
    executable: executable.trim(),
    args: argsText.split("\n").map(value => value.trim()).filter(Boolean),
    ...(modelArgument.trim() ? { modelArgument: modelArgument.trim() } : {}),
    ...(responsePath.trim() ? { responsePath: responsePath.trim() } : {}),
    promptMode, outputMode,
    ...(profileEnvVar.trim() ? { profileEnvVar: profileEnvVar.trim() } : {}),
    timeoutSeconds,
  }), [editingId, label, executable, argsText, modelArgument, responsePath, promptMode, outputMode, profileEnvVar, timeoutSeconds]);

  async function load(): Promise<void> {
    const response = await nativeRequest({ id: crypto.randomUUID(), type: "customAgents" });
    if (response.type !== "customAgents") throw new Error("Unexpected custom Agent response.");
    setAgents(response.agents);
  }

  useEffect(() => { void load().catch(() => undefined); }, []);

  function edit(agent?: CustomAgentDefinition): void {
    setEditingId(agent?.id ?? "");
    setLabel(agent?.label ?? "");
    setExecutable(agent?.executable ?? "");
    setArgsText(agent?.args.join("\n") ?? "");
    setModelArgument(agent?.modelArgument ?? "");
    setResponsePath(agent?.responsePath ?? "");
    setTemplateId("blank");
    setPromptMode(agent?.promptMode ?? "argument");
    setOutputMode(agent?.outputMode ?? "stdout-json");
    setProfileEnvVar(agent?.profileEnvVar ?? "");
    setTimeoutSeconds(agent?.timeoutSeconds ?? 180);
    setStatus("");
  }

  async function applyTemplate(id: string): Promise<void> {
    setTemplateId(id);
    const template = CUSTOM_AGENT_TEMPLATES.find(item => item.id === id);
    if (!template) { edit(); return; }
    setEditingId("");
    setLabel(template.definition.label);
    setExecutable(template.definition.executable);
    setArgsText(template.definition.args.join("\\n"));
    setModelArgument(template.definition.modelArgument ?? "");
    setResponsePath(template.definition.responsePath ?? "");
    setPromptMode(template.definition.promptMode ?? "argument");
    setOutputMode(template.definition.outputMode ?? "stdout-json");
    setProfileEnvVar(template.definition.profileEnvVar ?? "");
    setTimeoutSeconds(template.definition.timeoutSeconds ?? 180);
    setStatus("");
    try {
      const response = await nativeRequest({ id: crypto.randomUUID(), type: "customAgentTest", definition: template.definition });
      setStatus(response.type === "customAgentTest"
        ? t("customAgentTemplateDetected") : t("customAgentTemplateMissing"));
    } catch { setStatus(t("customAgentTemplateMissing")); }
  }

  async function act(type: "customAgentSave" | "customAgentTest" | "customAgentRemove"): Promise<void> {
    if (busy) return;
    setBusy(true); setStatus("");
    try {
      const request = type === "customAgentRemove"
        ? { id: crypto.randomUUID(), type, agentId: definition.id }
        : { id: crypto.randomUUID(), type, definition };
      const response = await nativeRequest(request);
      if (response.type === "error") throw new Error(response.message);
      if (response.type === "customAgentTest") {
        setStatus(t("customAgentFound", { path: response.executable }));
      } else if (response.type === "customAgents") {
        setAgents(response.agents);
        setStatus(t(type === "customAgentRemove" ? "customAgentRemoved" : "customAgentSaved"));
        if (type === "customAgentRemove") edit();
        onCatalogChanged();
      } else throw new Error("Unexpected custom Agent response.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("customAgentError"));
    } finally { setBusy(false); }
  }

  return <details className="customAgentManager">
    <summary>{t("customAgents")}</summary>
    <p className="hint">{t("customAgentsHint")}</p>
    {agents.length > 0 && <div className="customAgentList">
      {agents.map(item => <Button key={item.id} variant="outline" size="sm"
        onClick={() => edit(item)}>{item.label} · {item.executable}</Button>)}
    </div>}
    <Button variant="outline" size="sm" onClick={() => edit()}>{t("customAgentAdd")}</Button>
    <label>{t("customAgentTemplate")}
      <SelectField ariaLabel={t("customAgentTemplate")} value={templateId}
        onValueChange={value => void applyTemplate(value)} options={[
          { value: "blank", label: t("customAgentTemplateCustom") },
          { value: "gemini", label: t("customAgentTemplateGemini") },
          { value: "opencode", label: t("customAgentTemplateOpenCode") },
        ]} />
    </label>
    <label>{t("customAgentName")}
      <Input value={label} onChange={event => {
        if (!editingId) setEditingId("");
        setLabel(event.target.value);
      }} placeholder={t("customAgentNamePlaceholder")} />
    </label>
    <label>{t("customAgentExecutable")}
      <Input value={executable} onChange={event => setExecutable(event.target.value)}
        placeholder={t("customAgentExecutablePlaceholder")} />
    </label>
    <label>{t("customAgentArgs")}
      <Textarea value={argsText} onChange={event => setArgsText(event.target.value)} rows={4} />
      <span className="hint">{t("customAgentArgsHint")}</span>
    </label>
    <label>{t("customAgentModelArgument")}
      <Input value={modelArgument} onChange={event => setModelArgument(event.target.value)}
        placeholder={t("customAgentModelArgumentPlaceholder")} />
    </label>
    <details className="agentProfileAdvanced">
      <summary>{t("customAgentAdvanced")}</summary>
      <label>{t("customAgentPromptMode")}
        <SelectField ariaLabel={t("customAgentPromptMode")} value={promptMode}
          onValueChange={value => setPromptMode(value === "stdin" ? "stdin" : "argument")} options={[
            { value: "argument", label: t("customAgentPromptArgument") },
            { value: "stdin", label: t("customAgentPromptStdin") },
          ]} />
      </label>
      <label>{t("customAgentOutputMode")}
        <SelectField ariaLabel={t("customAgentOutputMode")} value={outputMode}
          onValueChange={value => setOutputMode(value === "file-json" ? "file-json" : value === "ndjson-text" ? "ndjson-text" : "stdout-json")} options={[
            { value: "stdout-json", label: t("customAgentOutputStdout") },
            { value: "file-json", label: t("customAgentOutputFile") },
            { value: "ndjson-text", label: t("customAgentOutputNdjson") },
          ]} />
      </label>
      <label>{t("customAgentResponsePath")}
        <Input value={responsePath} onChange={event => setResponsePath(event.target.value)}
          placeholder={outputMode === "ndjson-text" ? "part.text" : "response"} />
        <span className="hint">{t("customAgentResponsePathHint")}</span>
      </label>
      <label>{t("customAgentProfileEnv")}
        <Input value={profileEnvVar} onChange={event => setProfileEnvVar(event.target.value)} placeholder="MY_AGENT_HOME" />
        <span className="hint">{t("customAgentProfileEnvHint")}</span>
      </label>
      <label>{t("customAgentTimeout")}
        <Input type="number" min={10} max={600} value={timeoutSeconds}
          onChange={event => setTimeoutSeconds(Math.min(600, Math.max(10, Number(event.target.value) || 180)))} />
      </label>
      {outputMode === "file-json" && <p className="hint">{t("customAgentOutputFileHint")}</p>}
    </details>
    <div className="actions">
      <Button variant="outline" size="sm" disabled={busy || !label.trim() || !executable.trim()}
        onClick={() => void act("customAgentTest")}>{t("customAgentCheck")}</Button>
      <Button size="sm" disabled={busy || !label.trim() || !executable.trim()}
        onClick={() => void act("customAgentSave")}>{t("customAgentSave")}</Button>
      {editingId && agents.some(item => item.id === editingId) && <Button variant="outline" size="sm"
        disabled={busy} onClick={() => void act("customAgentRemove")}>{t("customAgentRemove")}</Button>}
    </div>
    {status && <p className="hint" role="status">{status}</p>}
    <p className="customAgentSecurity">{t("customAgentSecurity")}</p>
  </details>;
}
