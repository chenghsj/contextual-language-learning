import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  parseSubtitles, type AgentInfo, type GenerationRequest, type JobSummary,
  type Destination, type DriveAccount, type DuplicateMatch,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { DocumentChunkAssembler } from "./native/document-chunks";
import { BookOpen, Settings2, WandSparkles } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale, isLocalePreference, isThemePreference, resolveTheme,
  type LocalePreference, type ThemePreference,
} from "./i18n/preferences";

const HOST_NAME = "dev.immersive.language_learning";
type Page = "create" | "reader" | "settings";
type Installed = Record<string, boolean>;
type RepeatOption = "2" | "3" | "5" | "infinite";

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "adaptive", maxNewVocabulary: 8, exerciseCount: 3,
};
const DEFAULT_AGENT: AgentSettings = { provider: "claude", modelId: "" };

function downloadDocument(doc: LearningDocument, format: "json" | "md"): void {
  const md = [
    "# " + doc.source.title, "",
    "Level: " + doc.profile.level + " · Teaching language: " + doc.profile.instructionLanguage, "",
    ...doc.sections.flatMap(section => [
      "## " + section.title, "", section.context, "",
      ...section.cueIds.map(id => {
        const cue = doc.cues.find(item => item.id === id);
        return cue ? "> " + formatTime(cue.startMs) + " " + cue.originalText : "";
      }),
      "", "### Vocabulary",
      ...section.vocabulary.map(word => "- " + word.expression + " — " + word.meaning + ": " + word.explanation),
      "", "### Insights", ...section.insights.map(text => "- " + text),
      "", "### Practice", ...section.exercises.map(ex => "- " + ex.question + "\n  - " + ex.answer), "",
    ]),
  ].join("\n");
  const content = format === "json" ? JSON.stringify(doc, null, 2) : md;
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url, saveAs: true, filename: "immersive-" + doc.id.slice(0, 8) + "." + format,
  }, () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

export default function App() {
  const [page, setPage] = useState<Page>("create");
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [browserLocale] = useState(getBrowserLocale);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("auto");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const uiLocale = localePreference === "auto" ? browserLocale : localePreference;
  const t = (key: MessageKey, params?: MessageParams) => translate(uiLocale, key, params);
  const [profile, setProfile] = useState<LearningProfile>(() => ({
    ...DEFAULT_PROFILE, instructionLanguage: browserLocale,
  }));
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>>({});
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([
    { id: "claude", label: "Claude Code", installed: false, supportsAccountProfiles: true },
    { id: "codex", label: "Codex", installed: false, supportsAccountProfiles: true },
    { id: "agy", label: "AGY", installed: false, supportsAccountProfiles: false },
  ]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [destination, setDestination] = useState<Destination>({ kind: "local" });
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [publishedLocation, setPublishedLocation] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{
    payload: GenerationRequest; token: string; matches: DuplicateMatch[];
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [repeat, setRepeat] = useState<RepeatOption>("3");
  const [delay, setDelay] = useState(1);
  const [loopActive, setLoopActive] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState("");
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const preflightPortRef = useRef<chrome.runtime.Port | null>(null);
  const requestRef = useRef<string | null>(null);

  const cues = useMemo(() => raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw), [raw]);
  const platform = getVideoAdapter(sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);
  const jobStatusKeys: Record<JobSummary["status"], MessageKey> = {
    queued: "jobQueued", running: "jobRunning", waiting: "jobWaiting",
    completed: "jobCompleted", failed: "jobFailed", cancelled: "jobCancelled",
  };

  useEffect(() => {
    void chrome.storage.local.get(["profile", "agent", "agentProfiles", "destination", "repeat", "delay", "uiLocalePreference", "themePreference"]).then(saved => {
      if (saved.profile) setProfile(saved.profile as LearningProfile);
      if (isLocalePreference(saved.uiLocalePreference)) setLocalePreference(saved.uiLocalePreference);
      if (isThemePreference(saved.themePreference)) setThemePreference(saved.themePreference);
      if (saved.agent) setAgent(saved.agent as AgentSettings);
      if (saved.agentProfiles && typeof saved.agentProfiles === "object") {
        setAgentProfiles(saved.agentProfiles as Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>);
      } else if (saved.agent) {
        const previous = saved.agent as AgentSettings;
        setAgentProfiles({ [previous.provider]: { modelId: previous.modelId, accountConfigDir: previous.accountConfigDir } });
      }
      if (saved.destination) setDestination(saved.destination as Destination);
      if (saved.repeat) setRepeat(saved.repeat as RepeatOption);
      if (typeof saved.delay === "number") setDelay(saved.delay);
      setHydrated(true);
    }).catch(() => setHydrated(true));
    void refreshDriveAccounts();
    void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (tab?.url && getVideoAdapter(tab.url).id !== "import") {
        setSourceUrl(tab.url);
        setTitle((tab.title ?? "Video").slice(0, 200));
      }
    });
    return () => { portRef.current?.disconnect(); preflightPortRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
    document.documentElement.dataset.theme = resolveTheme(themePreference, systemDark);
  }, [uiLocale, themePreference, systemDark]);

  useEffect(() => {
    if (hydrated) void chrome.storage.local.set({ profile, agent, agentProfiles, destination, repeat, delay, uiLocalePreference: localePreference, themePreference });
  }, [hydrated, profile, agent, agentProfiles, destination, repeat, delay, localePreference, themePreference]);

  function nativeOnce(request: { id: string; type: string; [key: string]: unknown }): Promise<HostMessage> {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative(HOST_NAME);
      let finished = false;
      port.onMessage.addListener((response: HostMessage) => {
        if (response.id !== request.id) return;
        finished = true;
        port.disconnect();
        if (response.type === "error") reject(new Error(response.message));
        else resolve(response);
      });
      port.onDisconnect.addListener(() => {
        if (!finished) reject(new Error(chrome.runtime.lastError?.message ?? t("errorHostDisconnected")));
      });
      try { port.postMessage(request); }
      catch (error) { port.disconnect(); reject(error); }
    });
  }

  async function refreshDriveAccounts(): Promise<void> {
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveAccounts" });
      if (response.type !== "driveAccounts") throw new Error("Unexpected Drive accounts response");
      setDriveAccounts(response.accounts);
      setDriveConfigured(response.configured);
      setDestination(current =>
        current.kind === "drive" && !current.accountId && response.accounts[0]
          ? { kind: "drive", accountId: response.accounts[0].id } : current);
    } catch (cause) {
      // Local-only use does not require a connected Host or a Google account.
      setDriveAccounts([]);
      setDriveConfigured(false);
    }
  }

  async function chooseFolder(): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "chooseFolder" });
      if (response.type !== "folder") throw new Error("Unexpected folder picker response");
      setDestination({ kind: "local", directory: response.directory });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("folderError"));
    } finally { setStorageBusy(false); }
  }

  async function configureDrive(): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(), type: "driveConfigure",
        clientId: oauthClientId.trim(), ...(oauthClientSecret ? { clientSecret: oauthClientSecret } : {}),
      });
      if (response.type !== "driveConfigured") throw new Error("Unexpected OAuth configuration response");
      setOauthClientSecret("");
      setDriveConfigured(true);
      await refreshDriveAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("oauthError"));
    } finally { setStorageBusy(false); }
  }

  async function connectDrive(): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveConnect" });
      if (response.type !== "driveConnected") throw new Error("Unexpected Google account response");
      setDriveAccounts(current => [...current.filter(item => item.id !== response.account.id), response.account]);
      setDestination({ kind: "drive", accountId: response.account.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("connectDriveError"));
    } finally { setStorageBusy(false); }
  }

  async function retryPublication(jobId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "publishJob", jobId });
      if (response.type === "publicationFailed") throw new Error(response.message);
      if (response.type !== "published") throw new Error("Unexpected publication response");
      setPublishedLocation(response.location);
      setProgress(t("publishedTo", { location: response.location }));
      loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("publicationError"));
    } finally { setStorageBusy(false); }
  }

  function cancelDuplicate(): void {
    preflightPortRef.current?.disconnect();
    preflightPortRef.current = null;
    setDuplicateWarning(null);
  }

  function updateAgent(next: AgentSettings): void {
    setAgent(next);
    setAgentProfiles(previous => ({
      ...previous,
      [next.provider]: { modelId: next.modelId, accountConfigDir: next.accountConfigDir },
    }));
  }

  function selectAgent(provider: string): void {
    const previous = agentProfiles[provider];
    updateAgent({
      provider,
      modelId: previous?.modelId ?? "",
      accountConfigDir: previous?.accountConfigDir,
    });
  }

  function checkHost(): void {
    setError("");
    const id = crypto.randomUUID();
    let replied = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id === id && message.type === "health") {
        replied = true;
        setInstalled(message.installed);
        if (Array.isArray(message.agents)) setAgentCatalog(message.agents);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) setError(chrome.runtime.lastError?.message ?? "Native Host connection failed.");
    });
    port.postMessage({ id, type: "health" });
  }

  function showDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setDocument(parsed.data);
    setPage("reader");
    setProgress(t("statusSaved"));
  }

  function updateJob(summary: JobSummary): void {
    setJobs(previous => [summary, ...previous.filter(job => job.id !== summary.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  function runGeneration(
    input: { type: "generate"; payload: GenerationRequest; checkToken: string; confirmRegeneration: boolean }
      | { type: "resume"; jobId: string },
    existingPort?: chrome.runtime.Port,
  ): void {
    if (generating) return;
    setError("");
    setDuplicateWarning(null);
    const id = input.type === "generate" ? input.payload.id : crypto.randomUUID();
    const jobId = input.type === "generate" ? input.payload.id : input.jobId;
    const port = existingPort ?? chrome.runtime.connectNative(HOST_NAME);
    preflightPortRef.current = null;
    portRef.current = port;
    requestRef.current = jobId;
    setGenerating(true);
    setProgress(t(input.type === "resume" ? "statusResuming" : "statusConnecting"));
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try { showDocument(raw); }
      catch (error) { setError(error instanceof Error ? error.message : t("errorDocumentOpen")); }
      finished = true;
      setGenerating(false);
      port.disconnect();
    }
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "job") {
        updateJob(message.job);
      } else if (message.type === "progress") {
        setProgress(t("statusProgress", { completed: message.completed, total: message.total }));
      } else if (message.type === "published") {
        setPublishedLocation(message.location);
      } else if (message.type === "publicationFailed") {
        setError(t("publishFailed", { message: message.message }));
      } else if (message.type === "result") {
        complete(message.document);
      } else if (message.type === "documentChunk") {
        try {
          const document = chunks.push(message);
          if (document) complete(document);
        } catch (error) {
          setError(error instanceof Error ? error.message : t("errorDocumentChunks"));
          finished = true;
          setGenerating(false);
          port.disconnect();
        }
      } else if (message.type === "error") {
        finished = true;
        setError(message.message);
        setGenerating(false);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (portRef.current === port) portRef.current = null;
      if (!finished) {
        setGenerating(false);
        setError(chrome.runtime.lastError?.message ?? t("errorDisconnected"));
      }
    });
    port.postMessage({ id, ...input });
  }

  function startGeneration(): void {
    if (checking || generating) return;
    setError("");
    cancelDuplicate();
    setPublishedLocation("");
    try {
      const payload = GenerationRequestSchema.parse({
        id: crypto.randomUUID(),
        source: { platform, title: title.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
        profile, agent, destination, cues,
      });
      const port = chrome.runtime.connectNative(HOST_NAME);
      preflightPortRef.current = port;
      setChecking(true);
      setProgress(t("checkingExisting"));
      const id = crypto.randomUUID();
      let responded = false;
      port.onMessage.addListener((message: HostMessage) => {
        if (message.id !== id) return;
        responded = true;
        setChecking(false);
        if (message.type === "duplicates") {
          if (message.matches.length) {
            setDuplicateWarning({ payload, token: message.token, matches: message.matches });
            setProgress(t("foundExisting", { count: message.matches.length }));
          } else {
            setProgress(t("noExisting"));
            runGeneration({ type: "generate", payload, checkToken: message.token, confirmRegeneration: false }, port);
          }
        } else if (message.type === "error") {
          setError(message.message);
          preflightPortRef.current = null;
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (!responded) {
          preflightPortRef.current = null;
          setChecking(false);
          setError(chrome.runtime.lastError?.message ?? t("preflightInterrupted"));
        }
      });
      port.postMessage({ type: "checkDuplicates", id, payload });
    } catch (cause) {
      setChecking(false);
      setError(cause instanceof Error ? cause.message : t("errorGenerationSettings"));
    }
  }

  function confirmRegeneration(): void {
    if (!duplicateWarning || !preflightPortRef.current) return;
    const { payload, token } = duplicateWarning;
    runGeneration({ type: "generate", payload, checkToken: token, confirmRegeneration: true },
      preflightPortRef.current);
  }

  function loadJobs(): void {
    if (loadingJobs) return;
    setError("");
    setLoadingJobs(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    let received = false;
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "jobs") {
        received = true;
        setJobs(message.jobs);
        setLoadingJobs(false);
        port.disconnect();
      } else if (message.type === "error") {
        received = true;
        setError(message.message);
        setLoadingJobs(false);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!received) {
        setLoadingJobs(false);
        setError(chrome.runtime.lastError?.message ?? t("errorJobs"));
      }
    });
    port.postMessage({ type: "listJobs", id });
  }

  function openSavedDocument(documentId: string): void {
    if (generating) return;
    setError("");
    setGenerating(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try { showDocument(raw); }
      catch (error) { setError(error instanceof Error ? error.message : t("errorDocumentOpen")); }
      finished = true;
      setGenerating(false);
      port.disconnect();
    }
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "result") complete(message.document);
      else if (message.type === "documentChunk") {
        try {
          const doc = chunks.push(message);
          if (doc) complete(doc);
        } catch (error) {
          finished = true;
          setGenerating(false);
          setError(error instanceof Error ? error.message : t("errorDocumentCorrupt"));
          port.disconnect();
        }
      } else if (message.type === "error") {
        finished = true;
        setGenerating(false);
        setError(message.message);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!finished) {
        setGenerating(false);
        setError(chrome.runtime.lastError?.message ?? t("errorHostDisconnected"));
      }
    });
    port.postMessage({ type: "getDocument", id, documentId });
  }

  useEffect(() => {
    // A pending check is valid only for the exact inputs originally submitted.
    // Changing the source, profile, Agent or destination cancels that check and its confirmation ticket.
    if (preflightPortRef.current) {
      preflightPortRef.current.disconnect();
      preflightPortRef.current = null;
      setDuplicateWarning(null);
      setChecking(false);
    }
  }, [raw, title, sourceUrl, profile, agent, destination]);

  function cancelGeneration(): void {
    if (!portRef.current || !requestRef.current) return;
    portRef.current.postMessage({ id: crypto.randomUUID(), type: "cancel", jobId: requestRef.current });
    setProgress(t("statusCancelling"));
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 2_000_000) { setError(t("errorFileSize")); return; }
    setRaw(await file.text());
    setFileName(file.name);
    if (!title) setTitle(file.name.replace(/\.(srt|vtt|txt)$/i, ""));
    setError("");
  }

  async function diagnoseVideo(): Promise<void> {
    setError("");
    try {
      if (!readerAdapter.diagnose || !document?.source.url) throw new Error(t("errorPlayerDiagnoseUnsupported"));
      const status = await readerAdapter.diagnose(document.source.url);
      setPlaybackStatus(t("statusPlayerReady") + (status.currentMs !== undefined ? t("statusCurrentTime", { time: formatTime(status.currentMs) }) : ""));
    } catch (cause) {
      setPlaybackStatus("");
      setError(cause instanceof Error ? cause.message : t("errorPlayerDiagnose"));
    }
  }

  async function seekCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null) return;
    setError("");
    try {
      if (!readerAdapter.seek || !document?.source.url) throw new Error(t("errorSeekUnsupported"));
      await readerAdapter.seek(document.source.url, cue.startMs);
      setLoopActive(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errorSeek"));
    }
  }

  async function loopCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null || cue.endMs === null) return;
    setError("");
    try {
      if (!readerAdapter.loop || !document?.source.url) throw new Error(t("errorLoopUnsupported"));
      await readerAdapter.loop(document.source.url, {
        startMs: cue.startMs, endMs: cue.endMs,
        repeats: repeat === "infinite" ? "infinite" : Number(repeat),
        delaySeconds: delay,
      });
      setLoopActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errorLoop"));
    }
  }

  async function stopLoop(): Promise<void> {
    try {
      if (readerAdapter.stopLoop && document?.source.url) {
        await readerAdapter.stopLoop(document.source.url);
      }
    } catch {
      // Closing or reloading a video tab already cancels its loop.
    }
    setLoopActive(false);
  }

  const levelOptions = profile.targetLanguage === "en"
    ? ["A1", "A2", "B1", "B2", "C1", "C2"]
    : profile.targetLanguage === "ja"
      ? ["N5", "N4", "N3", "N2", "N1"] : ["1", "2", "3", "4", "5", "6"];

  return (
    <div className="app">
      <header className="topbar">
        <div><span className="brandMark">IL</span><strong>Immersive Learning</strong></div>
        <span className="version">MVP · v0.1</span>
      </header>
      <nav className="tabs" aria-label={t("navLabel")}>
        <Button className={page === "create" ? "selected" : ""} onClick={() => setPage("create")}><WandSparkles aria-hidden="true" />{t("create")}</Button>
        <Button className={page === "reader" ? "selected" : ""} onClick={() => setPage("reader")}><BookOpen aria-hidden="true" />{t("reader")}</Button>
        <Button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}><Settings2 aria-hidden="true" />{t("settings")}</Button>
      </nav>

      {error && <div className="alert" role="alert">{error}<Button variant="ghost" size="icon" aria-label={t("closeError")} onClick={() => setError("")}>×</Button></div>}

      {page === "create" && <main>
        <Card className="panel">
          <h2>{t("subtitleHeading")}</h2>
          <p className="hint">{t("subtitleHint")}</p>
          <label>{t("subtitleFile")} <Input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={event => void onFile(event.target.files?.[0])} /></label>
          {fileName && <p className="hint">{t("importedFile", { name: fileName })}</p>}
          <label>{t("pasteSubtitles")} <Textarea rows={5} value={raw} onChange={event => setRaw(event.target.value)} placeholder={t("subtitlePlaceholder")} /></label>
          <p className="hint">{t("parsedCues", { count: cues.length })}</p>
          <label>{t("videoTitle")} <Input value={title} onChange={event => setTitle(event.target.value)} placeholder={t("titlePlaceholder")} /></label>
          <label>{t("videoUrl")} <Input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
          <Badge className="chip">{t("source", { name: getVideoAdapter(sourceUrl).id === "import" ? t("providerImport") : getVideoAdapter(sourceUrl).label })}</Badge>
        </Card>

        <Card className="panel">
          <h2>{t("learningHeading")}</h2>
          <div className="twoColumns">
            <label>{t("targetLanguage")}
              <Select value={profile.targetLanguage} onChange={event => {
                const targetLanguage = event.target.value as LearningProfile["targetLanguage"];
                setProfile(current => ({ ...current, targetLanguage, level: targetLanguage === "en" ? "B1" : targetLanguage === "ja" ? "N4" : "2" }));
              }}><option value="en">{t("english")}</option><option value="ja">{t("japanese")}</option><option value="ko">{t("korean")}</option></Select>
            </label>
            <label>{t("level")}
              <Select value={profile.level} onChange={event => setProfile(current => ({ ...current, level: event.target.value }))}>
                {levelOptions.map(level => <option key={level} value={level}>{level}</option>)}
              </Select>
            </label>
          </div>
          <label>{t("instructionLanguage")}
            <Select value={profile.instructionLanguage} onChange={event => setProfile(current => ({ ...current, instructionLanguage: event.target.value as LearningProfile["instructionLanguage"] }))}>
              <option value="zh-TW">{t("traditionalChinese")}</option><option value="zh-CN">{t("simplifiedChinese")}</option><option value="en">{t("english")}</option><option value="ja">{t("japanese")}</option><option value="ko">{t("korean")}</option>
            </Select>
          </label>
          <label>{t("teachingMode")}
            <Select value={profile.mode} onChange={event => setProfile(current => ({ ...current, mode: event.target.value as LearningProfile["mode"] }))}>
              <option value="adaptive">{t("adaptive")}</option><option value="guided">{t("guided")}</option><option value="immersive">{t("immersive")}</option>
            </Select>
          </label>
          <div className="twoColumns">
            <label>{t("vocabLimit")}
              <Input type="number" min={1} max={30} value={profile.maxNewVocabulary} onChange={event => setProfile(current => ({ ...current, maxNewVocabulary: Number(event.target.value) }))} />
            </label>
            <label>{t("exerciseCount")}
              <Input type="number" min={0} max={12} value={profile.exerciseCount} onChange={event => setProfile(current => ({ ...current, exerciseCount: Number(event.target.value) }))} />
            </label>
          </div>
        </Card>

        <Card className="panel">
          <h2>{t("generationHeading")}</h2>
          <p className="hint">{t("currentAgent", { provider: agent.provider, model: agent.modelId || t("cliDefault") })}</p>
          <label>{t("storageLocation")}
            <Select value={destination.kind} onChange={event => {
              if (event.target.value === "drive") {
                setDestination({ kind: "drive", accountId: driveAccounts[0]?.id ?? "" });
              } else {
                setDestination({ kind: "local" });
              }
              cancelDuplicate();
            }}>
              <option value="local">{t("localFolder")}</option>
              <option value="drive">{t("driveAccountOption")}</option>
            </Select>
          </label>
          {destination.kind === "local" ? <>
            <p className="hint">{t("currentFolder", { path: destination.directory ?? t("defaultFolder") })}</p>
            <div className="actions">
              <Button variant="outline" className="secondary" disabled={storageBusy || generating}
                onClick={() => void chooseFolder()}>{t("chooseFolder")}</Button>
              {destination.directory && <Button variant="ghost" size="sm"
                onClick={() => setDestination({ kind: "local" })}>{t("useDefaultFolder")}</Button>}
            </div>
            <p className="hint">{t("driveDesktopPicker")}</p>
          </> : <>
            <label>{t("googleAccount")}
              <Select value={destination.accountId} onChange={event =>
                setDestination({ kind: "drive", accountId: event.target.value })}>
                <option value="">{t("chooseConnected")}</option>
                {driveAccounts.map(account => <option key={account.id} value={account.id}>{account.email}</option>)}
              </Select>
            </label>
            <div className="actions">
              <Button variant="outline" className="secondary" disabled={storageBusy || generating}
                onClick={() => void connectDrive()}>{t("connectAnother")}</Button>
              <Button variant="ghost" size="sm" disabled={storageBusy}
                onClick={() => void refreshDriveAccounts()}>{t("refreshAccounts")}</Button>
            </div>
            <p className="hint">{t("driveUploadHint")}</p>
            {!driveConfigured && <p className="callout">{t("oauthFirst")}</p>}
          </>}
          {duplicateWarning && <div className="callout" role="alertdialog" aria-label={t("duplicateConfirmLabel")}>
            <strong>{t("duplicateFound", { count: duplicateWarning.matches.length })}</strong>
            <p className="hint">{t("duplicateNewVersion")}</p>
            {duplicateWarning.matches.map(match => <div className="learningCard" key={match.documentId}>
              <strong>{match.title}</strong>
              <p>{new Date(match.createdAt).toLocaleString(uiLocale)} · {match.destination} · {t(match.exactSettings ? "sameSettings" : "differentSettings")}{match.jobStatus ? " · " + match.jobStatus : ""}</p>
              <div className="actions">
                {match.local && <Button variant="outline" size="sm" onClick={() => {
                  cancelDuplicate();
                  openSavedDocument(match.documentId);
                }}>{t("openExisting")}</Button>}
                {match.url && <Button variant="outline" size="sm" onClick={() => void chrome.tabs.create({ url: match.url })}>{t("openInDrive")}</Button>}
              </div>
            </div>)}
            <div className="actions">
              <Button variant="destructive" size="sm" onClick={confirmRegeneration}>{t("confirmNewVersion")}</Button>
              <Button variant="outline" size="sm" onClick={cancelDuplicate}>{t("cancelNoGeneration")}</Button>
            </div>
          </div>}
          <Button className="primary" onClick={startGeneration} disabled={generating || checking || !cues.length || !title.trim() || (destination.kind === "drive" && !destination.accountId)}>
            {generating ? t("generating") : checking ? t("checkingExistingShort") : t("checkThenGenerate")}
          </Button>
          {generating && <Button variant="outline" className="secondary" onClick={cancelGeneration}>{t("cancelGeneration")}</Button>}
          {progress && <p className="status" role="status">{progress}</p>}
          {publishedLocation && <p className="hint">{t("publishedTo", { location: publishedLocation })}</p>}
        </Card>
        <Card className="panel">
          <h2>{t("jobHistory")}</h2>
          <p className="hint">{t("jobHistoryHint")}</p>
          <Button variant="outline" className="secondary" disabled={loadingJobs}
            onClick={loadJobs}>{loadingJobs ? t("loading") : t("refreshJobs")}</Button>
          {jobs.map(job => <div className="learningCard" key={job.id}>
            <strong>{job.sourceTitle}</strong>
            <p>{t("jobProgress", { provider: job.provider, status: t(jobStatusKeys[job.status]), completed: job.completed, total: job.total })}</p>
            {job.error && <p>{job.error}</p>}
            <div className="actions">
              {["queued", "waiting", "failed"].includes(job.status) &&
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => runGeneration({ type: "resume", jobId: job.id })}>{t("resume")}</Button>}
              {job.documentId && <>
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => openSavedDocument(job.documentId!)}>{t("openLesson")}</Button>
                {job.publication?.status !== "published" &&
                  <Button variant="outline" size="sm" disabled={storageBusy}
                    onClick={() => void retryPublication(job.id)}>{t("retryPublish")}</Button>}
              </>}
            </div>
          </div>)}
        </Card>
      </main>}

      {page === "settings" && <main>
        <Card className="panel">
          <h2>{t("uiLanguage")} · {t("appearance")}</h2>
          <label>{t("uiLanguage")}
            <Select value={localePreference} onChange={event => {
              const next = event.target.value;
              if (isLocalePreference(next)) setLocalePreference(next);
            }}>
              <option value="auto">{t("browserLanguage")} · {browserLocale}</option>
              <option value="en">{t("english")}</option>
              <option value="zh-TW">{t("traditionalChinese")}</option>
              <option value="zh-CN">{t("simplifiedChinese")}</option>
              <option value="ja">{t("japanese")}</option>
              <option value="ko">{t("korean")}</option>
            </Select>
          </label>
          <p className="hint">{t("uiLanguageHint")}</p>
          <label>{t("appearance")}
            <Select value={themePreference} onChange={event => {
              const next = event.target.value;
              if (isThemePreference(next)) setThemePreference(next);
            }}>
              <option value="system">{t("themeSystem")}</option>
              <option value="light">{t("themeLight")}</option>
              <option value="dark">{t("themeDark")}</option>
            </Select>
          </label>
          <p className="hint">{t("appearanceHint")}</p>
        </Card>
        <Card className="panel">
          <h2>{t("agentHeading")}</h2>
          <p className="hint">{t("agentHint")}</p>
          <Button variant="outline" className="secondary" onClick={checkHost}>{t("checkHost")}</Button>
          {installed && <div className="status">
            {agentCatalog.map(entry => entry.label + ": " + t(entry.installed ? "agentInstalled" : "agentMissing")).join(" · ")}
          </div>}
          <label>{t("defaultAgent")}
            <Select value={agent.provider} onChange={event => selectAgent(event.target.value)}>
              {agentCatalog.map(entry =>
                <option key={entry.id} value={entry.id}>{entry.label}{installed && !entry.installed ? t("agentNotInstalled") : ""}</option>
              )}
            </Select>
          </label>
          <label>{t("defaultModel")}
            <Input value={agent.modelId} onChange={event => updateAgent({ ...agent, modelId: event.target.value })} placeholder={t("modelPlaceholder")} />
          </label>
          <label>{t("accountFolder")}
            <Input disabled={!agentCatalog.find(entry => entry.id === agent.provider)?.supportsAccountProfiles} value={agent.accountConfigDir ?? ""} onChange={event => updateAgent({ ...agent, accountConfigDir: event.target.value || undefined })} placeholder={t("accountFolderPlaceholder")} />
          </label>
          <p className="hint">{t("accountFolderHint")}</p>
          <div className="callout">{t("futureFeaturesDrive")}</div>
        </Card>
        <Card className="panel">
          <h2>{t("driveAccountHeading")}</h2>
          <p className="hint">{t("driveOauthHelp")}</p>
          <p className="hint">{t("oauthStatus", { status: t(driveConfigured ? "oauthConfigured" : "oauthNotConfigured") })}</p>
          <label>Google Desktop OAuth Client ID
            <Input value={oauthClientId} onChange={event => setOauthClientId(event.target.value)}
              placeholder="123456789-xxx.apps.googleusercontent.com" />
          </label>
          <label>{t("desktopSecret")}
            <Input type="password" value={oauthClientSecret}
              onChange={event => setOauthClientSecret(event.target.value)}
              placeholder={t("secretPlaceholder")} />
          </label>
          <Button variant="outline" className="secondary" disabled={storageBusy || !oauthClientId.trim()}
            onClick={() => void configureDrive()}>{t("saveOauth")}</Button>
          <div className="actions">
            <Button variant="outline" className="secondary" disabled={storageBusy || !driveConfigured}
              onClick={() => void connectDrive()}>{t("connectGoogle")}</Button>
          </div>
          {driveAccounts.map(account => <p className="hint" key={account.id}>{t("connectedAccount", { email: account.email })}</p>)}
        </Card>
      </main>}

      {page === "reader" && <main>
        {!document ? <Card className="panel empty">
          <h2>{t("emptyHeading")}</h2><p className="hint">{t("emptyHint")}</p>
          <Button variant="outline" className="secondary" onClick={() => setPage("create")}>{t("create")}</Button>
        </Card> : <>
          <Card className="panel">
            <Badge className="chip">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</Badge>
            <h1>{document.source.title}</h1>
            <p className="hint">{t("lessonOverview", { count: document.sections.length, language: document.profile.instructionLanguage })}</p>
            {publishedLocation && <p className="hint">{t("publishedTo", { location: publishedLocation })}</p>
            <div className="actions">
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "json")}>{t("saveJson")}</Button>
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "md")}>{t("saveMarkdown")}</Button>
            </div>
          </Card>
          <Card className="panel">
            <h2>{t("videoCompanion")}</h2>
            <div className="twoColumns">
              <label>{t("repeatCount")}
                <Select value={repeat} onChange={event => setRepeat(event.target.value as RepeatOption)}>
                  <option value="2">{t("repeatTwice")}</option><option value="3">{t("repeatThrice")}</option><option value="5">{t("repeatFive")}</option><option value="infinite">{t("repeatForever")}</option>
                </Select>
              </label>
              <label>{t("repeatDelay")}
                <Select value={delay} onChange={event => setDelay(Number(event.target.value))}>
                  {[0, 1, 2, 3].map(seconds => <option key={seconds} value={seconds}>{t("seconds", { count: seconds })}</option>)}
                </Select>
              </label>
            </div>
            {readerAdapter.diagnose
              ? <div className="callout">
                  {t("experimentalVideoHint", { name: readerAdapter.label })}
                  <div className="actions"><Button variant="outline" className="secondary" onClick={() => void diagnoseVideo()}>{t("checkPlayer", { name: readerAdapter.label })}</Button></div>
                  {playbackStatus && <p className="hint" role="status">{playbackStatus}</p>}
                </div>
              : readerAdapter.loop
                ? <p className="hint">{t("youtubeVideoHint", { name: readerAdapter.label })}</p>
                : <p className="hint">{t("noVideoControl")}</p>}
            {loopActive && <Button variant="outline" className="secondary" onClick={() => void stopLoop()}>{t("stopLoop")}</Button>}
          </Card>
          {document.sections.map(section => <Card className="panel lesson" key={section.id}>
            <Badge className="chip">{formatTime(section.startMs)}–{formatTime(section.endMs)}</Badge>
            <h2>{section.title}</h2>
            <p>{section.context}</p>
            <h3>{t("originalSubtitles")}</h3>
            {section.cueIds.map(id => {
              const cue = document.cues.find(item => item.id === id);
              if (!cue) return null;
              const link = cue.startMs !== null && document.source.url
                ? readerAdapter.timestampLink?.(document.source.url, cue.startMs) ?? null : null;
              const canSeek = cue.startMs !== null && !!readerAdapter.seek;
              const canLoop = cue.startMs !== null && cue.endMs !== null && !!readerAdapter.loop;
              return <div className="cue" key={id}>
                <span className="time">{formatTime(cue.startMs)}</span>
                <p>{cue.originalText}</p>
                <div className="actions">
                  {link && <Button variant="link" className="textButton" onClick={() => void chrome.tabs.create({ url: link })}>{t("openTimestamp")}</Button>}
                  {canSeek && <Button variant="link" className="textButton" onClick={() => void seekCue(cue)}>{t("seekTo")}</Button>}
                  {canLoop && <Button variant="link" className="textButton" onClick={() => void loopCue(cue)}>{t("loopSentence")}</Button>}
                  {!link && cue.startMs !== null && <Button variant="link" className="textButton" onClick={() => void navigator.clipboard.writeText(formatTime(cue.startMs))}>{t("copyTime")}</Button>}
                </div>
              </div>;
            })}
            {section.vocabulary.length > 0 && <><h3>{t("vocabulary")}</h3>
              {section.vocabulary.map((word, index) => <div className="learningCard" key={word.expression + index}>
                <strong>{word.expression}</strong><span>{word.meaning}</span>
                <p>{word.explanation}</p>{word.example && <p className="example">{word.example}</p>}
              </div>)}</>}
            {section.insights.length > 0 && <><h3>{t("insights")}</h3><ul>{section.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></>}
            {section.exercises.length > 0 && <><h3>{t("exercises")}</h3>
              {section.exercises.map((exercise, index) => <details key={index}><summary>{exercise.question}</summary><p>{exercise.answer}</p></details>)}</>}
          </Card>)}
        </>}
      </main>}
    </div>
  );
}
