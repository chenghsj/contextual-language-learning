import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackupSettingsSchema, compactStudyExport, learningDocumentToMarkdown, formatTime, GenerationRequestSchema, LearningDocumentSchema, parsePlainText,
  LEARNING_LANGUAGES, EXPLANATION_LANGUAGES, levelsForTargetLanguage, defaultLevelForTargetLanguage,
  parseSubtitles, type AgentInfo, type AgentModel, type AgentProfile, type GenerationRequest, type JobSummary,
  type BackupSettings, type Destination, type DriveAccount, type DriveLessonSummary, type LessonSummary, type DuplicateMatch,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningLanguage, type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { contextualGenerationProfile, normalizeSavedLessonProfile } from "./lib/contextual-profile";
import { titleForVideoTab } from "./video/metadata";
import { detectCurrentVideoMetadata, metadataSourceSafety } from "./video/metadata-resolver";
import { videoMetadataMessages } from "./i18n/video-metadata";
import { subtitleAcquisition, subtitleMessage } from "./i18n/subtitle-acquisition";
import { needsVideoReaderReload } from "./video/reader-health";
import {
  captionCacheKey, isCurrentCaption, subtitleLanguageMatches, videoSourceKey,
  type CaptionProvenance,
} from "./video/caption-provenance";
import {
  cuePlaybackStart, cuePlaybackWindow,
  assertVideoReaderReady, findVideoTab, getActiveWindowTab, openOrFocusVideoTab,
  reloadExistingVideoTab,
} from "./video/tab";
import { DocumentChunkAssembler } from "./native/document-chunks";
import { CustomAgentSettings } from "./components/custom-agent-settings";
import { GENERATION_CONTROLLER_PORT, type GenerationControllerMessage } from "./native/generation-controller";
import { BookOpen, Library, Settings2, WandSparkles, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { AppPanel } from "./components/app-panel";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectField, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Badge } from "./components/ui/badge";
import { SceneReader } from "./components/scene-reader";
import { ContextualSceneReader } from "./components/contextual-scene-reader";
import { SettingInfo } from "./components/setting-info";
import { learningSettingsCopy, levelHint } from "./i18n/learning-settings";
import { agentDisplayName, modelDisplayName } from "./i18n/agent-display";
import { agentModelPreferenceKey, savedAgentModel, migrateAgentModelPreferences } from "./i18n/agent-model-preferences";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale, isLocalePreference, isThemePreference, resolveTheme,
  nativeLanguageName, learningLanguageName, explanationLanguageName,
  type LocalePreference, type ThemePreference,
} from "./i18n/preferences";

const HOST_NAME = "dev.immersive.language_learning";
type Page = "create" | "reader" | "settings" | "lessons";
type LessonEntry = { documentId: string; title: string; createdAt: string; local?: LessonSummary; drive?: DriveLessonSummary };
type Installed = Record<string, boolean>;
type RepeatOption = "2" | "3" | "5" | "infinite";

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "adaptive", maxNewVocabulary: 8, exerciseCount: 0, sceneCount: 4,
  contextualExampleCount: 2,
};
const DEFAULT_AGENT: AgentSettings = { provider: "claude", modelId: "" };

function downloadDocument(doc: LearningDocument, format: "json" | "md"): void {
  const content = format === "json"
    ? JSON.stringify(compactStudyExport(doc), null, 2)
    : learningDocumentToMarkdown(doc);
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
  const [captionSource, setCaptionSource] = useState<CaptionProvenance | null>(null);
  const [videoRecoveryUrl, setVideoRecoveryUrl] = useState("");
  const [reloadingVideoTab, setReloadingVideoTab] = useState(false);
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
  const [explanationLanguageMode, setExplanationLanguageMode] = useState<"auto" | "custom">("auto");
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>>({});
  const [agentModelPreferences, setAgentModelPreferences] = useState<Record<string, string>>({});
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
  const [hostVersion, setHostVersion] = useState<string | null>(null);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([
    { id: "claude", label: "Claude Code", installed: false, supportsAccountProfiles: true },
    { id: "codex", label: "Codex CLI", installed: false, supportsAccountProfiles: true },
    { id: "agy", label: "Antigravity CLI (agy)", installed: false, supportsAccountProfiles: false },
  ]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [jobFilter, setJobFilter] = useState<"all" | "active" | "completed">("all");
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [localLessons, setLocalLessons] = useState<LessonSummary[]>([]);
  const [cloudLessons, setCloudLessons] = useState<DriveLessonSummary[]>([]);
  const [lessonFilter, setLessonFilter] = useState<"all" | "local" | "drive">("all");
  const [lessonsBusy, setLessonsBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>({ kind: "local" });
  const [backup, setBackup] = useState<BackupSettings>({ enabled: false });
  const [backupStatus, setBackupStatus] = useState("");
  const [driveConnectError, setDriveConnectError] = useState("");
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveAccountsLoaded, setDriveAccountsLoaded] = useState(false);
  const [driveAccess, setDriveAccess] = useState<{
    accountId: string; status: "checking" | "verified" | "failed";
  } | null>(null);
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
  const captionRequestRef = useRef(0);
  const captionDraftsRef = useRef(new Map<string, {
    raw: string; fileName: string; source: CaptionProvenance;
  }>());
  const catalogLoadIdRef = useRef(0);

  const cues = useMemo(() => raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw), [raw]);
  const captionsReady = !!raw.trim() && isCurrentCaption(captionSource, profile.targetLanguage, sourceUrl);
  const platform = getVideoAdapter(sourceUrl).id;
  // A valid saved source remains actionable when the Side Panel temporarily loses its tab context.
  const subtitlePlatform = getVideoAdapter(activeVideo?.url ?? sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);
  const selectedDriveId = backup.accountId ?? driveAccounts[0]?.id;
  const driveAccessVerified = !!selectedDriveId && driveAccess?.accountId === selectedDriveId &&
    driveAccess.status === "verified";
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
    void chrome.storage.local.get(["profile", "agent", "agentProfiles", "agentModelPreferences", "destination", "backup", "repeat", "delay", "playbackRate", "uiLocalePreference", "themePreference", "explanationLanguageMode"]).then(saved => {
      if (saved.profile) setProfile(normalizeSavedLessonProfile(saved.profile as Partial<LearningProfile>, {
        ...DEFAULT_PROFILE, instructionLanguage: browserLocale,
      }));
      if (saved.explanationLanguageMode === "custom" ||
          (!saved.explanationLanguageMode && saved.profile &&
            (saved.profile as Partial<LearningProfile>).instructionLanguage !== browserLocale)) {
        setExplanationLanguageMode("custom");
      }
      if (isLocalePreference(saved.uiLocalePreference)) setLocalePreference(saved.uiLocalePreference);
      if (isThemePreference(saved.themePreference)) setThemePreference(saved.themePreference);
      if (saved.agent) setAgent(saved.agent as AgentSettings);
      if (saved.agentProfiles && typeof saved.agentProfiles === "object") {
        setAgentProfiles(saved.agentProfiles as Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>);
      } else if (saved.agent) {
        const previous = saved.agent as AgentSettings;
        setAgentProfiles({ [previous.provider]: { modelId: previous.modelId, accountConfigDir: previous.accountConfigDir } });
      }
      const previousAgent = saved.agent as AgentSettings | undefined;
      const previousProfiles = saved.agentProfiles && typeof saved.agentProfiles === "object"
        ? saved.agentProfiles as Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">> : {};
      const legacyModels = migrateAgentModelPreferences(previousAgent, previousProfiles);
      if (saved.agentModelPreferences && typeof saved.agentModelPreferences === "object" &&
          !Array.isArray(saved.agentModelPreferences)) {
        const stored = Object.fromEntries(Object.entries(saved.agentModelPreferences)
          .filter(([key, value]) => key.length < 2048 && typeof value === "string" && value.length <= 120));
        setAgentModelPreferences({ ...legacyModels, ...stored });
      } else {
        setAgentModelPreferences(legacyModels);
      }
      if (saved.destination) {
        const previous = saved.destination as Destination;
        if (previous.kind === "local") setDestination(previous);
        else if (!saved.backup) setBackup({ enabled: true, accountId: previous.accountId });
      }
      if (saved.backup) {
        const parsed = BackupSettingsSchema.safeParse(saved.backup);
        if (parsed.success) setBackup(parsed.data);
      }
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
      if (message.type === "backupsFinished") { void loadJobs(); return; }
      if (message.id !== activeRequestIdRef.current) return;
      if (message.type === "backupPublished") {
        setBackupStatus(t("backupSaved"));
        void loadJobs();
        return;
      }
      if (message.type === "backupFailed") {
        setBackupStatus(t("backupFailedMessage"));
        void loadJobs();
        return;
      }
      if (message.type === "generationSettled") { void loadJobs(); return; }
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
    observer.postMessage({ type: "resumeBackups", id: crypto.randomUUID() });
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
    ++captionRequestRef.current;
    setSubtitleBusy(false);
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
    const activeTheme = resolveTheme(themePreference, systemDark);
    window.document.documentElement.dataset.theme = activeTheme;
    window.document.documentElement.classList.toggle("dark", activeTheme === "dark");
  }, [uiLocale, themePreference, systemDark]);

  useEffect(() => {
    if (hydrated) void chrome.storage.local.set({ profile, agent, agentProfiles, agentModelPreferences, destination, backup, repeat, delay, playbackRate, uiLocalePreference: localePreference, themePreference, explanationLanguageMode });
  }, [hydrated, profile, agent, agentProfiles, agentModelPreferences, destination, backup, repeat, delay, playbackRate, localePreference, themePreference, explanationLanguageMode]);

  useEffect(() => {
    if (hydrated && explanationLanguageMode === "auto") {
      setProfile(previous => previous.instructionLanguage === uiLocale ? previous
        : { ...previous, instructionLanguage: uiLocale });
    }
  }, [hydrated, explanationLanguageMode, uiLocale]);

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
      // Account choice no longer changes the local lesson destination.
    } catch {
      // Local-only use does not require a connected Host or a Google account.
      setDriveAccounts([]);
      setDriveConfigured(false);
    } finally {
      setDriveAccountsLoaded(true);
    }
  }

  // A remembered OAuth identity is not evidence of current Drive API access.
  // Revalidate the selected account after restore, account switching and panel reopen.
  useEffect(() => {
    if (!hydrated || !driveAccountsLoaded || storageBusy) return;
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) {
      setDriveAccess(null);
      return;
    }
    if (!driveAccounts.some(account => account.id === accountId)) {
      setDriveAccess({ accountId, status: "failed" });
      setDriveConnectError(t("backupUnknownAccount"));
      setBackup({ enabled: false, accountId: driveAccounts[0]?.id });
      return;
    }
    let cancelled = false;
    setDriveAccess({ accountId, status: "checking" });
    void nativeOnce({ id: crypto.randomUUID(), type: "driveValidate", accountId }).then(response => {
      if (cancelled) return;
      if (response.type !== "driveValidated") throw new Error("Google Drive access could not be verified.");
      setDriveAccess({ accountId, status: "verified" });
      setDriveConnectError("");
    }).catch(cause => {
      if (cancelled) return;
      setDriveAccess({ accountId, status: "failed" });
      setDriveConnectError(cause instanceof Error ? cause.message : t("connectDriveError"));
      // Keep locally saved lessons usable; never report an unusable backup as enabled.
      setBackup(current => current.accountId === accountId && current.enabled
        ? { ...current, enabled: false } : current);
    });
    return () => { cancelled = true; };
  }, [hydrated, driveAccountsLoaded, backup.accountId, driveAccounts, storageBusy]);

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

  async function connectDrive(): Promise<void> {
    setStorageBusy(true);
    setError("");
    setDriveConnectError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveConnect" });
      if (response.type !== "driveConnected") throw new Error("Unexpected Google account response");
      setDriveAccounts(current => [...current.filter(item => item.id !== response.account.id), response.account]);
      // OAuth proves identity, not Drive API access. Do not turn backup on
      // until an actual request to the selected Drive account succeeds.
      const verified = await nativeOnce({
        id: crypto.randomUUID(), type: "driveValidate", accountId: response.account.id,
      });
      if (verified.type !== "driveValidated") throw new Error("Google Drive access could not be verified.");
      setDriveAccess({ accountId: response.account.id, status: "verified" });
      setBackup({ enabled: true, accountId: response.account.id });
      setDriveConnectError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("connectDriveError");
      setError(message);
      setDriveConnectError(message);
    } finally { setStorageBusy(false); }
  }

  async function disconnectDrive(accountId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveDisconnect", accountId });
      if (response.type !== "driveDisconnected") throw new Error("Unexpected Drive response");
      const remaining = driveAccounts.filter(item => item.id !== accountId);
      setDriveAccounts(remaining);
      setBackup(current => current.accountId === accountId
        ? { enabled: false, accountId: remaining[0]?.id } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("connectDriveError"));
    } finally { setStorageBusy(false); }
  }

  async function enableBackup(): Promise<void> {
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) { await connectDrive(); return; }
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveValidate", accountId });
      if (response.type !== "driveValidated") throw new Error("Unexpected Drive validation response");
      setDriveAccess({ accountId, status: "verified" });
      setDriveConnectError("");
      setBackup({ enabled: true, accountId });
    } catch (cause) {
      setDriveAccess({ accountId, status: "failed" });
      // A valid OAuth session can still lack Drive API access. Never force
      // another login for quota, disabled API, or file permission errors.
      const message = cause instanceof Error ? cause.message : t("connectDriveError");
      setError(message);
      setDriveConnectError(message);
    } finally { setStorageBusy(false); }
  }

  async function retryBackup(jobId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "retryBackup", jobId });
      if (response.type === "backupFailed") throw new Error(response.message);
      if (response.type !== "backupPublished") throw new Error("Unexpected backup response");
      setBackupStatus(t("backupSaved"));
      loadJobs();
    } catch (cause) {
      setBackupStatus(t("backupFailedMessage"));
      setError(cause instanceof Error ? cause.message : t("publicationError"));
      loadJobs();
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
    setAgentModelPreferences(previous => ({
      ...previous, [agentModelPreferenceKey(next.provider, next.accountConfigDir)]: next.modelId,
    }));
  }

  function selectAgent(provider: string): void {
    setCustomModelMode(false);
    const previous = agentProfiles[provider];
    updateAgent({
      provider,
      modelId: savedAgentModel(provider, previous?.accountConfigDir, agentModelPreferences, previous?.modelId ?? ""),
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
        updateAgent({ ...agent, accountConfigDir: saved.directory,
          modelId: savedAgentModel(agent.provider, saved.directory, agentModelPreferences) });
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
      updateAgent({ ...agent, accountConfigDir: undefined,
        modelId: savedAgentModel(agent.provider, undefined, agentModelPreferences) });
      setCustomModelMode(false);
      setProfileStatus(t("profileRemoved"));
    } catch (cause) {
      setProfileStatus(cause instanceof Error ? cause.message : t("profileRemoveError"));
    } finally { setProfileBusy(false); }
  }

  function chooseAgentProfile(id: string): void {
    const entry = savedAgentProfiles.find(profile => profile.id === id && profile.provider === agent.provider);
    if (id !== "" && !entry) return;
    updateAgent({ ...agent, accountConfigDir: entry?.directory,
      modelId: savedAgentModel(agent.provider, entry?.directory, agentModelPreferences) });
    setCustomModelMode(false);
    setProfileStatus("");
  }

  function checkHost(): void {
    setError("");
    setHostBusy(true);
    const startedAt = performance.now();
    const finishCheck = () => window.setTimeout(() => setHostBusy(false),
      Math.max(0, 500 - (performance.now() - startedAt)));
    const id = crypto.randomUUID();
    let replied = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((message: HostMessage) => {
      if (message.id === id && message.type === "health") {
        replied = true;
        setInstalled(message.installed);
        setHostVersion(typeof message.version === "string" ? message.version : null);
        if (Array.isArray(message.agents)) setAgentCatalog(message.agents);
        void loadAgentProfiles();
        finishCheck();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) {
        setInstalled(null);
        setHostVersion(null);
        setError((chrome.runtime.lastError?.message ?? "Native Host connection failed.") +
          " " + t("hostInstallHint", { id: chrome.runtime.id }));
        finishCheck();
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
    let settleTimer: number | undefined;
    const startedAt = performance.now();
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
    }).finally(() => {
      if (!ignore) settleTimer = window.setTimeout(() => {
        if (!ignore) setModelBusy(false);
      }, Math.max(0, 500 - (performance.now() - startedAt)));
    });
    return () => { ignore = true; window.clearTimeout(settleTimer); };
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
          provider: agentDisplayName(summary.provider, agentCatalog.find(item => item.id === summary.provider)?.label), status: t(jobStatusKeys[summary.status]),
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
      } else if (message.type === "backupPublished") {
        setBackupStatus(t("backupSaved"));
        void loadJobs();
      } else if (message.type === "backupFailed") {
        setBackupStatus(t("backupFailedMessage"));
        void loadJobs();
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
    if (subtitleBusy || !captionsReady) {
      setError(subtitleMessage(subtitleUi.languageNotReady, {
        language: learningLanguageName(profile.targetLanguage, uiLocale),
      }));
      return;
    }
    if (backup.enabled && !driveAccessVerified) {
      setError(t("driveAccessNotVerified"));
      return;
    }
    setError("");
    cancelDuplicate();
    setPublishedLocation("");
    setBackupStatus("");
    try {
      const payload = GenerationRequestSchema.parse({
        id: crypto.randomUUID(),
        source: { platform, title: title.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
        lessonFormat: "contextual-v3", profile: contextualGenerationProfile(profile),
        agent, destination, backup, cues,
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

  async function loadLessons(): Promise<void> {
    const version = ++catalogLoadIdRef.current;
    setLessonsBusy(true);
    setCatalogError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "listLessons" });
      if (response.type !== "lessons") throw new Error("Unexpected lesson catalog response");
      if (version !== catalogLoadIdRef.current) return;
      setLocalLessons(response.lessons);
      const accountId = backup.accountId ?? driveAccounts[0]?.id;
      if (accountId) {
        try {
          const cloud = await nativeOnce({ id: crypto.randomUUID(), type: "listDriveLessons", accountId });
          if (cloud.type !== "driveLessons") throw new Error("Unexpected Drive catalog response");
          if (version === catalogLoadIdRef.current) setCloudLessons(cloud.lessons);
        } catch (cause) {
          if (version === catalogLoadIdRef.current) {
            // Keep previously loaded cloud rows visible while the API is
            // temporarily unavailable; the local lesson catalog remains usable.
            setCatalogError(cause instanceof Error ? cause.message : t("lessonCatalogError"));
          }
        }
      } else setCloudLessons([]);
    } catch (cause) {
      if (version === catalogLoadIdRef.current) setCatalogError(
        cause instanceof Error ? cause.message : t("lessonCatalogError"));
    } finally {
      if (version === catalogLoadIdRef.current) setLessonsBusy(false);
    }
  }

  async function restoreLesson(lesson: DriveLessonSummary): Promise<void> {
    setRestoreBusy(lesson.documentId);
    setCatalogError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "restoreDriveLesson",
        accountId: lesson.accountId, documentId: lesson.documentId });
      if (response.type !== "driveRestored") throw new Error("Unexpected restore response");
      await loadLessons();
      openSavedDocument(response.documentId);
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : t("lessonRestoreError"));
    } finally { setRestoreBusy(null); }
  }

  async function backupExistingLessons(): Promise<void> {
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) { await connectDrive(); return; }
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "backupExisting", accountId });
      if (response.type !== "backupsScheduled") throw new Error("Unexpected backup response");
      setBackupStatus(t("existingBackupsScheduled", { count: response.count }));
      controllerPortRef.current?.postMessage({ id: crypto.randomUUID(), type: "resumeBackups" });
      void loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("publicationError"));
    } finally { setStorageBusy(false); }
  }

  function loadJobs(): void {
    if (loadingJobs) return;
    // Refreshing history must never dismiss the Agent error just received.
    setLoadingJobs(true);
    const startedAt = performance.now();
    const finishLoading = () => window.setTimeout(() => setLoadingJobs(false),
      Math.max(0, 500 - (performance.now() - startedAt)));
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
        finishLoading();
        port.disconnect();
      } else if (message.type === "error") {
        received = true;
        setError(message.message);
        finishLoading();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!received) {
        finishLoading();
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
  }, [raw, title, sourceUrl, profile, agent, destination, backup]);

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
      // An explicitly confirmed metadata link can bind an imported transcript to this video.
      // Editing a video URL directly never silently rebinds an unrelated subtitle file.
      if (!originalSource && captionSource?.origin === "manual" && raw.trim()) {
        const source: CaptionProvenance = { ...captionSource, sourceKey: videoSourceKey(found.url) };
        setCaptionSource(source);
        captionDraftsRef.current.set(captionCacheKey(found.url, profile.targetLanguage), {
          raw, fileName, source,
        });
      }
      setSourceUrl(current => current.trim() ? current : found.url);
      if (found.title && !manuallyEditedTitleRef.current) {
        setTitle(current => current.trim() && manuallyEditedTitleRef.current
          ? current : found.title ?? current);
      }
      setMetadataStatus(found.title ? metadataUi.success : metadataUi.partial);
      setVideoRecoveryUrl(found.title ? "" : found.url);
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

  function chooseLearningLanguage(next: string): void {
    const language = LEARNING_LANGUAGES.find(value => value === next);
    if (!language || language === profile.targetLanguage || checking || generating) return;
    ++captionRequestRef.current; // Supersede a previous language/video request immediately.
    setSubtitleBusy(false);
    setProfile(current => ({
      ...current, targetLanguage: language, level: defaultLevelForTargetLanguage(language),
    }));
    setError("");
    setVideoRecoveryUrl("");
    const cached = captionDraftsRef.current.get(captionCacheKey(sourceUrl, language));
    if (cached) {
      setRaw(cached.raw);
      setFileName(cached.fileName);
      setCaptionSource(cached.source);
    } else {
      // Keep the old draft visible; its source-language identity prevents generation.
      setCaptionSource(null);
    }
    if (cached?.source.origin === "manual") {
      setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageReady, {
        language: learningLanguageName(language, uiLocale),
      }));
      return;
    }
    if (!cached && captionSource?.origin === "manual" && raw.trim()) {
      setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageChanged, {
        language: learningLanguageName(language, uiLocale),
      }));
      return;
    }
    if (!getVideoAdapter(activeVideo?.url ?? sourceUrl).fetchSubtitles) {
      setSubtitleStatus(subtitleMessage(subtitleUi.languageNotReady, {
        language: learningLanguageName(language, uiLocale),
      }));
      return;
    }
    void fetchCurrentSubtitles(language, true);
  }

  async function fetchCurrentSubtitles(
    language: LearningLanguage = profile.targetLanguage, replacing = false,
  ): Promise<void> {
    if ((!replacing && (subtitleBusy || metadataBusy)) || checking || generating) return;
    const request = ++captionRequestRef.current;
    let attemptedUrl = "";
    setCaptionSource(null);
    setSubtitleBusy(true);
    setSubtitleStatus(subtitleMessage(subtitleUi.loadingLanguage, {
      language: learningLanguageName(language, uiLocale),
    }));
    setVideoRecoveryUrl("");
    setError("");
    try {
      const selected = await getActiveWindowTab();
      if (request !== captionRequestRef.current) return;
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
      const tab = await findVideoTab(adapter, url);
      if (request !== captionRequestRef.current) return;
      const actualUrl = tab.url ?? url;
      attemptedUrl = actualUrl;
      await assertVideoReaderReady(tab, adapter);
      if (request !== captionRequestRef.current) return;
      const fetched = await adapter.fetchSubtitles(actualUrl, language);
      if (request !== captionRequestRef.current) return;
      if (!subtitleLanguageMatches(language, fetched.language)) {
        throw new Error(subtitleMessage(subtitleUi.languageMismatch, {
          requested: learningLanguageName(language, uiLocale), actual: fetched.language,
        }));
      }
      const parsed = parseSubtitles(fetched.text);
      if (!parsed.length || parsed.length > 3_000 ||
        parsed.reduce((sum, cue) => sum + cue.originalText.length, 0) > 220_000) {
        throw new Error("The current video did not return a usable transcript within the lesson size limit.");
      }
      const sourceKey = videoSourceKey(actualUrl);
      if (!sourceKey) throw new Error(subtitleUi.sourceMismatch);
      const fromDifferentVideo = formAdapter.id !== adapter.id ||
        formAdapter.getVideoId(formUrl) !== adapter.getVideoId(actualUrl);
      const videoTitle = await titleForVideoTab(tab, adapter);
      if (request !== captionRequestRef.current) return;
      const source: CaptionProvenance = {
        sourceKey, language, origin: "video", actualLanguage: fetched.language,
      };
      captionDraftsRef.current.set(captionCacheKey(actualUrl, language), {
        raw: fetched.text, fileName: "", source,
      });
      if (fromDifferentVideo) manuallyEditedTitleRef.current = false;
      setRaw(fetched.text);
      setCaptionSource(source);
      setFileName("");
      setSourceUrl(actualUrl);
      if (videoTitle && !manuallyEditedTitleRef.current) setTitle(videoTitle);
      else if (fromDifferentVideo) setTitle("");
      setSubtitleStatus(subtitleMessage(subtitleUi.success, {
        count: parsed.length, language: fetched.language,
      }));
    } catch (cause) {
      if (request !== captionRequestRef.current) return;
      const message = cause instanceof Error ? cause.message : subtitleUi.unavailable;
      if (attemptedUrl && needsVideoReaderReload(message)) setVideoRecoveryUrl(attemptedUrl);
      setSubtitleStatus(message);
    } finally {
      if (request === captionRequestRef.current) setSubtitleBusy(false);
    }
  }

  async function reloadVideoReader(): Promise<void> {
    if (!videoRecoveryUrl || reloadingVideoTab || subtitleBusy || metadataBusy) return;
    setReloadingVideoTab(true);
    setError("");
    try {
      await reloadExistingVideoTab(getVideoAdapter(videoRecoveryUrl), videoRecoveryUrl);
      setVideoRecoveryUrl("");
      setMetadataStatus("");
      setSubtitleStatus(subtitleUi.reloadedTab);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : subtitleUi.reloadFailed);
    } finally {
      setReloadingVideoTab(false);
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 2_000_000) { setError(t("errorFileSize")); return; }
    ++metadataRequestRef.current;
    setMetadataBusy(false);
    setMetadataStatus("");
    const request = ++captionRequestRef.current;
    setSubtitleBusy(false);
    const text = await file.text();
    if (request !== captionRequestRef.current) return;
    const source: CaptionProvenance = {
      origin: "manual", sourceKey: videoSourceKey(sourceUrl), language: profile.targetLanguage,
    };
    captionDraftsRef.current.set(captionCacheKey(sourceUrl, profile.targetLanguage), {
      raw: text, fileName: file.name, source,
    });
    setRaw(text);
    setCaptionSource(source);
    setFileName(file.name);
    setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageReady, {
      language: learningLanguageName(profile.targetLanguage, uiLocale),
    }));
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

  const levelOptions = levelsForTargetLanguage(profile.targetLanguage);

  const filteredJobs = jobs.filter(job => jobFilter === "completed"
    ? job.status === "completed" : jobFilter === "active" ? job.status !== "completed" : true);
  const visibleJobs = showAllJobs ? filteredJobs : jobFilter === "all"
    ? [...filteredJobs.filter(job => job.status !== "completed"),
      ...filteredJobs.filter(job => job.status === "completed").slice(0, 3)]
    : filteredJobs.slice(0, 3);
  const activeJob = jobs.find(job => job.id === lastJobIdRef.current);
  const lessonCatalog = useMemo(() => {
    const entries = new Map<string, LessonEntry>();
    for (const local of localLessons) entries.set(local.documentId, {
      documentId: local.documentId, title: local.title, createdAt: local.createdAt, local,
    });
    for (const drive of cloudLessons) {
      const previous = entries.get(drive.documentId);
      entries.set(drive.documentId, previous
        ? { ...previous, drive } : {
          documentId: drive.documentId, title: drive.title, createdAt: drive.createdAt, drive,
        });
    }
    return [...entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [localLessons, cloudLessons]);
  const visibleLessons = lessonCatalog.filter(item => lessonFilter === "local"
    ? !!item.local : lessonFilter === "drive" ? !!item.drive : true);

  useEffect(() => {
    if (page === "lessons") void loadLessons();
  }, [page, backup.accountId, driveAccounts.length]);

  return (
    <div className="mx-auto min-w-[320px] max-w-[780px] px-3 pb-9 leading-[1.55] antialiased font-[Outfit,'Noto_Sans_TC',-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] [color-scheme:light] dark:[color-scheme:dark] [font-synthesis:none]">
      <header className="flex items-center justify-between gap-2 py-[18px] [&>div]:flex [&>div]:min-w-0 [&>div]:items-center [&>div]:gap-[9px] [&_strong]:min-w-0 [&_strong]:text-xs [&_strong]:leading-[1.25] [&_strong]:wrap-anywhere">
        <div><img className="block size-9 shrink-0 rounded-[var(--radius)] object-contain" src={chrome.runtime.getURL("icons/icon48.png")} alt="" /><strong>AI-powered Contextual Language Learning</strong></div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">MVP · v0.1</span>
      </header>
      <nav className="mb-4 grid grid-cols-4 gap-1 rounded-[var(--radius)] bg-muted p-1" aria-label={t("navLabel")}>
        <Button className={page === "create" ? "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent bg-card! text-foreground! shadow-[0_1px_4px_#0001]!" : "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent"} aria-current={page === "create" ? "page" : undefined} onClick={() => setPage("create")}><WandSparkles aria-hidden="true" />{t("create")}</Button>
        <Button className={page === "reader" ? "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent bg-card! text-foreground! shadow-[0_1px_4px_#0001]!" : "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent"} aria-current={page === "reader" ? "page" : undefined} onClick={() => setPage("reader")}><BookOpen aria-hidden="true" />{t("reader")}</Button>
        <Button className={page === "lessons" ? "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent bg-card! text-foreground! shadow-[0_1px_4px_#0001]!" : "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent"} aria-current={page === "lessons" ? "page" : undefined} onClick={() => setPage("lessons")}><Library aria-hidden="true" />{t("lessonLibrary")}</Button>
        <Button className={page === "settings" ? "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent bg-card! text-foreground! shadow-[0_1px_4px_#0001]!" : "h-auto min-w-0 rounded-[calc(var(--radius)-4px)] gap-[3px] bg-transparent px-px py-2 text-[11px] text-muted-foreground shadow-none [&_svg]:size-[14px] hover:bg-transparent"} aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")}><Settings2 aria-hidden="true" />{t("settings")}</Button>
      </nav>

      {error && <div className="my-[10px] flex max-w-full min-w-0 justify-between gap-[10px] rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--destructive)_55%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_10%,var(--card))] px-3 py-[10px] text-xs text-foreground wrap-anywhere [&_button]:shrink-0" role="alert">{error}<Button variant="ghost" size="icon" aria-label={t("closeError")} onClick={() => setError("")}><X aria-hidden="true" /></Button></div>}

      {page === "create" && <main>
        <AppPanel>
          <h2>{t("subtitleHeading")}</h2>
          <div className="mb-[10px] min-w-0 border-b border-border pb-3 [&>label]:my-2 [&>.actions]:mt-0 [&>.actions]:mb-[7px] [&_[data-ui=chip]]:mt-[6px]">
          <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
            <Button variant={!title.trim() || !sourceUrl.trim() ? "default" : "outline"}
              size="sm" disabled={metadataBusy || subtitleBusy || checking || generating}
              onClick={() => void fetchCurrentVideoMetadata()}>
              {metadataBusy ? metadataUi.busy :
                !title.trim() || !sourceUrl.trim() ? metadataUi.get : metadataUi.refresh}
            </Button>
          </div>
          {metadataStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{metadataStatus}</p>}
          <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("videoTitle")} <Input value={title} onChange={event => {
            ++metadataRequestRef.current;
            setMetadataBusy(false);
            manuallyEditedTitleRef.current = !!event.target.value.trim();
            setMetadataStatus("");
            setTitle(event.target.value);
          }} placeholder={t("titlePlaceholder")} /></label>
          <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("videoUrl")} <Input type="url" value={sourceUrl} onChange={event => {
            ++metadataRequestRef.current;
            setMetadataBusy(false);
            setMetadataStatus("");
            ++captionRequestRef.current;
            setSubtitleBusy(false);
            setSourceUrl(event.target.value);
            setSubtitleStatus("");
          }} placeholder="https://www.youtube.com/watch?v=…" /></label>
          <Badge data-ui="chip">{t("source", { name: getVideoAdapter(sourceUrl).id === "import" ? t("providerImport") : getVideoAdapter(sourceUrl).label })}</Badge>
          </div>
          <div className="my-[6px_12px] min-w-0 [&_[data-ui=settingField]]:m-0">
            <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
              <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="learning-target">{t("targetLanguage")}</label>
                <SettingInfo label={t("targetLanguage")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.targetLanguage}
                  />
              </div>
              <SelectField id="learning-target" ariaLabel={t("targetLanguage")}
                value={profile.targetLanguage} onValueChange={chooseLearningLanguage} disabled={checking || generating} options={LEARNING_LANGUAGES.map(language => ({
                  value: language, label: learningLanguageName(language, uiLocale),
                }))} />
            </div>
          </div>
          {(subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && <>
            <Button className="h-9 min-w-0 px-3 text-center text-sm font-semibold leading-[1.4] whitespace-normal wrap-anywhere"
              disabled={subtitleBusy || metadataBusy || checking || generating}
              onClick={() => void fetchCurrentSubtitles()}>
              {subtitleBusy ? subtitleUi.busy : subtitleUi.button}
            </Button>
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{subtitleUi.hint}</p>
            {videoRecoveryUrl && <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
              <Button variant="outline" size="sm"
                disabled={reloadingVideoTab || subtitleBusy || metadataBusy}
                onClick={() => void reloadVideoReader()}>
                {reloadingVideoTab ? subtitleUi.reloadingTab : subtitleUi.reloadTab}
              </Button>
            </div>}
          </>}
          <details className="[&_p]:text-muted-foreground my-2 rounded-[var(--radius)] border border-border p-[10px] text-[13px] [&_p]:mb-[2px]" open={subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube"}>
            <summary className="cursor-pointer font-semibold">{subtitleUi.manual}</summary>
            {subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube" && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("subtitleHint")}</p>}
            <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("subtitleFile")} <Input type="file" className="h-auto min-h-10 p-[7px] text-xs" accept=".srt,.vtt,.txt,text/plain" onChange={event => void onFile(event.target.files?.[0])} /></label>
            {fileName && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("importedFile", { name: fileName })}</p>}
            <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("pasteSubtitles")} <Textarea className="resize-y" rows={5} value={raw} onChange={event => {
              ++metadataRequestRef.current;
              setMetadataBusy(false);
              setMetadataStatus("");
              ++captionRequestRef.current;
              setSubtitleBusy(false);
              const source: CaptionProvenance = {
                origin: "manual", sourceKey: videoSourceKey(sourceUrl), language: profile.targetLanguage,
              };
              setRaw(event.target.value);
              setCaptionSource(event.target.value.trim() ? source : null);
              setFileName("");
              if (event.target.value.trim()) captionDraftsRef.current.set(
                captionCacheKey(sourceUrl, profile.targetLanguage),
                { raw: event.target.value, fileName: "", source },
              );
              setSubtitleStatus(event.target.value.trim()
                ? subtitleMessage(subtitleUi.manualLanguageReady, {
                    language: learningLanguageName(profile.targetLanguage, uiLocale),
                  }) : "");
            }}
              placeholder={t("subtitlePlaceholder")} /></label>
          </details>
          {subtitleStatus && <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere my-[10px] leading-[1.5]" role="status">{subtitleStatus}</p>}
          {!!raw.trim() && !captionsReady && !subtitleStatus && !subtitleBusy &&
            <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere my-[10px] leading-[1.5]" role="status">{subtitleMessage(subtitleUi.languageNotReady, {
              language: learningLanguageName(profile.targetLanguage, uiLocale),
            })}</p>}
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("parsedCues", { count: cues.length })}</p>

        </AppPanel>

        <AppPanel className="[&_[data-ui=settingField]]:my-[13px] [&_[data-ui=hint]]:my-[4px_9px] [&_[data-ui=settingField]_[data-slot=select-trigger]]:min-h-[38px] [&_[data-ui=settingField]_[data-slot=select-trigger]]:w-full [&_[data-ui=advancedLessonSettings]]:mt-4">
          <h2>{t("learningHeading")}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground mt-[2px]! mb-3!" data-ui="hint">{t("lessonSettingsIntro")}</p>
          <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="learning-level">{t("level")}</label>
              <SettingInfo label={t("level")} infoLabel={settingsCopy.infoLabel}
                explanation={levelHint(settingsCopy, profile.targetLanguage)}
                items={levelOptions.map(value => {
                  const info = settingsCopy.levels[profile.targetLanguage][value];
                  return { value, label: info?.label ?? value, description: info?.description ?? "" };
                })} />
            </div>
            <SelectField id="learning-level" ariaLabel={t("level")} value={profile.level}
              onValueChange={level => setProfile(current => ({ ...current, level }))}
              options={levelOptions.map(level => ({
                value: level, label: level + " · " + (settingsCopy.levels[profile.targetLanguage][level]?.label ?? level),
              }))} />
          </div>
          <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="learning-length">{t("lessonLength")}</label>
              <SettingInfo label={t("lessonLength")} infoLabel={settingsCopy.infoLabel}
                explanation={t("lessonLengthHint")} />
            </div>
            <SelectField id="learning-length" ariaLabel={t("lessonLength")}
              value={String(profile.sceneCount)}
              onValueChange={value => setProfile(current => contextualGenerationProfile({
                ...current, sceneCount: Number(value),
              }))}
              options={[
                { value: "2", label: t("lessonLengthShort") },
                { value: "4", label: t("lessonLengthStandard") },
                { value: "6", label: t("lessonLengthRich") },
              ]} />
          </div>
          <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="contextual-examples">{t("contextualExamples")}</label>
              <SettingInfo label={t("contextualExamples")} infoLabel={settingsCopy.infoLabel}
                explanation={t("contextualExamplesHint")} />
            </div>
            <SelectField id="contextual-examples" ariaLabel={t("contextualExamples")}
              value={String(profile.contextualExampleCount ?? 2)}
              onValueChange={value => setProfile(current => ({
                ...current, contextualExampleCount: Number(value),
              }))}
              options={[1, 2, 3].map(value => ({
                value: String(value), label: t("contextualExamplesValue", { count: value }),
              }))} />
          </div>
          <details className="my-[8px_12px] rounded-[var(--radius)] border border-border p-[10px] text-[13px] [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:text-xs [&>summary]:text-muted-foreground" data-ui="advancedLessonSettings">
            <summary className="cursor-pointer font-semibold">{t("advancedLessonSettings")}</summary>
            <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
              <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="learning-explanation-language">{t("instructionLanguage")}</label>
                <SettingInfo label={t("instructionLanguage")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.instructionLanguage} />
              </div>
              <SelectField id="learning-explanation-language" ariaLabel={t("instructionLanguage")}
                value={explanationLanguageMode === "auto" ? "__auto__" : profile.instructionLanguage}
                onValueChange={value => {
                  if (value === "__auto__") {
                    setExplanationLanguageMode("auto");
                    setProfile(current => ({ ...current, instructionLanguage: uiLocale }));
                  } else {
                    setExplanationLanguageMode("custom");
                    setProfile(current => ({
                      ...current, instructionLanguage: value as LearningProfile["instructionLanguage"],
                    }));
                  }
                }}
                options={[
                  { value: "__auto__", label: t("explanationAuto") },
                  ...EXPLANATION_LANGUAGES.map(value => ({
                    value, label: explanationLanguageName(value, uiLocale),
                  })),
                ]} />
            </div>
          </details>
        </AppPanel>

        <AppPanel>
          <h2>{t("generationHeading")}</h2>
          <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("storageLocation")}</label>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("currentFolder", { path: destination.kind === "local"
            ? destination.directory ?? t("defaultFolder") : t("defaultFolder") })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
            <Button variant="outline" disabled={storageBusy || generating}
              onClick={() => void chooseFolder()}>{t("chooseFolder")}</Button>
            {destination.kind === "local" && destination.directory && <Button variant="ghost" size="sm"
              onClick={() => setDestination({ kind: "local" })}>{t("useDefaultFolder")}</Button>}
          </div>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("localAlways")}</p>
          <div className="my-[12px_4px] flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px] [&_[data-ui=hint]]:mt-1 [&_[data-ui=hint]]:mb-0">
              <strong>{t("autoBackup")}</strong>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupHint")}</p>
            </div>
            <Button role="switch" aria-checked={backup.enabled} aria-label={t("autoBackup")}
              className="group relative inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0" disabled={storageBusy}
              onClick={() => backup.enabled ? setBackup(current => ({ ...current, enabled: false }))
                : void enableBackup()}><span aria-hidden="true" className="relative block h-[22px] w-[38px] shrink-0 rounded-full bg-muted-foreground transition-colors duration-200 group-aria-checked:bg-primary motion-reduce:transition-none"><span className="absolute top-[3px] left-[3px] block size-4 rounded-full bg-white shadow-[0_1px_3px_#0003] transition-transform duration-200 group-aria-checked:translate-x-4 motion-reduce:transition-none" /></span></Button>
          </div>
          {backup.enabled && driveAccessVerified && <div className="flex items-center justify-between gap-2 [&_[data-ui=hint]]:my-[3px] [&_[data-ui=hint]]:min-w-0 [&_[data-ui=hint]]:wrap-anywhere">
            <span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupConnected", { email:
              driveAccounts.find(account => account.id === backup.accountId)?.email ?? t("backupUnknownAccount") })}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage("settings")}>{t("manageDrive")}</Button>
          </div>}
          {!backup.enabled && !driveAccounts.length && driveConfigured &&
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupConnectToEnable")}</p>}
          {driveConnectError && <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">{driveConnectError}</p>}
          {backupStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{backupStatus}</p>}
          {duplicateWarning && <div className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere" role="alertdialog" aria-label={t("duplicateConfirmLabel")}>
            <strong>{t("duplicateFound", { count: duplicateWarning.matches.length })}</strong>
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("duplicateNewVersion")}</p>
            {duplicateWarning.matches.map(match => <div className="mb-2 min-w-0 max-w-full rounded-[var(--radius)] border border-border p-3 text-[13px] wrap-anywhere [&_strong]:mr-2 [&_strong]:text-primary [&_p]:mt-[6px] [&_p]:text-xs [&_p]:text-muted-foreground" key={match.documentId}>
              <strong>{match.title}</strong>
              <p>{new Date(match.createdAt).toLocaleString(uiLocale)} · {match.destination} · {t(match.exactSettings ? "sameSettings" : "differentSettings")}{match.jobStatus ? " · " + match.jobStatus : ""}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                {match.local && <Button variant="outline" size="sm" onClick={() => {
                  cancelDuplicate();
                  openSavedDocument(match.documentId);
                }}>{t("openExisting")}</Button>}
                {match.url && <Button variant="outline" size="sm" onClick={() => void chrome.tabs.create({ url: match.url })}>{t("openInDrive")}</Button>}
              </div>
            </div>)}
            <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
              <Button variant="destructive" size="sm" onClick={confirmRegeneration}>{t("confirmNewVersion")}</Button>
              <Button variant="outline" size="sm" onClick={cancelDuplicate}>{t("cancelNoGeneration")}</Button>
            </div>
          </div>}
          <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere mt-[5px] mb-[14px]">{t("lessonContentSummary", {
            scenes: profile.sceneCount, examples: profile.contextualExampleCount ?? 2,
          })}</p>
          <div className="my-3 min-w-0 rounded-[var(--radius)] border border-border bg-muted p-3 [&_dl]:mt-[10px] [&_dl]:grid [&_dl]:gap-2 [&_dl>div]:grid [&_dl>div]:grid-cols-[minmax(50px,auto)_minmax(0,1fr)] [&_dl>div]:items-start [&_dl>div]:gap-[10px] [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-right [&_dd]:text-xs [&_dd]:font-semibold [&_dd]:wrap-anywhere">
            <div className="flex flex-wrap items-center justify-between gap-2 [&>strong]:text-xs">
              <strong>{t("generationSummary")}</strong>
              <Button variant="outline" size="sm" onClick={() => {
                setPage("settings");
                window.requestAnimationFrame(() => {
                  const heading = window.document.getElementById("agent-settings-heading");
                  heading?.scrollIntoView({ block: "start" });
                  heading?.focus({ preventScroll: true });
                });
              }}>{t("editAgentModel")}</Button>
            </div>
            <dl>
              <div><dt>{t("generationAgentLabel")}</dt><dd>{agentDisplayName(agent.provider, selectedAgentInfo?.label)}</dd></div>
              {agent.accountConfigDir && <div><dt>{t("agentAccount")}</dt>
                <dd title={agent.accountConfigDir}>{selectedSavedProfile?.label ?? t("accountLegacy", { path: agent.accountConfigDir })}</dd>
              </div>}
              <div><dt>{t("generationModelLabel")}</dt>
                <dd title={agent.modelId || undefined}>{modelDisplayName(agent.modelId, modelOptions, t("cliDefault"))}</dd>
              </div>
            </dl>
          </div>
          <Button className="h-auto min-h-10 w-full px-4 py-[9px] text-center text-sm font-semibold leading-[1.4] whitespace-normal wrap-anywhere" onClick={startGeneration} disabled={generating || checking || subtitleBusy || !captionsReady || !cues.length || !title.trim()}>
            {(generating || checking) && <span className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
            {generating ? t("generating") : checking ? t("checkingExistingShort") : t("checkThenGenerate")}
          </Button>
          {generating && activeJob && <div className="my-[10px_5px] h-[5px] overflow-hidden rounded-full bg-muted [&>span]:block [&>span]:h-full [&>span]:rounded-[inherit] [&>span]:bg-primary [&>span]:transition-[width] [&>span]:duration-200 motion-reduce:[&>span]:transition-none" role="progressbar"
            aria-label={t("generationProgressLabel")} aria-valuemin={0}
            aria-valuenow={activeJob.completed} aria-valuemax={activeJob.total}>
            <span style={{ width: (100 * activeJob.completed / activeJob.total) + "%" }} />
          </div>}
          {generating && <Button variant="outline" onClick={cancelGeneration}>{t("cancelGeneration")}</Button>}
          {progress && <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere" role="status">{progress}</p>}
          {publishedLocation && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("publishedTo", { location: publishedLocation })}</p>}
        </AppPanel>
        <AppPanel>
          <h2>{t("jobHistory")}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("jobHistoryHint")}</p>
          <div className="flex items-center justify-between gap-2 [&>[data-slot=select-trigger]]:min-w-0 [&>[data-slot=select-trigger]]:flex-1">
            <SelectField ariaLabel={t("jobFilterLabel")} value={jobFilter}
              onValueChange={value => {
                if (value === "all" || value === "active" || value === "completed") setJobFilter(value);
                setShowAllJobs(false);
              }} options={[
                { value: "all", label: t("jobFilterAll") },
                { value: "active", label: t("jobFilterActive") },
                { value: "completed", label: t("jobFilterCompleted") },
              ]} />
            <Button variant="outline" size="sm" disabled={loadingJobs} aria-busy={loadingJobs}
              onClick={loadJobs}>{loadingJobs && <span aria-hidden="true" className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}{t("refreshJobs")}</Button>
          </div>
          <div className="my-[10px] grid gap-[7px]">
            {visibleJobs.map(job => <div className="min-w-0 rounded-[var(--radius)] border border-border px-[11px] py-[9px] [&_p]:my-[3px] [&_p]:text-[11px] [&_[data-ui=actions]]:mt-[5px] [&_[data-ui=actions]]:gap-[5px] [&_[data-ui=actions]_button]:h-auto [&_[data-ui=actions]_button]:min-h-7" key={job.id}>
              <div className="flex min-w-0 items-center justify-between gap-2 [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-xs">
                <strong className="min-w-0 flex-1 truncate" title={job.sourceTitle}>{job.sourceTitle}</strong>
                <Badge className="shrink-0 whitespace-nowrap text-[11px] leading-4">{t(jobStatusKeys[job.status])}</Badge>
              </div>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{agentDisplayName(job.provider, agentCatalog.find(item => item.id === job.provider)?.label)} · {job.completed}/{job.total}
                {job.backup && " · " + t(job.backup.status === "backed-up"
                  ? "backupSaved" : ["pending", "uploading"].includes(job.backup.status)
                    ? "backupProcessing" : "backupFailedMessage")}</p>
              {job.error && <p className="my-[5px] text-[11px] text-destructive wrap-anywhere">{job.error}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                {["queued", "waiting", "failed"].includes(job.status) &&
                  <Button variant="outline" size="sm" disabled={generating}
                    onClick={() => runGeneration({ type: "resume", jobId: job.id })}>{t("resume")}</Button>}
                {job.documentId && <>
                  <Button variant="outline" size="sm" disabled={generating}
                    onClick={() => openSavedDocument(job.documentId!)}>{t("openLesson")}</Button>
                  {job.publication?.status !== "published" &&
                    <Button variant="outline" size="sm" disabled={storageBusy}
                      onClick={() => void retryPublication(job.id)}>{t("retryPublish")}</Button>}
                  {job.backup && ["failed", "conflict"].includes(job.backup.status) &&
                    <Button variant="outline" size="sm" disabled={storageBusy}
                      onClick={() => void retryBackup(job.id)}>{t("retryBackup")}</Button>}
                </>}
              </div>
            </div>)}
          </div>
          {filteredJobs.length > visibleJobs.length && <Button variant="ghost" size="sm"
            onClick={() => setShowAllJobs(true)}>{t("showMoreJobs", { count: filteredJobs.length - visibleJobs.length })}</Button>}
          {showAllJobs && filteredJobs.length > 3 && <Button variant="ghost" size="sm"
            onClick={() => setShowAllJobs(false)}>{t("showLessJobs")}</Button>}
        </AppPanel>
      </main>}

      {page === "lessons" && <main>
        <AppPanel>
          <h2>{t("lessonLibrary")}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("lessonLibraryHint")}</p>
          <div className="flex items-center justify-between gap-2 [&>[data-slot=select-trigger]]:min-w-0 [&>[data-slot=select-trigger]]:flex-1">
            <SelectField ariaLabel={t("lessonFilterLabel")} value={lessonFilter}
              onValueChange={value => {
                if (value === "all" || value === "local" || value === "drive") setLessonFilter(value);
              }} options={[
                { value: "all", label: t("lessonFilterAll") },
                { value: "local", label: t("lessonFilterLocal") },
                { value: "drive", label: t("lessonFilterDrive") },
              ]} />
            <Button variant="outline" size="sm" disabled={lessonsBusy}
              onClick={() => void loadLessons()}>{lessonsBusy ? t("loading") : t("refreshJobs")}</Button>
          </div>
          {catalogError && <div className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere" role="alert">
            <p>{catalogError}</p>
            <Button variant="outline" size="sm" disabled={lessonsBusy}
              onClick={() => void loadLessons()}>{t("refreshJobs")}</Button>
          </div>}
          {lessonFilter === "drive" && !driveAccounts.length && <div className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere">
            <p>{t("connectDriveToBrowse")}</p>
            <Button variant="outline" size="sm" disabled={storageBusy || !driveConfigured}
              onClick={() => void connectDrive()}>{t("connectGoogle")}</Button>
          </div>}
          {!lessonsBusy && !catalogError && visibleLessons.length === 0 &&
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("lessonLibraryEmpty")}</p>}
          <div className="mt-3 grid gap-2">
            {visibleLessons.map(lesson => <div className="min-w-0 rounded-[var(--radius)] border border-border px-[11px] py-[9px] [&_p]:my-[3px] [&_p]:text-[11px] [&_[data-ui=actions]]:mt-[5px] [&_[data-ui=actions]]:gap-[5px] [&_[data-ui=actions]_button]:h-auto [&_[data-ui=actions]_button]:min-h-7" key={lesson.documentId}>
              <div className="flex min-w-0 items-center justify-between gap-2 [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-xs"><strong title={lesson.title}>{lesson.title}</strong></div>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{new Date(lesson.createdAt).toLocaleString(uiLocale)}
                {lesson.local && " · " + lesson.local.targetLanguage.toUpperCase() + " · " + lesson.local.level}</p>
              <div className="flex flex-wrap items-center gap-[6px] [&_[data-ui=hint]]:m-0">
                {lesson.local && <Badge>{t("localCopy")}</Badge>}
                {lesson.drive && <Badge>{t("cloudCopy")}</Badge>}
                {lesson.local?.backup && !lesson.drive &&
                  <span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t(lesson.local.backup.status === "backed-up"
                    ? "backupSaved" : ["pending", "uploading"].includes(lesson.local.backup.status)
                      ? "backupProcessing" : "backupFailedMessage")}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                {lesson.local && <Button variant="outline" size="sm" disabled={generating}
                  onClick={() => openSavedDocument(lesson.documentId)}>{t("openLesson")}</Button>}
                {lesson.drive && !lesson.local && <Button variant="outline" size="sm"
                  disabled={restoreBusy !== null || generating}
                  onClick={() => void restoreLesson(lesson.drive!)}>{restoreBusy === lesson.documentId
                    ? t("restoringLesson") : t("restoreLesson")}</Button>}
                {lesson.drive && <Button variant="ghost" size="sm"
                  onClick={() => void chrome.tabs.create({ url: lesson.drive!.url })}>{t("openInDrive")}</Button>}
              </div>
            </div>)}
          </div>
        </AppPanel>
      </main>}

      {page === "settings" && <main>
        <AppPanel>
          <h2>{t("uiLanguage")} · {t("appearance")}</h2>
          <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="ui-language-select">{t("uiLanguage")}</label>
              <SettingInfo label={t("uiLanguage")} infoLabel={settingsCopy.infoLabel}
                explanation={t("uiLanguageHint")} />
            </div>
            <Select value={localePreference} onValueChange={next => {
              if (isLocalePreference(next)) setLocalePreference(next);
            }}>
              <SelectTrigger id="ui-language-select" aria-label={t("uiLanguage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("browserLanguage")} · {nativeLanguageName(browserLocale)}</SelectItem>
                <SelectItem value="en">{nativeLanguageName("en")}</SelectItem>
                <SelectItem value="zh-TW">{nativeLanguageName("zh-TW")}</SelectItem>
                <SelectItem value="zh-CN">{nativeLanguageName("zh-CN")}</SelectItem>
                <SelectItem value="ja">{nativeLanguageName("ja")}</SelectItem>
                <SelectItem value="ko">{nativeLanguageName("ko")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="appearance-select">{t("appearance")}</label>
              <SettingInfo label={t("appearance")} infoLabel={settingsCopy.infoLabel}
                explanation={t("appearanceHint")} />
            </div>
            <Select value={themePreference} onValueChange={next => {
              if (isThemePreference(next)) setThemePreference(next);
            }}>
              <SelectTrigger id="appearance-select" aria-label={t("appearance")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("themeSystem")}</SelectItem>
                <SelectItem value="light">{t("themeLight")}</SelectItem>
                <SelectItem value="dark">{t("themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </AppPanel>
        <AppPanel>
          <h2 id="agent-settings-heading" tabIndex={-1}>{t("agentHeading")}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("agentHint")}</p>
          {installed && <Badge>{t(installed[agent.provider] ? "agentInstalled" : "agentMissing")}</Badge>}
          {installed && hostVersion !== chrome.runtime.getManifest().version && <div className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere" role="status">
            <p>{hostVersion ? t("hostVersionMismatch", { version: hostVersion,
              expected: chrome.runtime.getManifest().version }) : t("hostVersionUnknown")}</p>
            <Button variant="outline" size="sm"
              onClick={() => void chrome.tabs.create({
                url: "https://github.com/chenghsj/immersive-language-learning/releases",
              })}>{t("hostUpdateDownload")}</Button>
          </div>}
          <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("defaultAgent")}
            <SelectField ariaLabel={t("defaultAgent")} value={agent.provider}
              onValueChange={selectAgent}
              options={agentCatalog.map(entry => ({
                value: entry.id,
                label: agentDisplayName(entry.id, entry.label) +
                  (installed && !entry.installed ? t("agentNotInstalled") : ""),
              }))} />
          </label>
          {selectedAgentInfo?.supportsAccountProfiles && <section className="mt-3 border-t border-border pt-[10px]">
            <div className="relative flex min-w-0 items-center gap-2 text-xs">
              <strong>{t("useOtherCliAccount")}</strong>
              <SettingInfo label={t("useOtherCliAccount")} infoLabel={settingsCopy.infoLabel}
                explanation={t("agentProfileInfo")} />
            </div>
            {(savedAgentProfiles.some(item => item.provider === agent.provider) || !!agent.accountConfigDir) &&
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("agentAccount")}
                <SelectField ariaLabel={t("agentAccount")}
                  value={selectedSavedProfile?.id ?? (agent.accountConfigDir ? "__legacy__" : "")}
                  onValueChange={chooseAgentProfile}
                  options={[
                    { value: "", label: t("accountDefault") },
                    ...(agent.accountConfigDir && !selectedSavedProfile
                      ? [{ value: "__legacy__", label: t("accountLegacy", { path: agent.accountConfigDir }) }] : []),
                    ...savedAgentProfiles.filter(item => item.provider === agent.provider)
                      .map(item => ({ value: item.id, label: item.label })),
                  ]} />
              </label>}
            <details className="mt-[10px] rounded-[var(--radius)] border border-border px-[11px] py-[10px] text-xs [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:font-semibold" data-ui="agentProfileAdvanced">
              <summary className="cursor-pointer font-semibold">{t("manageAgentProfiles")}</summary>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("accountFolderHint")}</p>
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("profileName")}
                <Input value={draftProfileName} onChange={event => setDraftProfileName(event.target.value)}
                  placeholder={t("profileNamePlaceholder")} />
              </label>
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("accountFolder")}
                <Input value={draftProfileDir} onChange={event => setDraftProfileDir(event.target.value)}
                  placeholder={t("accountFolderPlaceholder")} />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                <Button variant="outline" size="sm"
                  disabled={profileBusy || installed === null || !draftProfileName.trim() || !draftProfileDir.trim()}
                  onClick={() => void saveProfile()}>{t("saveProfile")}</Button>
                {selectedSavedProfile && <Button variant="outline" size="sm"
                  disabled={profileBusy || installed === null}
                  onClick={() => void removeProfile()}>{t("removeProfile")}</Button>}
              </div>
              {profileStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{profileStatus}</p>}
            </details>
          </section>}
          <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("defaultModel")}
            <SelectField ariaLabel={t("defaultModel")} disabled={modelBusy} value={modelSelection}
              onValueChange={value => {
                if (value === "__custom__") {
                  setCustomModelMode(true);
                  updateAgent({ ...agent, modelId: "" });
                } else {
                  setCustomModelMode(false);
                  updateAgent({ ...agent, modelId: value });
                }
              }}
              options={[
                { value: "", label: t("cliDefault") },
                ...modelOptions.map(model => ({
                  value: model.id,
                  label: model.label === model.id ? model.id : model.label + " · " + model.id,
                })),
                { value: "__custom__", label: t("customModel") },
              ]} />
          </label>
          {modelSelection === "__custom__" && <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("modelId")}
            <Input value={agent.modelId} onChange={event => updateAgent({ ...agent, modelId: event.target.value })}
              placeholder={t("modelPlaceholder")} />
          </label>}
          {modelNotice && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{modelNotice}</p>}
          <details className="mt-[10px] rounded-[var(--radius)] border border-border px-[11px] py-[10px] text-xs [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:font-semibold" data-ui="agentProfileAdvanced">
            <summary className="cursor-pointer font-semibold">{t("agentDiagnostics")}</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
              <Button variant="outline" size="sm" disabled={hostBusy} aria-busy={hostBusy} onClick={checkHost}>{hostBusy && <span aria-hidden="true" className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}{t("checkHost")}</Button>
              <Button variant="outline" size="sm" disabled={modelBusy || installed === null}
                onClick={() => setInstalled(current => current ? { ...current } : current)}>
                {modelBusy && <span aria-hidden="true" className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />}{t("refreshModels")}
              </Button>
            </div>
          </details>
          <CustomAgentSettings locale={uiLocale} available={installed !== null}
            selectedProvider={agent.provider} selectedModelId={agent.modelId}
            selectedProfileDir={agent.accountConfigDir} nativeOnce={nativeOnce}
            onSaved={provider => { checkHost(); selectAgent(provider); }}
            onRemoved={provider => {
              if (agent.provider === provider) selectAgent("claude");
              checkHost();
            }} />
        </AppPanel>
        <AppPanel>
          <h2>{t("driveAccountHeading")}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("driveOauthHelp")}</p>
          {!driveConfigured && <p className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere">{t("oauthFirst")}</p>}
          {driveAccounts.length === 1 && <div className="my-3 flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius)] border border-border px-[11px] py-[10px] [&>div]:min-w-0 [&_strong]:block [&_strong]:text-xs [&_strong]:wrap-anywhere [&_[data-ui=hint]]:mt-[2px] [&_[data-ui=hint]]:mb-0 [&_[data-ui=hint]]:block">
            <div><strong>{driveAccounts[0].email}</strong><span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupAccount")}</span></div>
            <Badge>{t("driveConnectedStatus")}</Badge>
          </div>}
          {driveAccounts.length > 1 && <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("backupAccount")}
            <SelectField ariaLabel={t("backupAccount")} value={backup.accountId ?? driveAccounts[0].id}
              onValueChange={accountId => setBackup(current => ({ ...current, accountId }))}
              options={driveAccounts.map(account => ({ value: account.id, label: account.email }))} />
          </label>}
          {selectedDriveId && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{
            driveAccess?.accountId === selectedDriveId && driveAccess.status === "checking"
              ? t("driveAccessChecking") : driveAccessVerified
                ? t("driveAccessVerified") : t("driveAccessNotVerified")
          }</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
            <Button variant="outline" size="sm" disabled={storageBusy || !driveConfigured}
              onClick={() => void connectDrive()}>{driveAccounts.length ? t("connectAnother") : t("connectGoogle")}</Button>
            {selectedDriveId && !driveAccessVerified && <Button variant="outline" size="sm"
              disabled={storageBusy || driveAccess?.status === "checking"}
              onClick={() => void enableBackup()}>{t("retryDriveAccess")}</Button>}
          </div>
          {driveAccounts.length > 0 && <details className="mt-[10px] rounded-[var(--radius)] border border-border px-[11px] py-[10px] text-xs [&_p]:mb-[2px] [&_p]:text-muted-foreground [&>summary]:font-semibold" data-ui="agentProfileAdvanced">
            <summary className="cursor-pointer font-semibold">{t("manageDrive")} · {driveAccounts.length}</summary>
            <div className="mt-[10px] grid gap-[5px]">
              {driveAccounts.map(account => <div className="flex min-w-0 items-center justify-between gap-2 py-[5px] not-first:border-t not-first:border-border [&_span]:min-w-0 [&_span]:text-xs [&_span]:wrap-anywhere" key={account.id}>
                <span title={account.email}>{account.email}</span>
                <Button variant="ghost" size="sm" disabled={storageBusy}
                  onClick={() => void disconnectDrive(account.id)}>{t("disconnectGoogle")}</Button>
              </div>)}
            </div>
          </details>}
          {driveAccounts.length > 0 && <section className="mt-[14px] grid justify-items-start gap-1 border-t border-border pt-3 [&_strong]:text-xs [&_[data-ui=hint]]:mt-0 [&_[data-ui=hint]]:mb-[5px]">
            <strong>{t("backupExisting")}</strong>
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupExistingHint")}</p>
            <Button variant="outline" size="sm" disabled={storageBusy || !driveAccounts.length}
              onClick={() => void backupExistingLessons()}>{t("backupExisting")}</Button>
          </section>}
          {driveConnectError && <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">{driveConnectError}</p>}
          {backupStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{backupStatus}</p>}
        </AppPanel>
      </main>}

      {page === "reader" && <main>
        {!document ? <AppPanel className="px-[18px] py-8 text-center">
          <h2>{t("emptyHeading")}</h2><p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("emptyHint")}</p>
          <Button variant="outline" onClick={() => setPage("create")}>{t("create")}</Button>
        </AppPanel> : document.schemaVersion === 3 ? <ContextualSceneReader key={document.id}
          document={document} adapter={readerAdapter} locale={uiLocale}
          repeat={repeat} setRepeat={setRepeat} delay={delay} setDelay={setDelay}
          playbackRate={playbackRate} setPlaybackRate={setPlaybackRate}
          onError={setError} onDownload={format => downloadDocument(document, format)}
        /> : document.schemaVersion === 2 ? <SceneReader key={document.id}
          document={document} adapter={readerAdapter} locale={uiLocale}
          repeat={repeat} setRepeat={setRepeat} delay={delay} setDelay={setDelay}
          playbackRate={playbackRate} setPlaybackRate={setPlaybackRate}
          onError={setError} onDownload={format => downloadDocument(document, format)}
        /> : <>
          <AppPanel>
            <Badge data-ui="chip">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</Badge>
            <h1>{document.source.title}</h1>
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("lessonOverview", { count: document.sections.length, language: document.profile.instructionLanguage })}</p>
            {publishedLocation && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("publishedTo", { location: publishedLocation })}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
              <Button variant="outline" onClick={() => downloadDocument(document, "json")}>{t("saveJson")}</Button>
              <Button variant="outline" onClick={() => downloadDocument(document, "md")}>{t("saveMarkdown")}</Button>
            </div>
          </AppPanel>
          <AppPanel>
            <h2>{t("videoCompanion")}</h2>
            {document.source.url && readerAdapter.id !== "import" &&
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                <Button variant="outline" disabled={openingVideo}
                  onClick={() => void openVideo()}>
                  {openingVideo ? t("openingVideo") : t("openOrFocusVideo")}
                </Button>
              </div>}
            <div className="grid grid-cols-2 gap-[10px]">
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("repeatCount")}
                <SelectField ariaLabel={t("repeatCount")} value={repeat}
                  onValueChange={value => setRepeat(value as RepeatOption)}
                  options={[
                    { value: "2", label: t("repeatTwice") },
                    { value: "3", label: t("repeatThrice") },
                    { value: "5", label: t("repeatFive") },
                    { value: "infinite", label: t("repeatForever") },
                  ]} />
              </label>
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("repeatDelay")}
                <SelectField ariaLabel={t("repeatDelay")} value={delay}
                  onValueChange={value => setDelay(Number(value))}
                  options={[0, 1, 2, 3].map(seconds => ({
                    value: seconds, label: t("seconds", { count: seconds }),
                  }))} />
              </label>
            </div>
            {readerAdapter.setPlaybackRate && <div className="grid grid-cols-2 gap-[10px]">
              <label className="my-3 grid gap-[6px] text-xs font-semibold">{t("playbackRateLabel")}
                <SelectField ariaLabel={t("playbackRateLabel")} value={playbackRate} disabled={rateApplying}
                  onValueChange={value => setPlaybackRate(Number(value))}
                  options={[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(rate => ({
                    value: rate, label: rate + "×",
                  }))} />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions" style={{ alignSelf: "center" }}>
                <Button variant="outline" disabled={rateApplying}
                  onClick={() => void applyPlaybackRate()}>
                  {rateApplying ? t("applyingRate") : t("applyPlaybackRate")}
                </Button>
              </div>
            </div>}
            {readerAdapter.setPlaybackRate && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("ratePreferenceHint")}</p>}
            {readerAdapter.diagnose
              ? <div className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere">
                  {t("experimentalVideoHint", { name: readerAdapter.label })}
                  <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions"><Button variant="outline" onClick={() => void diagnoseVideo()}>{t("checkPlayer", { name: readerAdapter.label })}</Button></div>
                </div>
              : readerAdapter.loop
                ? <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("youtubeVideoHint", { name: readerAdapter.label })}</p>
                : <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("noVideoControl")}</p>}
            {playbackStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{playbackStatus}</p>}
            {loopActive && <Button variant="outline" onClick={() => void stopLoop()}>{t("stopLoop")}</Button>}
          </AppPanel>
          {document.sections.map(section => <AppPanel className="pt-5 [&>p]:text-[13px] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[13px] [&_li]:mb-[6px]" key={section.id}>
            <Badge data-ui="chip">{formatTime(section.startMs)}–{formatTime(section.endMs)}</Badge>
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
              return <div className="my-2 max-w-full min-w-0 rounded-[var(--radius)] border-l-[3px] border-primary bg-muted p-3 wrap-anywhere [&_p]:my-1 [&_p]:text-sm" key={id}>
                <span className="text-[11px] text-muted-foreground tabular-nums">{formatTime(cue.startMs)}</span>
                <p>{cue.originalText}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
                  {link && <Button variant="link" className="h-auto px-0 py-[2px] text-xs text-primary underline underline-offset-[3px] dark:text-primary" onClick={() => void openTimestampCue(cue)}>{t("openTimestamp")}</Button>}
                  {canSeek && <Button variant="link" className="h-auto px-0 py-[2px] text-xs text-primary underline underline-offset-[3px] dark:text-primary" onClick={() => void seekCue(cue)}>{t("seekTo")}</Button>}
                  {canLoop && <Button variant="link" className="h-auto px-0 py-[2px] text-xs text-primary underline underline-offset-[3px] dark:text-primary" onClick={() => void loopCue(cue)}>{t("loopSentence")}</Button>}
                  {!link && cue.startMs !== null && <Button variant="link" className="h-auto px-0 py-[2px] text-xs text-primary underline underline-offset-[3px] dark:text-primary" onClick={() => void navigator.clipboard.writeText(formatTime(cue.startMs))}>{t("copyTime")}</Button>}
                </div>
              </div>;
            })}
            {section.vocabulary.length > 0 && <><h3>{t("vocabulary")}</h3>
              {section.vocabulary.map((word, index) => <div className="mb-2 min-w-0 max-w-full rounded-[var(--radius)] border border-border p-3 text-[13px] wrap-anywhere [&_strong]:mr-2 [&_strong]:text-primary [&_p]:mt-[6px] [&_p]:text-xs [&_p]:text-muted-foreground" key={word.expression + index}>
                <strong>{word.expression}</strong><span>{word.meaning}</span>
                <p>{word.explanation}</p>{word.example && <p className="italic">{word.example}</p>}
              </div>)}</>}
            {section.insights.length > 0 && <><h3>{t("insights")}</h3><ul>{section.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul></>}
            {section.exercises.length > 0 && <><h3>{t("exercises")}</h3>
              {section.exercises.map((exercise, index) => <details className="[&_p]:text-muted-foreground my-2 rounded-[var(--radius)] border border-border p-[10px] text-[13px] [&_p]:mb-[2px]" key={index}><summary className="cursor-pointer font-semibold">{exercise.question}</summary><p>{exercise.answer}</p></details>)}</>}
          </AppPanel>)}
        </>}
      </main>}
    </div>
  );
}
