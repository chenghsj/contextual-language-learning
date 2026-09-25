import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  parseSubtitles, type AgentInfo, type GenerationRequest, type JobSummary,
  type Destination, type DriveAccount, type DuplicateMatch,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { openOrFocusVideoTab } from "./video/tab";
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [rateApplying, setRateApplying] = useState(false);
  const [loopActive, setLoopActive] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState("");
  const [openingVideo, setOpeningVideo] = useState(false);
  const openingVideoRef = useRef(false);
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
    void chrome.storage.local.get(["profile", "agent", "agentProfiles", "destination", "repeat", "delay", "playbackRate", "uiLocalePreference", "themePreference"]).then(saved => {
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
      if (typeof saved.playbackRate === "number" && [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].includes(saved.playbackRate)) {
        setPlaybackRate(saved.playbackRate);
      }
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
    window.document.documentElement.lang = uiLocale;
    window.document.documentElement.dataset.theme = resolveTheme(themePreference, systemDark);
  }, [uiLocale, themePreference, systemDark]);

  useEffect(() => {
    if (hydrated) void chrome.storage.local.set({ profile, agent, agentProfiles, destination, repeat, delay, playbackRate, uiLocalePreference: localePreference, themePreference });
  }, [hydrated, profile, agent, agentProfiles, destination, repeat, delay, playbackRate, localePreference, themePreference]);

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

  async function openVideo(): Promise<void> {
    if (openingVideoRef.current) return;
    if (!document?.source.url || readerAdapter.id === "import") {
      setError(t("errorVideoOpenUnsupported"));
      return;
    }
    openingVideoRef.current = true;
    setOpeningVideo(true);
    setError("");
    try {
      const { reused } = await openOrFocusVideoTab(readerAdapter, document.source.url);
      setPlaybackStatus(t(reused ? "statusVideoReused" : "statusVideoOpened"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errorVideoOpen"));
    } finally {
      openingVideoRef.current = false;
      setOpeningVideo(false);
    }
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

  async function applyPlaybackRate(): Promise<void> {
    setError("");
    if (!readerAdapter.setPlaybackRate || !document?.source.url) {
      setError(t("errorRateUnsupported"));
      return;
    }
    setRateApplying(true);
    try {
      await readerAdapter.setPlaybackRate(document.source.url, playbackRate);
      setPlaybackStatus(t("rateApplied", { name: readerAdapter.label, rate: playbackRate }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errorRate"));
    } finally {
      setRateApplying(false);
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
      <nav className="tabs" aria-label="主要選單">
        <Button className={page === "create" ? "selected" : ""} onClick={() => setPage("create")}><WandSparkles aria-hidden="true" />建立教材</Button>
        <Button className={page === "reader" ? "selected" : ""} onClick={() => setPage("reader")}><BookOpen aria-hidden="true" />閱讀文件</Button>
        <Button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}><Settings2 aria-hidden="true" />Agent 設定</Button>
      </nav>

      {error && <div className="alert" role="alert">{error}<Button variant="ghost" size="icon" aria-label="關閉錯誤" onClick={() => setError("")}>×</Button></div>}

      {page === "create" && <main>
        <Card className="panel">
          <h2>1. 字幕與影片</h2>
          <p className="hint">匯入你有權使用的 SRT、VTT 或文字。Netflix 不會被自動擷取或修改。</p>
          <label>字幕檔案 <Input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={event => void onFile(event.target.files?.[0])} /></label>
          {fileName && <p className="hint">已匯入：{fileName}</p>}
          <label>或貼上字幕 <Textarea rows={5} value={raw} onChange={event => setRaw(event.target.value)} placeholder="WEBVTT、SRT 或純文字…" /></label>
          <p className="hint">已解析 {cues.length} 段字幕。</p>
          <label>影片／教材標題 <Input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：Making a decision" /></label>
          <label>原始影片網址（選填） <Input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
          <Badge className="chip">來源：{getVideoAdapter(sourceUrl).label}</Badge>
        </Card>

        <Card className="panel">
          <h2>2. 教材設定</h2>
          <div className="twoColumns">
            <label>學習語言
              <Select value={profile.targetLanguage} onChange={event => {
                const targetLanguage = event.target.value as LearningProfile["targetLanguage"];
                setProfile(current => ({ ...current, targetLanguage, level: targetLanguage === "en" ? "B1" : targetLanguage === "ja" ? "N4" : "2" }));
              }}><option value="en">英文</option><option value="ja">日文</option><option value="ko">韓文</option></Select>
            </label>
            <label>程度
              <Select value={profile.level} onChange={event => setProfile(current => ({ ...current, level: event.target.value }))}>
                {levelOptions.map(level => <option key={level} value={level}>{level}</option>)}
              </Select>
            </label>
          </div>
          <label>文件教學語言
            <Select value={profile.instructionLanguage} onChange={event => setProfile(current => ({ ...current, instructionLanguage: event.target.value as LearningProfile["instructionLanguage"] }))}>
              <option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option>
            </Select>
          </label>
          <label>解說模式
            <Select value={profile.mode} onChange={event => setProfile(current => ({ ...current, mode: event.target.value as LearningProfile["mode"] }))}>
              <option value="adaptive">依程度調整</option><option value="guided">較多教學語言輔助</option><option value="immersive">較多目標語言練習</option>
            </Select>
          </label>
          <div className="twoColumns">
            <label>每章新詞彙上限
              <Input type="number" min={1} max={30} value={profile.maxNewVocabulary} onChange={event => setProfile(current => ({ ...current, maxNewVocabulary: Number(event.target.value) }))} />
            </label>
            <label>每章練習題
              <Input type="number" min={0} max={12} value={profile.exerciseCount} onChange={event => setProfile(current => ({ ...current, exerciseCount: Number(event.target.value) }))} />
            </label>
          </div>
        </Card>

        <Card className="panel">
          <h2>3. Agent 與生成</h2>
          <p className="hint">目前使用：{agent.provider} · {agent.modelId || "CLI 預設模型"}。切換請至 Agent 設定。</p>
          <label>儲存位置
            <Select value={destination.kind} onChange={event => {
              if (event.target.value === "drive") {
                setDestination({ kind: "drive", accountId: driveAccounts[0]?.id ?? "" });
              } else {
                setDestination({ kind: "local" });
              }
              cancelDuplicate();
            }}>
              <option value="local">本地資料夾</option>
              <option value="drive">Google Drive（獨立帳號授權）</option>
            </Select>
          </label>
          {destination.kind === "local" ? <>
            <p className="hint">目前資料夾：{destination.directory ?? "~/Documents/Immersive Learning（預設）"}</p>
            <div className="actions">
              <Button variant="outline" className="secondary" disabled={storageBusy || generating}
                onClick={() => void chooseFolder()}>選擇本地資料夾…</Button>
              {destination.directory && <Button variant="ghost" size="sm"
                onClick={() => setDestination({ kind: "local" })}>使用預設資料夾</Button>}
            </div>
            <p className="hint">Google Drive for desktop 的同步資料夾也可以透過本地資料夾選擇器選取。</p>
          </> : <>
            <label>Google 帳號
              <Select value={destination.accountId} onChange={event =>
                setDestination({ kind: "drive", accountId: event.target.value })}>
                <option value="">請選擇已連線的帳號</option>
                {driveAccounts.map(account => <option key={account.id} value={account.id}>{account.email}</option>)}
              </Select>
            </label>
            <div className="actions">
              <Button variant="outline" className="secondary" disabled={storageBusy || generating}
                onClick={() => void connectDrive()}>連結其他 Google 帳號</Button>
              <Button variant="ghost" size="sm" disabled={storageBusy}
                onClick={() => void refreshDriveAccounts()}>重新整理帳號</Button>
            </div>
            <p className="hint">教材會上傳至該帳號中的 Immersive Learning 資料夾；Checkpoint 仍保留在本地。</p>
            {!driveConfigured && <p className="callout">尚未設定 Google OAuth Client。請先至 Agent 設定頁的 Google Drive 區完成設定。</p>}
          </>}
          {duplicateWarning && <div className="callout" role="alertdialog" aria-label="重新生成確認">
            <strong>此來源已有 {duplicateWarning.matches.length} 份教材或未完成任務。</strong>
            <p className="hint">重新生成會建立新版本，不會覆蓋原教材或學習進度。確認後才會呼叫 AI Agent。</p>
            {duplicateWarning.matches.map(match => <div className="learningCard" key={match.documentId}>
              <strong>{match.title}</strong>
              <p>{new Date(match.createdAt).toLocaleString()} · {match.destination} · {match.exactSettings ? "相同生成設定" : "不同生成設定"}{match.jobStatus ? " · " + match.jobStatus : ""}</p>
              <div className="actions">
                {match.local && <Button variant="outline" size="sm" onClick={() => {
                  cancelDuplicate();
                  openSavedDocument(match.documentId);
                }}>開啟既有教材</Button>}
                {match.url && <Button variant="outline" size="sm" onClick={() => void chrome.tabs.create({ url: match.url })}>在 Google Drive 開啟</Button>}
              </div>
            </div>)}
            <div className="actions">
              <Button variant="destructive" size="sm" onClick={confirmRegeneration}>確認重新生成新版本</Button>
              <Button variant="outline" size="sm" onClick={cancelDuplicate}>取消，不生成</Button>
            </div>
          </div>}
          <Button className="primary" onClick={startGeneration} disabled={generating || checking || !cues.length || !title.trim() || (destination.kind === "drive" && !destination.accountId)}>
            {generating ? "生成中…" : checking ? "檢查既有教材…" : "檢查後生成教材"}
          </Button>
          {generating && <Button variant="outline" className="secondary" onClick={cancelGeneration}>取消生成</Button>}
          {progress && <p className="status" role="status">{progress}</p>}
          {publishedLocation && <p className="hint">已發布至：{publishedLocation}</p>}
        </Card>
        <Card className="panel">
          <h2>任務紀錄與恢復</h2>
          <p className="hint">已完成的章節會儲存在本地；Host 中斷後，可從未完成處繼續。取消的任務不會自動恢復。</p>
          <Button variant="outline" className="secondary" disabled={loadingJobs}
            onClick={loadJobs}>{loadingJobs ? "讀取中…" : "重新整理任務"}</Button>
          {jobs.map(job => <div className="learningCard" key={job.id}>
            <strong>{job.sourceTitle}</strong>
            <p>{job.provider} · {job.status} · {job.completed} / {job.total} 章節</p>
            {job.error && <p>{job.error}</p>}
            <div className="actions">
              {["queued", "waiting", "failed"].includes(job.status) &&
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => runGeneration({ type: "resume", jobId: job.id })}>繼續生成</Button>}
              {job.documentId && <>
                <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => openSavedDocument(job.documentId!)}>開啟教材</Button>
                {job.publication?.status !== "published" &&
                  <Button variant="outline" size="sm" disabled={storageBusy}
                    onClick={() => void retryPublication(job.id)}>重新發布（不重新生成）</Button>}
              </>}
            </div>
          </div>)}
        </Card>
      </main>}

      {page === "settings" && <main>
        <Card className="panel">
          <h2>本地 CLI Agent</h2>
          <p className="hint">只使用你的本地 CLI 登入狀態；字幕會依所選 CLI 的服務條款傳送給相應模型供應商。</p>
          <Button variant="outline" className="secondary" onClick={checkHost}>檢查 Native Host / CLI</Button>
          {installed && <div className="status">
            {agentCatalog.map(entry => entry.label + "：" + (entry.installed ? "已安裝" : "未找到")).join(" · ")}
          </div>}
          <label>預設 Agent
            <Select value={agent.provider} onChange={event => selectAgent(event.target.value)}>
              {agentCatalog.map(entry =>
                <option key={entry.id} value={entry.id}>{entry.label}{installed && !entry.installed ? "（未安裝）" : ""}</option>
              )}
            </Select>
          </label>
          <label>預設模型 ID
            <Input value={agent.modelId} onChange={event => updateAgent({ ...agent, modelId: event.target.value })} placeholder="留空使用 CLI 預設模型" />
          </label>
          <label>獨立帳號設定目錄（選填）
            <Input disabled={!agentCatalog.find(entry => entry.id === agent.provider)?.supportsAccountProfiles} value={agent.accountConfigDir ?? ""} onChange={event => updateAgent({ ...agent, accountConfigDir: event.target.value || undefined })} placeholder="例如：/Users/you/.codex-work" />
          </label>
          <p className="hint">帳號設定目錄僅供宣告支援獨立 Profile 的 Agent 使用；目錄必須已存在於家目錄內。不支援獨立 Profile 的 Agent 使用目前的 CLI 登入環境。</p>
          <div className="callout">背景 Daemon 與 Google Drive 雙向同步尚未提供。Google Drive 的登入與上傳使用獨立 OAuth 授權。</div>
        </Card>
        <Card className="panel">
          <h2>Google Drive 帳號設定</h2>
          <p className="hint">首次使用請在 Google Cloud 建立 Desktop OAuth Client、啟用 Drive API，並在同意畫面設定 drive.file、openid 與 email 權限。OAuth 憑證僅儲存在本機 Host，不存入 Chrome Storage。</p>
          <p className="hint">狀態：{driveConfigured ? "已設定 OAuth Client" : "尚未設定 OAuth Client"}</p>
          <label>Google Desktop OAuth Client ID
            <Input value={oauthClientId} onChange={event => setOauthClientId(event.target.value)}
              placeholder="123456789-xxx.apps.googleusercontent.com" />
          </label>
          <label>Desktop Client Secret（若 Google 要求，選填）
            <Input type="password" value={oauthClientSecret}
              onChange={event => setOauthClientSecret(event.target.value)}
              placeholder="僅傳至本地 Host，不儲存在擴充功能設定" />
          </label>
          <Button variant="outline" className="secondary" disabled={storageBusy || !oauthClientId.trim()}
            onClick={() => void configureDrive()}>儲存 OAuth 設定到本機</Button>
          <div className="actions">
            <Button variant="outline" className="secondary" disabled={storageBusy || !driveConfigured}
              onClick={() => void connectDrive()}>連結 Google 帳號</Button>
          </div>
          {driveAccounts.map(account => <p className="hint" key={account.id}>已連線：{account.email}</p>)}
        </Card>
      </main>}

      {page === "reader" && <main>
        {!document ? <Card className="panel empty">
          <h2>尚無教材</h2><p className="hint">先匯入字幕並生成，文件會顯示在這裡。</p>
          <Button variant="outline" className="secondary" onClick={() => setPage("create")}>建立教材</Button>
        </Card> : <>
          <Card className="panel">
            <Badge className="chip">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</Badge>
            <h1>{document.source.title}</h1>
            <p className="hint">{document.sections.length} 個學習章節 · 教學語言 {document.profile.instructionLanguage}</p>
            {publishedLocation && <p className="hint">已發布至：{publishedLocation}</p>}
            <div className="actions">
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "json")}>JSON 另存新檔</Button>
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "md")}>Markdown 另存新檔</Button>
            </div>
          </Card>
          <Card className="panel">
            <h2>影片伴讀</h2>
            {document.source.url && readerAdapter.id !== "import" &&
              <div className="actions">
                <Button variant="outline" className="secondary" disabled={openingVideo}
                  onClick={() => void openVideo()}>
                  {openingVideo ? t("openingVideo") : t("openOrFocusVideo")}
                </Button>
              </div>
            <div className="twoColumns">
              <label>循環次數
                <Select value={repeat} onChange={event => setRepeat(event.target.value as RepeatOption)}>
                  <option value="2">2 次</option><option value="3">3 次</option><option value="5">5 次</option><option value="infinite">持續循環</option>
                </Select>
              </label>
              <label>間隔
                <Select value={delay} onChange={event => setDelay(Number(event.target.value))}>
                  {[0, 1, 2, 3].map(seconds => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
                </Select>
              </label>
            </div>
            {readerAdapter.setPlaybackRate && <div className="twoColumns">
              <label>{t("playbackRateLabel")}
                <Select value={playbackRate} disabled={rateApplying}
                  onChange={event => setPlaybackRate(Number(event.target.value))}>
                  {[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(rate =>
                    <option value={rate} key={rate}>{rate}×</option>)}
                </Select>
              </label>
              <div className="actions" style={{ alignSelf: "center" }}>
                <Button variant="outline" className="secondary" disabled={rateApplying}
                  onClick={() => void applyPlaybackRate()}>
                  {rateApplying ? t("applyingRate") : t("applyPlaybackRate")}
                </Button>
              </div>
            </div>}
            {readerAdapter.setPlaybackRate && <p className="hint">{t("ratePreferenceHint")}</p>}
            {readerAdapter.diagnose
              ? <div className="callout">
                  {readerAdapter.label} 的播放器控制由該平台 Adapter 提供；非公開介面可能更新失效。所有控制皆由你主動操作，不取得字幕。
                  <div className="actions"><Button variant="outline" className="secondary" onClick={() => void diagnoseVideo()}>檢查 {readerAdapter.label} 播放器</Button></div>
                </div>
              : readerAdapter.loop
                ? <p className="hint">目前來源：{readerAdapter.label}。循環會控制已開啟的影片分頁，不會重新載入。</p>
                : <p className="hint">目前來源沒有自動播放器控制；仍可閱讀字幕、查看時間及匯出文件。</p>}
            {playbackStatus && <p className="hint" role="status">{playbackStatus}</p>}
            {loopActive && <Button variant="outline" className="secondary" onClick={() => void stopLoop()}>停止循環</Button>}
          </Card>
          {document.sections.map(section => <Card className="panel lesson" key={section.id}>
            <Badge className="chip">{formatTime(section.startMs)}–{formatTime(section.endMs)}</Badge>
            <h2>{section.title}</h2>
            <p>{section.context}</p>
            <h3>原始字幕</h3>
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
                  {link && <Button variant="link" className="textButton" onClick={() => void chrome.tabs.create({ url: link })}>開啟時間連結</Button>}
                  {canSeek && <Button variant="link" className="textButton" onClick={() => void seekCue(cue)}>跳到影片指定時間</Button>}
                  {canLoop && <Button variant="link" className="textButton" onClick={() => void loopCue(cue)}>循環此句</Button>}
                  {!link && cue.startMs !== null && <Button variant="link" className="textButton" onClick={() => void navigator.clipboard.writeText(formatTime(cue.startMs))}>複製時間</Button>}
                </div>
              </div>;
            })}
            {section.vocabulary.length > 0 && <><h3>單字與片語</h3>
              {section.vocabulary.map((word, index) => <div className="learningCard" key={word.expression + index}>
                <strong>{word.expression}</strong><span>{word.meaning}</span>
                <p>{word.explanation}</p>{word.example && <p className="example">{word.example}</p>}
              </div>)}</>}
            {section.insights.length > 0 && <><h3>語言重點</h3><ul>{section.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></>}
            {section.exercises.length > 0 && <><h3>練習</h3>
              {section.exercises.map((exercise, index) => <details key={index}><summary>{exercise.question}</summary><p>{exercise.answer}</p></details>)}</>}
          </Card>)}
        </>}
      </main>}
    </div>
  );
}
