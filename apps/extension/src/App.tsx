import { useEffect, useMemo, useRef, useState } from "react";
import {
  compactStudyExport, formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  parseSubtitles, type AgentInfo, type AgentModel, type AgentProfile, type GenerationRequest, type JobSummary,
  type Destination, type DriveAccount, type DuplicateMatch,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { titleForVideoTab } from "./video/metadata";
import { detectCurrentVideoMetadata, metadataSourceSafety } from "./video/metadata-resolver";
import { videoMetadataMessages } from "./i18n/video-metadata";
import { subtitleAcquisition, subtitleMessage } from "./i18n/subtitle-acquisition";
import {
  cuePlaybackStart, cuePlaybackWindow,
  findVideoTab, getActiveWindowTab, openOrFocusVideoTab,
} from "./video/tab";
import { DocumentChunkAssembler } from "./native/document-chunks";
import { GENERATION_CONTROLLER_PORT, type GenerationControllerMessage } from "./native/generation-controller";
import { BookOpen, Settings2, WandSparkles } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";
import { SceneReader } from "./components/scene-reader";
import { SettingInfo } from "./components/setting-info";
import { learningSettingsCopy } from "./i18n/learning-settings";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale, isLocalePreference, isThemePreference, resolveTheme,
  nativeLanguageName, type LocalePreference, type ThemePreference,
} from "./i18n/preferences";

const HOST_NAME = "dev.immersive.language_learning";
type Page = "create" | "reader" | "settings";
type Installed = Record<string, boolean>;
type RepeatOption = "2" | "3" | "5" | "infinite";

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "adaptive", maxNewVocabulary: 8, exerciseCount: 3, sceneCount: 4,
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
        if (!cue) return "";
        const translated = "translations" in section
          ? section.translations.find(item => item.cueId === id)?.text : undefined;
        return "> " + formatTime(cue.startMs) + " " + cue.originalText +
          (translated ? "\n> " + translated : "");
      }),
      "", "### Vocabulary",
      ...section.vocabulary.map(word => "- " + word.expression + " — " + word.meaning + ": " + word.explanation),
      "", "### Insights", ...section.insights.map(text => "- " + text),
      "", "### Practice", ...section.exercises.map(ex => "- " + ex.question + "\n  - " + ex.answer), "",
    ]),
  ].join("\n");
  const content = format === "json" ? JSON.stringify(compactStudyExport(doc), null, 2) : md;
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
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const [subtitleStatus, setSubtitleStatus] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataStatus, setMetadataStatus] = useState("");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [activeVideo, setActiveVideo] = useState<{
    tabId: number; windowId: number; url: string; title: string;
  } | null>(null);
  const [browserLocale] = useState(getBrowserLocale);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("auto");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const uiLocale = localePreference === "auto" ? browserLocale : localePreference;
  const subtitleUi = subtitleAcquisition[uiLocale];
  const metadataUi = videoMetadataMessages[uiLocale];
  const settingsCopy = learningSettingsCopy[uiLocale];
  const t = (key: MessageKey, params?: MessageParams) => translate(uiLocale, key, params);
  const [profile, setProfile] = useState<LearningProfile>(() => ({
    ...DEFAULT_PROFILE, instructionLanguage: browserLocale,
  }));
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>>({});
  const [savedAgentProfiles, setSavedAgentProfiles] = useState<AgentProfile[]>([]);
  const [draftProfileName, setDraftProfileName] = useState("");
  const [draftProfileDir, setDraftProfileDir] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [modelOptions, setModelOptions] = useState<AgentModel[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNotice, setModelNotice] = useState("");
  const [customModelMode, setCustomModelMode] = useState(false);
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
  const controllerPortRef = useRef<chrome.runtime.Port | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const requestRef = useRef<string | null>(null);
  // Keep the last job across the controller dropping its active connection.
  const lastJobIdRef = useRef<string | null>(null);
  const lastJobSummaryRef = useRef<JobSummary | null>(null);
  const lastSelectedVideoKeyRef = useRef<string | null>(null);
  const manuallyEditedTitleRef = useRef(false);
  const metadataRequestRef = useRef(0);

  const cues = useMemo(() => raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw), [raw]);
  const platform = getVideoAdapter(sourceUrl).id;
  // A valid saved source remains actionable when the Side Panel temporarily loses its tab context.
  const subtitlePlatform = getVideoAdapter(activeVideo?.url ?? sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);
  const selectedAgentInfo = agentCatalog.find(entry => entry.id === agent.provider);
  const selectedSavedProfile = savedAgentProfiles.find(profile =>
    profile.provider === agent.provider && profile.directory === agent.accountConfigDir);
  const modelSelection = customModelMode ||
    (agent.modelId !== "" && !modelOptions.some(model => model.id === agent.modelId))
    ? "__custom__" : agent.modelId;
  const jobStatusKeys: Record<JobSummary["status"], MessageKey> = {
    queued: "jobQueued", running: "jobRunning", waiting: "jobWaiting",
    completed: "jobCompleted", failed: "jobFailed", cancelled: "jobCancelled",
  };

  useEffect(() => {
    void chrome.storage.local.get(["profile", "agent", "agentProfiles", "destination", "repeat", "delay", "playbackRate", "uiLocalePreference", "themePreference"]).then(saved => {
      if (saved.profile) setProfile({ ...DEFAULT_PROFILE, instructionLanguage: browserLocale, ...(saved.profile as Partial<LearningProfile>) });
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
    // Resolve the hosting Chrome window on every refresh. Discard stale async results
    // when navigation, activation and Side Panel initialization overlap.
    let mounted = true;
    let syncVersion = 0;
    const syncActiveTab = () => {
      const version = ++syncVersion;
      void getActiveWindowTab().then(tab => {
        if (!mounted || version !== syncVersion) return;
        setActiveVideo(tab && tab.id !== undefined && tab.url &&
          getVideoAdapter(tab.url).id !== "import"
          ? { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title ?? "Video" }
          : null);
      }).catch(() => {
        if (mounted && version === syncVersion) setActiveVideo(null);
      });
    };
    const onActivated = () => syncActiveTab();
    const onUpdated = (_tabId: number, change: { url?: string; status?: string; title?: string }) => {
      if (change.url || change.title || change.status === "complete") syncActiveTab();
    };
    const onRemoved = () => syncActiveTab();
    const onFocusChanged = (windowId: number) => {
      if (windowId >= 0) syncActiveTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    syncActiveTab();
    return () => {
      mounted = false;
      ++syncVersion;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
      portRef.current?.disconnect();
      preflightPortRef.current?.disconnect();
    };
  }, []);

  // A new Side Panel can attach to an Agent that stayed alive in the service
  // worker after the previous panel closed. Do not start or resume a second job.
  useEffect(() => {
    const observer = chrome.runtime.connect({ name: GENERATION_CONTROLLER_PORT });
    controllerPortRef.current = observer;
    const chunks = new DocumentChunkAssembler();
    observer.onMessage.addListener((message: GenerationControllerMessage) => {
      if (message.type === "generationState") {
        if (message.active) {
          activeRequestIdRef.current = message.active.requestId;
          requestRef.current = message.active.jobId;
          lastJobIdRef.current = message.active.jobId;
          if (!portRef.current) portRef.current = observer;
          if (message.active.summary) {
            updateJob(message.active.summary);
            setGenerating(["queued", "running"].includes(message.active.summary.status));
          } else {
            setGenerating(true);
            setProgress(t("statusResuming"));
          }
        } else {
          activeRequestIdRef.current = null;
          requestRef.current = null;
          if (portRef.current === observer) portRef.current = null;
          setGenerating(false);
          void loadJobs();
        }
        return;
      }
      if (message.id !== activeRequestIdRef.current) return;
      if (message.type === "job") {
        updateJob(message.job);
      } else if (message.type === "progress") {
        if (!lastJobSummaryRef.current || ["queued", "running"].includes(lastJobSummaryRef.current.status)) {
          setProgress(t("statusProgress", {
            completed: message.completed, total: message.total,
          }));
        }
      } else if (message.type === "published") {
        setPublishedLocation(message.location);
      } else if (message.type === "publicationFailed") {
        setError(t("publishFailed", { message: message.message }));
      } else if (message.type === "result") {
        try { showDocument(message.document); }
        catch { void loadJobs(); }
        setGenerating(false);
      } else if (message.type === "documentChunk") {
        try {
          const document = chunks.push(message);
          if (document) showDocument(document);
        } catch {
          // Reopening a panel in the middle of a chunk stream may miss its
          // first chunk. The complete canonical document remains on disk.
        }
        if (message.index === message.total - 1) void loadJobs();
      } else if (message.type === "error") {
        setError(message.message);
        setGenerating(false);
        if (!lastJobSummaryRef.current || ["queued", "running"].includes(lastJobSummaryRef.current.status)) {
          setProgress(t("jobFailed"));
        }
        void loadJobs();
      }
    });
    observer.postMessage({ type: "watch" });
    return () => {
      if (controllerPortRef.current === observer) controllerPortRef.current = null;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeVideo) return;
    const adapter = getVideoAdapter(activeVideo.url);
    const videoId = adapter.getVideoId(activeVideo.url);
    if (!videoId) return;
    const sourceAdapter = getVideoAdapter(sourceUrl);
    const sameSource = sourceAdapter.id === adapter.id &&
      sourceAdapter.getVideoId(sourceUrl) === videoId;

    // Never attach the currently playing video's title to subtitles already
    // imported or fetched for a different source.
    if (raw.trim() && !sameSource) return;
    if (!raw.trim() && !sameSource) {
      manuallyEditedTitleRef.current = false;
      setTitle("");
      setSourceUrl(activeVideo.url);
    }
    if (fileName && raw.trim()) return;
    let cancelled = false;
    void titleForVideoTab({
      id: activeVideo.tabId, url: activeVideo.url, title: activeVideo.title,
    }, adapter).then(detected => {
      if (!cancelled && detected && !manuallyEditedTitleRef.current) {
        setTitle(previous => previous === detected ? previous : detected);
      }
    });
    return () => { cancelled = true; };
  }, [activeVideo?.tabId, activeVideo?.url, activeVideo?.title, raw, sourceUrl, fileName]);

  // An error from YouTube must not remain visible after switching to Netflix
  // (or a different video). Leave ongoing generation errors untouched otherwise.
  useEffect(() => {
    const adapter = getVideoAdapter(activeVideo?.url);
    const key = activeVideo?.url && adapter.id !== "import"
      ? adapter.id + ":" + adapter.getVideoId(activeVideo.url) : null;
    if (key === lastSelectedVideoKeyRef.current) return;
    lastSelectedVideoKeyRef.current = key;
    setError("");
    setSubtitleStatus("");
  }, [activeVideo?.url]);

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
    setCustomModelMode(false);
    const previous = agentProfiles[provider];
    updateAgent({
      provider,
      modelId: previous?.modelId ?? "",
      accountConfigDir: previous?.accountConfigDir,
    });
  }

  async function loadAgentProfiles(): Promise<void> {
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "agentProfiles" });
      if (response.type !== "agentProfiles") throw new Error("Unexpected profile response.");
      setSavedAgentProfiles(response.profiles);
    } catch (cause) {
      setProfileStatus(cause instanceof Error ? cause.message : t("profileLoadError"));
    }
  }

  async function saveProfile(): Promise<void> {
    if (!selectedAgentInfo?.supportsAccountProfiles || !draftProfileName.trim() || !draftProfileDir.trim()) return;
    setProfileBusy(true);
    setProfileStatus("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(), type: "agentProfileSave",
        provider: agent.provider, label: draftProfileName.trim(), directory: draftProfileDir.trim(),
      });
      if (response.type !== "agentProfiles") throw new Error("Unexpected profile response.");
      setSavedAgentProfiles(response.profiles);
      const saved = response.profiles.find(profile =>
        profile.provider === agent.provider && profile.label === draftProfileName.trim());
      if (saved) {
        updateAgent({ ...agent, accountConfigDir: saved.directory, modelId: "" });
        setCustomModelMode(false);
      }
      setDraftProfileName("");
      setDraftProfileDir("");
      setProfileStatus(t("profileSaved"));
    } catch (cause) {
      setProfileStatus(cause instanceof Error ? cause.message : t("profileSaveError"));
    } finally { setProfileBusy(false); }
  }

  async function removeProfile(): Promise<void> {
    if (!selectedSavedProfile) return;
    setProfileBusy(true);
    setProfileStatus("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(), type: "agentProfileRemove", profileId: selectedSavedProfile.id,
      });
      if (response.type !== "agentProfiles") throw new Error("Unexpected profile response.");
      setSavedAgentProfiles(response.profiles);
      updateAgent({ ...agent, accountConfigDir: undefined, modelId: "" });
      setCustomModelMode(false);
      setProfileStatus(t("profileRemoved"));
    } catch (cause) {
      setProfileStatus(cause instanceof Error ? cause.message : t("profileRemoveError"));
    } finally { setProfileBusy(false); }
  }

  function chooseAgentProfile(id: string): void {
    const entry = savedAgentProfiles.find(profile => profile.id === id && profile.provider === agent.provider);
    if (id !== "" && !entry) return;
    updateAgent({ ...agent, accountConfigDir: entry?.directory, modelId: "" });
    setCustomModelMode(false);
    setProfileStatus("");
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
        void loadAgentProfiles();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) {
        setInstalled(null);
        setError((chrome.runtime.lastError?.message ?? "Native Host connection failed.") +
          " " + t("hostInstallHint", { id: chrome.runtime.id }));
      }
    });
    port.postMessage({ id, type: "health" });
  }

  useEffect(() => {
    if (!hydrated || installed === null) return;
    if (!installed[agent.provider]) {
      setModelOptions([]);
      setModelNotice(t("agentMissing"));
      return;
    }
    let ignore = false;
    setModelBusy(true);
    setModelOptions([]);
    setModelNotice("");
    void nativeOnce({
      id: crypto.randomUUID(), type: "agentModels",
      settings: { provider: agent.provider, modelId: "", accountConfigDir: agent.accountConfigDir },
    }).then(response => {
      if (ignore) return;
      if (response.type !== "agentModels") throw new Error("Unexpected model catalog response.");
      setModelOptions(response.models);
      setModelNotice(response.notice ?? "");
    }).catch(cause => {
      if (!ignore) {
        setModelOptions([]);
        setModelNotice(cause instanceof Error ? cause.message : t("modelsError"));
      }
    }).finally(() => { if (!ignore) setModelBusy(false); });
    return () => { ignore = true; };
  }, [hydrated, installed, agent.provider, agent.accountConfigDir]);

  function showDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setDocument(parsed.data);
    setPage("reader");
    setProgress(t("statusSaved"));
  }

  function jobStatusLine(summary: JobSummary): string {
    return summary.status === "queued" || summary.status === "running"
      ? t("statusProgress", { completed: summary.completed, total: summary.total })
      : t("jobProgress", {
          provider: summary.provider, status: t(jobStatusKeys[summary.status]),
          completed: summary.completed, total: summary.total,
        });
  }

  function updateJob(summary: JobSummary): void {
    setJobs(previous => [summary, ...previous.filter(job => job.id !== summary.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (summary.id === lastJobIdRef.current) {
      lastJobSummaryRef.current = summary;
      setProgress(jobStatusLine(summary));
    }
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
    const port = existingPort ?? chrome.runtime.connect({ name: GENERATION_CONTROLLER_PORT });
    preflightPortRef.current = null;
    portRef.current = port;
    requestRef.current = jobId;
    lastJobIdRef.current = jobId;
    lastJobSummaryRef.current = null;
    activeRequestIdRef.current = id;
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
        if (!lastJobSummaryRef.current || ["queued", "running"].includes(lastJobSummaryRef.current.status)) {
          setProgress(t("statusProgress", { completed: message.completed, total: message.total }));
        }
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
        if (!lastJobSummaryRef.current || ["queued", "running"].includes(lastJobSummaryRef.current.status)) {
          setProgress(t("jobFailed"));
        }
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
      const port = chrome.runtime.connect({ name: GENERATION_CONTROLLER_PORT });
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
    // Refreshing history must never dismiss the Agent error just received.
    setLoadingJobs(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    let received = false;
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id !== id) return;
      if (message.type === "jobs") {
        received = true;
        setJobs(message.jobs);
        const current = message.jobs.find(job => job.id === lastJobIdRef.current);
        if (current) updateJob(current);
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

  async function fetchCurrentVideoMetadata(): Promise<void> {
    if (metadataBusy || checking || generating || subtitleBusy) return;
    const request = ++metadataRequestRef.current;
    const originalSource = sourceUrl.trim();
    setMetadataBusy(true);
    setMetadataStatus("");
    setError("");
    try {
      if (originalSource && getVideoAdapter(originalSource).id === "import") {
        throw new Error(metadataUi.invalidSource);
      }
      const found = await detectCurrentVideoMetadata(originalSource);
      if (request !== metadataRequestRef.current) return;
      if (!found) throw new Error(metadataUi.unavailable);

      const safety = metadataSourceSafety(originalSource, raw, found.url);
      if (safety === "mismatch") throw new Error(metadataUi.mismatch);
      if (safety === "confirm" && !window.confirm(metadataUi.confirmUnlinked)) return;
      if (request !== metadataRequestRef.current) return;

      // Never replace an existing URL or a manually edited title; metadata
      // recovery only fills missing fields or refreshes an auto-detected title.
      setSourceUrl(current => current.trim() ? current : found.url);
      if (found.title && !manuallyEditedTitleRef.current) {
        setTitle(current => current.trim() && manuallyEditedTitleRef.current
          ? current : found.title ?? current);
      }
      setMetadataStatus(found.title ? metadataUi.success : metadataUi.partial);
    } catch (cause) {
      if (request === metadataRequestRef.current) {
        setError(cause instanceof Error && cause.message === "VIDEO_CHANGED"
          ? metadataUi.changed
          : cause instanceof Error ? cause.message : metadataUi.unavailable);
      }
    } finally {
      if (request === metadataRequestRef.current) setMetadataBusy(false);
    }
  }

  async function fetchCurrentSubtitles(): Promise<void> {
    if (subtitleBusy || metadataBusy) return;
    setSubtitleBusy(true);
    setSubtitleStatus("");
    setError("");
    try {
      const selected = await getActiveWindowTab();
      const selectedUrl = selected?.url ?? "";
      const currentAdapter = getVideoAdapter(selectedUrl);
      const formUrl = sourceUrl.trim();
      const formAdapter = getVideoAdapter(formUrl);
      if (currentAdapter.fetchSubtitles && formAdapter.fetchSubtitles &&
        (currentAdapter.id !== formAdapter.id ||
          currentAdapter.getVideoId(selectedUrl) !== formAdapter.getVideoId(formUrl))) {
        throw new Error(subtitleUi.sourceMismatch);
      }
      const url = currentAdapter.fetchSubtitles ? selectedUrl : formUrl;
      const adapter = getVideoAdapter(url);
      if (!adapter.fetchSubtitles) throw new Error(subtitleUi.unavailable);
      // Revalidate against a real, matching watch tab even when using the form URL
      // as a fallback. Never send a subtitle request to an unrelated active tab.
      const tab = await findVideoTab(adapter, url);
      const actualUrl = tab.url ?? url;
      const fetched = await adapter.fetchSubtitles(actualUrl, profile.targetLanguage);
      const parsed = parseSubtitles(fetched.text);
      if (!parsed.length || parsed.length > 3_000 ||
        parsed.reduce((sum, cue) => sum + cue.originalText.length, 0) > 220_000) {
        throw new Error("The current video did not return a usable transcript within the lesson size limit.");
      }
      // Never combine cues from a previous video with the currently selected video.
      const fromDifferentVideo = formAdapter.id !== adapter.id ||
        formAdapter.getVideoId(formUrl) !== adapter.getVideoId(actualUrl);
      const videoTitle = await titleForVideoTab(tab, adapter);
      if (fromDifferentVideo) manuallyEditedTitleRef.current = false;
      setRaw(fetched.text);
      setFileName("");
      setSourceUrl(actualUrl);
      if (videoTitle && !manuallyEditedTitleRef.current) setTitle(videoTitle);
      else if (fromDifferentVideo) setTitle("");
      setSubtitleStatus(subtitleMessage(subtitleUi.success, {
        count: parsed.length, language: fetched.language,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : subtitleUi.unavailable);
    } finally {
      setSubtitleBusy(false);
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 2_000_000) { setError(t("errorFileSize")); return; }
    ++metadataRequestRef.current;
    setMetadataBusy(false);
    setMetadataStatus("");
    setRaw(await file.text());
    setFileName(file.name);
    setSubtitleStatus("");
    if (!title) {
      manuallyEditedTitleRef.current = true;
      setTitle(file.name.replace(/\.(srt|vtt|txt)$/i, ""));
    }
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

  async function openTimestampCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null || !document?.source.url) return;
    setError("");
    try {
      const atMs = cuePlaybackStart(cue.startMs);
      const timestampUrl = readerAdapter.timestampLink?.(document.source.url, atMs);
      if (!timestampUrl) throw new Error(t("errorVideoOpenUnsupported"));
      // openOrFocusVideoTab matches the *video ID*, not the timestamp URL: it
      // will focus an already open watch tab rather than opening a duplicate.
      const { reused, tab } = await openOrFocusVideoTab(readerAdapter, timestampUrl);
      if (reused && readerAdapter.seek) {
        await readerAdapter.seek(document.source.url, atMs);
      } else if (reused && tab.id !== undefined) {
        // Future adapters that support timestamp links but not direct seeking.
        await chrome.tabs.update(tab.id, { url: timestampUrl });
      }
      setLoopActive(false);
      setPlaybackStatus(t(reused ? "statusVideoReused" : "statusVideoOpened"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("errorVideoOpen"));
    }
  }

  async function seekCue(cue: SubtitleCue): Promise<void> {
    if (cue.startMs === null) return;
    setError("");
    try {
      if (!readerAdapter.seek || !document?.source.url) throw new Error(t("errorSeekUnsupported"));
      await readerAdapter.seek(document.source.url, cuePlaybackStart(cue.startMs));
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
        ...cuePlaybackWindow(cue.startMs, cue.endMs),
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
      <nav className="tabs" aria-label={t("navLabel")}>
        <Button className={page === "create" ? "selected" : ""} onClick={() => setPage("create")}><WandSparkles aria-hidden="true" />{t("create")}</Button>
        <Button className={page === "reader" ? "selected" : ""} onClick={() => setPage("reader")}><BookOpen aria-hidden="true" />{t("reader")}</Button>
        <Button className={page === "settings" ? "selected" : ""} onClick={() => setPage("settings")}><Settings2 aria-hidden="true" />{t("settings")}</Button>
      </nav>

      {error && <div className="alert" role="alert">{error}<Button variant="ghost" size="icon" aria-label={t("closeError")} onClick={() => setError("")}>×</Button></div>}

      {page === "create" && <main>
        <Card className="panel">
          <h2>{t("subtitleHeading")}</h2>
          {(subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && <>
            <p className="hint">{subtitleUi.hint}</p>
            <Button className="subtitleFetchButton"
              disabled={subtitleBusy || metadataBusy || checking || generating}
              onClick={() => void fetchCurrentSubtitles()}>
              {subtitleBusy ? subtitleUi.busy : subtitleUi.button}
            </Button>
            {subtitleStatus && <p className="hint" role="status">{subtitleStatus}</p>}
          </>}
          {subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube" && <p className="hint">{t("subtitleHint")}</p>}
          <details open={subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube"}>
            <summary>{subtitleUi.manual}</summary>
            <label>{t("subtitleFile")} <Input type="file" accept=".srt,.vtt,.txt,text/plain" onChange={event => void onFile(event.target.files?.[0])} /></label>
            {fileName && <p className="hint">{t("importedFile", { name: fileName })}</p>}
            <label>{t("pasteSubtitles")} <Textarea rows={5} value={raw} onChange={event => {
              ++metadataRequestRef.current;
              setMetadataBusy(false);
              setMetadataStatus("");
              setRaw(event.target.value);
              setSubtitleStatus("");
            }}
              placeholder={t("subtitlePlaceholder")} /></label>
          </details>
          <p className="hint">{t("parsedCues", { count: cues.length })}</p>
          <div className="actions">
            <Button variant={!title.trim() || !sourceUrl.trim() ? "default" : "outline"}
              size="sm" disabled={metadataBusy || subtitleBusy || checking || generating}
              onClick={() => void fetchCurrentVideoMetadata()}>
              {metadataBusy ? metadataUi.busy :
                !title.trim() || !sourceUrl.trim() ? metadataUi.get : metadataUi.refresh}
            </Button>
          </div>
          {metadataStatus && <p className="hint" role="status">{metadataStatus}</p>}
          <label>{t("videoTitle")} <Input value={title} onChange={event => {
            ++metadataRequestRef.current;
            setMetadataBusy(false);
            manuallyEditedTitleRef.current = !!event.target.value.trim();
            setMetadataStatus("");
            setTitle(event.target.value);
          }} placeholder={t("titlePlaceholder")} /></label>
          <label>{t("videoUrl")} <Input type="url" value={sourceUrl} onChange={event => {
            ++metadataRequestRef.current;
            setMetadataBusy(false);
            setMetadataStatus("");
            setSourceUrl(event.target.value);
          }} placeholder="https://www.youtube.com/watch?v=…" /></label>
          <Badge className="chip">{t("source", { name: getVideoAdapter(sourceUrl).id === "import" ? t("providerImport") : getVideoAdapter(sourceUrl).label })}</Badge>
        </Card>

        <Card className="panel">
          <h2>{t("learningHeading")}</h2>
          <div className="twoColumns">
            <div className="settingField">
              <div className="settingHeading">
                <label htmlFor="learning-target">{t("targetLanguage")}</label>
                <SettingInfo label={t("targetLanguage")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.targetLanguage}
                  />
              </div>
              <Select id="learning-target" value={profile.targetLanguage} onChange={event => {
                const targetLanguage = event.target.value as LearningProfile["targetLanguage"];
                setProfile(current => ({ ...current, targetLanguage, level: targetLanguage === "en" ? "B1" : targetLanguage === "ja" ? "N4" : "2" }));
              }}><option value="en">{nativeLanguageName("en")}</option><option value="ja">{nativeLanguageName("ja")}</option><option value="ko">{nativeLanguageName("ko")}</option></Select>
            </div>
            <div className="settingField">
              <div className="settingHeading">
                <label htmlFor="learning-level">{t("level")}</label>
                <SettingInfo label={t("level")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.level}
                  />
              </div>
              <Select id="learning-level" value={profile.level}
                onChange={event => setProfile(current => ({ ...current, level: event.target.value }))}>
                {levelOptions.map(level => <option key={level} value={level}>
                  {level + " · " + (settingsCopy.levels[profile.targetLanguage][level]?.label ?? level)}
                </option>)}
              </Select>
            </div>
          </div>
          <div className="settingField">
            <div className="settingHeading">
              <label htmlFor="learning-explanation-language">{t("instructionLanguage")}</label>
              <SettingInfo label={t("instructionLanguage")} infoLabel={settingsCopy.infoLabel}
                explanation={settingsCopy.fieldHints.instructionLanguage}
                />
            </div>
            <Select id="learning-explanation-language" value={profile.instructionLanguage}
              onChange={event => setProfile(current => ({
                ...current, instructionLanguage: event.target.value as LearningProfile["instructionLanguage"],
              }))}>
              <option value="zh-TW">{nativeLanguageName("zh-TW")}</option><option value="zh-CN">{nativeLanguageName("zh-CN")}</option><option value="en">{nativeLanguageName("en")}</option><option value="ja">{nativeLanguageName("ja")}</option><option value="ko">{nativeLanguageName("ko")}</option>
            </Select>
          </div>
          <details className="advancedLessonSettings">
            <summary>{t("advancedLessonSettings")}</summary>
          <div className="settingField">
            <div className="settingHeading">
              <label htmlFor="learning-mode">{t("teachingMode")}</label>
              <SettingInfo label={t("teachingMode")} infoLabel={settingsCopy.infoLabel}
                explanation={settingsCopy.fieldHints.teachingMode}
                />
            </div>
            <Select id="learning-mode" value={profile.mode}
              onChange={event => setProfile(current => ({
                ...current, mode: event.target.value as LearningProfile["mode"],
              }))}>
              <option value="adaptive">{settingsCopy.modes.adaptive.label}</option>
              <option value="guided">{settingsCopy.modes.guided.label}</option>
              <option value="immersive">{settingsCopy.modes.immersive.label}</option>
            </Select>
          </div>
          </details>
          <div className="settingField">
            <div className="settingHeading">
              <label htmlFor="learning-scenes">{t("sceneCount")}</label>
              <SettingInfo label={t("sceneCount")} infoLabel={settingsCopy.infoLabel}
                explanation={settingsCopy.fieldHints.sceneCount} />
            </div>
            <Input id="learning-scenes" type="number" min={1} max={6}
              value={profile.sceneCount} onChange={event => setProfile(current => ({
                ...current, sceneCount: Number(event.target.value),
              }))} />
          </div>
          <div className="twoColumns">
            <div className="settingField">
              <div className="settingHeading">
                <label htmlFor="learning-vocabulary">{t("vocabLimit")}</label>
                <SettingInfo label={t("vocabLimit")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.vocabLimit} />
              </div>
              <Input id="learning-vocabulary" type="number" min={1} max={12}
                value={profile.maxNewVocabulary}
                onChange={event => setProfile(current => ({
                  ...current, maxNewVocabulary: Number(event.target.value),
                }))} />
            </div>
            <div className="settingField">
              <div className="settingHeading">
                <label htmlFor="learning-exercises">{t("exerciseCount")}</label>
                <SettingInfo label={t("exerciseCount")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.exerciseCount} />
              </div>
              <Input id="learning-exercises" type="number" min={0} max={6}
                value={profile.exerciseCount}
                onChange={event => setProfile(current => ({
                  ...current, exerciseCount: Number(event.target.value),
                }))} />
            </div>
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
          {jobs.length > 0 && <div className="jobHistoryList">
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
          </div>}
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
              <option value="auto">{t("browserLanguage")} · {nativeLanguageName(browserLocale)}</option>
              <option value="en">{nativeLanguageName("en")}</option>
              <option value="zh-TW">{nativeLanguageName("zh-TW")}</option>
              <option value="zh-CN">{nativeLanguageName("zh-CN")}</option>
              <option value="ja">{nativeLanguageName("ja")}</option>
              <option value="ko">{nativeLanguageName("ko")}</option>
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
          {selectedAgentInfo?.supportsAccountProfiles ? <>
            <label>{t("agentAccount")}
              <Select value={selectedSavedProfile?.id ?? (agent.accountConfigDir ? "__legacy__" : "")}
                onChange={event => chooseAgentProfile(event.target.value)}>
                <option value="">{t("accountDefault")}</option>
                {agent.accountConfigDir && !selectedSavedProfile &&
                  <option value="__legacy__">{t("accountLegacy", { path: agent.accountConfigDir })}</option>}
                {savedAgentProfiles.filter(profile => profile.provider === agent.provider).map(profile =>
                  <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </Select>
            </label>
            <p className="hint">{t("accountFolderHint")}</p>
            <label>{t("profileName")}
              <Input value={draftProfileName} onChange={event => setDraftProfileName(event.target.value)}
                placeholder={t("profileNamePlaceholder")} />
            </label>
            <label>{t("accountFolder")}
              <Input value={draftProfileDir} onChange={event => setDraftProfileDir(event.target.value)}
                placeholder={t("accountFolderPlaceholder")} />
            </label>
            <div className="actions">
              <Button variant="outline" className="secondary"
                disabled={profileBusy || installed === null || !draftProfileName.trim() || !draftProfileDir.trim()}
                onClick={() => void saveProfile()}>{t("saveProfile")}</Button>
              {selectedSavedProfile && <Button variant="outline" className="secondary"
                disabled={profileBusy || installed === null}
                onClick={() => void removeProfile()}>{t("removeProfile")}</Button>}
            </div>
            {profileStatus && <p className="hint" role="status">{profileStatus}</p>}
          </> : <p className="hint">{t("agentProfileUnsupported")}</p>}
          <label>{t("defaultModel")}
            <Select disabled={modelBusy} value={modelSelection} onChange={event => {
              const value = event.target.value;
              if (value === "__custom__") {
                setCustomModelMode(true);
                updateAgent({ ...agent, modelId: "" });
              } else {
                setCustomModelMode(false);
                updateAgent({ ...agent, modelId: value });
              }
            }}>
              <option value="">{t("cliDefault")}</option>
              {modelOptions.map(model => <option key={model.id} value={model.id}>
                {model.label === model.id ? model.id : model.label + " · " + model.id}
              </option>)}
              <option value="__custom__">{t("customModel")}</option>
            </Select>
          </label>
          {modelSelection === "__custom__" && <label>{t("modelId")}
            <Input value={agent.modelId} onChange={event => updateAgent({ ...agent, modelId: event.target.value })}
              placeholder={t("modelPlaceholder")} />
          </label>}
          <div className="actions"><Button variant="outline" className="secondary"
            disabled={modelBusy || installed === null} onClick={() => {
              setInstalled(current => current ? { ...current } : current);
            }}>{modelBusy ? t("modelsLoading") : t("refreshModels")}</Button></div>
          {modelNotice && <p className="hint" role="status">{modelNotice}</p>}
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
        </Card> : document.schemaVersion === 2 ? <SceneReader key={document.id}
          document={document} adapter={readerAdapter} locale={uiLocale}
          repeat={repeat} setRepeat={setRepeat} delay={delay} setDelay={setDelay}
          playbackRate={playbackRate} setPlaybackRate={setPlaybackRate}
          onError={setError} onDownload={format => downloadDocument(document, format)}
        /> : <>
          <Card className="panel">
            <Badge className="chip">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</Badge>
            <h1>{document.source.title}</h1>
            <p className="hint">{t("lessonOverview", { count: document.sections.length, language: document.profile.instructionLanguage })}</p>
            {publishedLocation && <p className="hint">{t("publishedTo", { location: publishedLocation })}</p>}
            <div className="actions">
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "json")}>{t("saveJson")}</Button>
              <Button variant="outline" className="secondary" onClick={() => downloadDocument(document, "md")}>{t("saveMarkdown")}</Button>
            </div>
          </Card>
          <Card className="panel">
            <h2>{t("videoCompanion")}</h2>
            {document.source.url && readerAdapter.id !== "import" &&
              <div className="actions">
                <Button variant="outline" className="secondary" disabled={openingVideo}
                  onClick={() => void openVideo()}>
                  {openingVideo ? t("openingVideo") : t("openOrFocusVideo")}
                </Button>
              </div>}
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
                  {t("experimentalVideoHint", { name: readerAdapter.label })}
                  <div className="actions"><Button variant="outline" className="secondary" onClick={() => void diagnoseVideo()}>{t("checkPlayer", { name: readerAdapter.label })}</Button></div>
                </div>
              : readerAdapter.loop
                ? <p className="hint">{t("youtubeVideoHint", { name: readerAdapter.label })}</p>
                : <p className="hint">{t("noVideoControl")}</p>}
            {playbackStatus && <p className="hint" role="status">{playbackStatus}</p>}
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
                ? readerAdapter.timestampLink?.(document.source.url, cuePlaybackStart(cue.startMs)) ?? null : null;
              const canSeek = cue.startMs !== null && !!readerAdapter.seek;
              const canLoop = cue.startMs !== null && cue.endMs !== null && !!readerAdapter.loop;
              return <div className="cue" key={id}>
                <span className="time">{formatTime(cue.startMs)}</span>
                <p>{cue.originalText}</p>
                <div className="actions">
                  {link && <Button variant="link" className="textButton" onClick={() => void openTimestampCue(cue)}>{t("openTimestamp")}</Button>}
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
