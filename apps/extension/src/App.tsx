import { subtitleLayoutCopy } from "./i18n/subtitle-layout";
import { usePlatformVideoNotice } from "./hooks/use-platform-video-notice";
import { HeaderActions } from "./components/header-actions";
import { PageSection } from "./components/page-section";
import { GenerationService } from "./components/generation-service";
import { GenerationStatus } from "./components/generation-status";
import { sidePanelLayoutCopy } from "./i18n/side-panel-layout";
import { settingsLayoutCopy } from "./i18n/settings-layout";
import { NotificationSettings } from "./components/notification-settings";
import { ArrowLeft, ChevronRight, Check, LoaderCircle } from "lucide-react";
import { piFeedback } from "./i18n/pi-feedback";
import { SubtitleImport } from "./components/subtitle-import";
import { shouldFollowSelectedVideo } from "./video/draft-navigation";
import { Switch } from "./components/ui/switch";
import { Progress } from "./components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Disclosure } from "./components/disclosure";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  withSentenceTiming, BackupSettingsSchema, LearningDocumentSchema, HostMessageSchema, HOST_PROTOCOL_VERSION, parsePlainText,
  LEARNING_LANGUAGES, EXPLANATION_LANGUAGES, levelsForTargetLanguage, defaultLevelForTargetLanguage,
  parseSubtitles, type AgentInfo, type AgentModel, type GenerationRequest, type JobSummary,
  type BackupSettings, type Destination, type DriveAccount, type DriveLessonSummary, type LessonSummary, type DuplicateMatch,
  type AgentSettings, type HostMessage, type LearningDocument,
  type LearningLanguage, type LearningProfile, type SubtitleCue,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { contextualGenerationProfile, normalizeLessonLength, normalizeSavedLessonProfile } from "./lib/contextual-profile";
import { buildGenerationRequest } from "./lib/generation-request";
import { restoreLoopPreferences, type RepeatOption } from "./lib/loop-preferences";
import { titleForVideoTab } from "./video/metadata";
import { detectCurrentVideoMetadata, metadataSourceSafety } from "./video/metadata-resolver";
import { videoMetadataMessages } from "./i18n/video-metadata";
import { subtitleAcquisition, subtitleMessage, subtitleFailureMessage, type SubtitleFailure } from "./i18n/subtitle-acquisition";
import { needsVideoReaderReload } from "./video/reader-health";
import {
  captionCacheKey, isCurrentCaption, subtitleLanguageMatches, videoSourceKey,
  type CaptionProvenance,
} from "./video/caption-provenance";
import {
  assertVideoReaderReady, findVideoTab, getActiveWindowTab,
  reloadExistingVideoTab, VideoCommandError,
} from "./video/tab";
import { DocumentChunkAssembler } from "./native/document-chunks";
import { HOST_NAME, nativeOnce as sendHostRequest } from "./native/host-client";
import { AiModelSelection } from "./components/ai-model-selection";
import { PiSettings } from "./components/pi-settings";
import { agentDisplayName } from "./i18n/agent-display";
import { piCopy } from "./i18n/pi";
import { HostConnectionSettings } from "./components/host-connection-settings";
import { hostConnectionCopy } from "./i18n/host-connection";
import { isPiProviderId, restorePiAgentSelection } from "./agent-selection";
import { GENERATION_CONTROLLER_PORT, type GenerationControllerMessage } from "./native/generation-controller";
import { AlertCircle, X } from "lucide-react";
import { SidePanelNavigation, type SidePanelPage } from "./components/side-panel-navigation";
import { Button } from "./components/ui/button";
import { AppPanel } from "./components/app-panel";
import { TaskHistory, jobStatusKeys } from "./components/task-history";
import { VideoLibrary } from "./components/video-library";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectField, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { SearchableSelectField } from "./components/searchable-select-field";
import { Badge } from "./components/ui/badge";
import { ContextualSceneReader } from "./components/contextual-scene-reader";
import { NoticeViewport } from "./components/notice-viewport";
import { SettingInfo } from "./components/setting-info";
import { learningSettingsCopy, levelHint } from "./i18n/learning-settings";
import { agentModelPreferenceKey, savedAgentModel, migrateAgentModelPreferences, filterImportedModelPreferences } from "./i18n/agent-model-preferences";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale, isLocalePreference, isThemePreference, resolveTheme,
  nativeLanguageName, learningLanguageName, learningLanguageOptions, explanationLanguageName,
  LEARNING_LANGUAGE_SEARCH_COPY,
  type LocalePreference, type ThemePreference,
} from "./i18n/preferences";

type Page = SidePanelPage;
type Installed = Record<string, boolean>;

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  sceneCount: 4, contextualExampleCount: 2,
};
const DEFAULT_AGENT: AgentSettings = { provider: "", modelId: "" };

export default function App() {
  const [page, setPage] = useState<Page>("create");
  const [settingsSection, setSettingsSection] = useState<"general" | "ai" | "storage" | "advanced" | null>(null);
  const [providerDetail, setProviderDetail] = useState(false);
  const [returnPage, setReturnPage] = useState<"create" | "lessons" | "lesson">("create");
  const [editingVideo, setEditingVideo] = useState(false);
  const [temporaryAgent, setTemporaryAgent] = useState<AgentSettings | null>(null);
  const [generationServiceReady, setGenerationServiceReady] = useState(false);
  const [attentionNotificationsEnabled, setAttentionNotificationsEnabled] = useState(true);
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [subtitlePasteDrafts, setSubtitlePasteDrafts] = useState<Record<string, string>>({});
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const [subtitleStatus, setSubtitleStatus] = useState<string | SubtitleFailure>("");
  const [trackInfo, setTrackInfo] = useState<{ sourceKey: string; status: "available" | "unknown";
    tracks: { language: string; kind: "manual" | "auto" }[] } | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [subtitleTone, setSubtitleTone] = useState<"neutral" | "loading" | "success" | "missing" | "error">("neutral");
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
  const [analysisNotificationsEnabled, setAnalysisNotificationsEnabled] = useState(true);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("auto");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const uiLocale = localePreference === "auto" ? browserLocale : localePreference;
  const layout = settingsLayoutCopy[uiLocale];
  const flow = sidePanelLayoutCopy[uiLocale];
  const subtitleUi = subtitleAcquisition[uiLocale];
  const subtitleLayout = subtitleLayoutCopy[uiLocale];
  const [subtitlePreview, setSubtitlePreview] = useState(false);
  const metadataUi = videoMetadataMessages[uiLocale];
  const settingsCopy = learningSettingsCopy[uiLocale];
  const t = useCallback((key: MessageKey, params?: MessageParams) => translate(uiLocale, key, params), [uiLocale]);
  const hostUi = hostConnectionCopy[uiLocale];
  const [profile, setProfile] = useState<LearningProfile>(() => ({
    ...DEFAULT_PROFILE, instructionLanguage: browserLocale,
  }));
  const [explanationLanguageMode, setExplanationLanguageMode] = useState<"auto" | "custom">("auto");
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const generationAgent = temporaryAgent ?? agent;
  const [agentProfiles, setAgentProfiles] = useState<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir" | "thinkingLevel">>>({});
  const [agentModelPreferences, setAgentModelPreferences] = useState<Record<string, string>>({});
  const [modelOptions, setModelOptions] = useState<AgentModel[]>([]);
  const modelCatalogProviderRef = useRef("");
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNotice, setModelNotice] = useState("");
  const [modelRefreshVersion, setModelRefreshVersion] = useState(0);
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [hostVersion, setHostVersion] = useState<string | null>(null);
  const [hostSdkMode, setHostSdkMode] = useState(false);
  const [hostProtocolVersion, setHostProtocolVersion] = useState<number | null>(null);
  const [hostStatus, setHostStatus] = useState("");
  const [hostChecked, setHostChecked] = useState(false);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const videoRecovery = usePlatformVideoNotice();
  const subtitleReaderBlocked = !!videoRecovery.unavailable || !!videoRecoveryUrl || reloadingVideoTab;
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [localLessons, setLocalLessons] = useState<LessonSummary[]>([]);
  const [cloudLessons, setCloudLessons] = useState<DriveLessonSummary[]>([]);
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
  const [sceneRepeat, setSceneRepeat] = useState<RepeatOption>("3");
  const [sceneDelay, setSceneDelay] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
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
  const captionsReady = cues.length > 0 && !!raw.trim() && isCurrentCaption(captionSource, profile.targetLanguage, sourceUrl);
  const subtitleState = subtitleBusy ? "loading" : subtitleStatus && (subtitleTone === "missing" || subtitleTone === "error") ? "error" : captionsReady ? "ready" : raw.trim() ? "error" : "idle";
  useEffect(() => { setSubtitlePreview(false); }, [raw, sourceUrl, profile.targetLanguage]);
  const platform = getVideoAdapter(sourceUrl).id;
  // A valid saved source remains actionable when the Side Panel temporarily loses its tab context.
  const subtitlePlatform = getVideoAdapter(activeVideo?.url ?? sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);
  const selectedDriveId = backup.accountId ?? driveAccounts[0]?.id;
  const driveAccessVerified = !!selectedDriveId && driveAccess?.accountId === selectedDriveId &&
    driveAccess.status === "verified";
  const hostReady = installed !== null && hostSdkMode &&
    hostProtocolVersion === HOST_PROTOCOL_VERSION &&
    hostVersion === chrome.runtime.getManifest().version;
  const selectedAgentInfo = agentCatalog.find(entry => entry.id === agent.provider);
  useEffect(() => {
    void chrome.storage.local.get(["attentionNotificationsEnabled", "analysisNotificationsEnabled", "profile", "agent", "agentProfiles", "agentModelPreferences", "destination", "backup", "repeat", "delay", "sceneRepeat", "sceneDelay", "playbackRate", "uiLocalePreference", "themePreference", "explanationLanguageMode"]).then(saved => {
      if (saved.profile) setProfile(normalizeSavedLessonProfile(saved.profile as Partial<LearningProfile>, {
        ...DEFAULT_PROFILE, instructionLanguage: browserLocale,
      }));
      if (saved.explanationLanguageMode === "custom" ||
          (!saved.explanationLanguageMode && saved.profile &&
            (saved.profile as Partial<LearningProfile>).instructionLanguage !== browserLocale)) {
        setExplanationLanguageMode("custom");
      }
      if (typeof saved.attentionNotificationsEnabled === "boolean") setAttentionNotificationsEnabled(saved.attentionNotificationsEnabled);
      if (typeof saved.analysisNotificationsEnabled === "boolean") setAnalysisNotificationsEnabled(saved.analysisNotificationsEnabled);
      if (isLocalePreference(saved.uiLocalePreference)) setLocalePreference(saved.uiLocalePreference);
      if (isThemePreference(saved.themePreference)) setThemePreference(saved.themePreference);
      // Old built-in selections remain in saved job snapshots, not in BYO onboarding.
      if (saved.agent) setAgent(restorePiAgentSelection(saved.agent));
      if (saved.agentProfiles && typeof saved.agentProfiles === "object" && !Array.isArray(saved.agentProfiles)) {
        setAgentProfiles(Object.fromEntries(Object.entries(saved.agentProfiles)
          .filter(([provider, value]) => isPiProviderId(provider) && value &&
            typeof value === "object" && "modelId" in value && typeof value.modelId === "string")
          .map(([provider, value]) => {
            const setting = value as Pick<AgentSettings, "modelId" | "accountConfigDir" | "thinkingLevel">;
            return [provider, { modelId: setting.modelId,
              accountConfigDir: undefined, thinkingLevel: restorePiAgentSelection({ provider, ...setting }).thinkingLevel }];
          })));
      } else if (saved.agent && isPiProviderId((saved.agent as AgentSettings).provider)) {
        const previous = saved.agent as AgentSettings;
        setAgentProfiles({ [previous.provider]: { modelId: previous.modelId, accountConfigDir: undefined } });
      }
      const previousAgent = saved.agent as AgentSettings | undefined;
      const previousProfiles = saved.agentProfiles && typeof saved.agentProfiles === "object"
        ? saved.agentProfiles as Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir" | "thinkingLevel">> : {};
      const legacyModels = migrateAgentModelPreferences(previousAgent, previousProfiles);
      if (saved.agentModelPreferences && typeof saved.agentModelPreferences === "object" &&
          !Array.isArray(saved.agentModelPreferences)) {
        const imported = filterImportedModelPreferences(saved.agentModelPreferences);
        setAgentModelPreferences({ ...legacyModels, ...imported });
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
      const loopPreferences = restoreLoopPreferences(saved);
      setRepeat(loopPreferences.repeat);
      setDelay(loopPreferences.delay);
      setSceneRepeat(loopPreferences.sceneRepeat);
      setSceneDelay(loopPreferences.sceneDelay);
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
        try { receiveGeneratedDocument(message.document); }
        catch { void loadJobs(); }
        setGenerating(false);
      } else if (message.type === "documentChunk") {
        try {
          const document = chunks.push(message);
          if (document) receiveGeneratedDocument(document);
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

    // Keep manual transcripts bound to their source; restore video captions
    // from the selected video's own draft instead of reusing the old transcript.
    const follow = shouldFollowSelectedVideo(sourceUrl, activeVideo.url, raw, captionSource?.origin);
    if (!sameSource && !follow) return;
    if (follow) {
      if (checking || generating) return;
      ++captionRequestRef.current;
      ++metadataRequestRef.current;
      setSubtitleBusy(false);
      setMetadataBusy(false);
      const cached = captionDraftsRef.current.get(captionCacheKey(activeVideo.url, profile.targetLanguage));
      setRaw(cached?.raw ?? "");
      setFileName(cached?.fileName ?? "");
      setCaptionSource(cached?.source ?? null);
      setSubtitleStatus("");
      setMetadataStatus("");
      setVideoRecoveryUrl("");
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
  }, [activeVideo?.tabId, activeVideo?.url, activeVideo?.title, raw, sourceUrl, fileName, captionSource?.origin, profile.targetLanguage, checking, generating]);

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
    const key = videoSourceKey(sourceUrl);
    const adapter = getVideoAdapter(sourceUrl);
    setTrackInfo(null);
    if (!key || adapter.id === "import") { setTrackBusy(false); return; }
    if (!adapter.availableSubtitleTracks) {
      setTrackBusy(false);
      setTrackInfo({ sourceKey: key, status: "unknown", tracks: [] });
      return;
    }
    let live = true;
    setTrackBusy(true);
    void (async () => {
      const tab = await findVideoTab(adapter, sourceUrl);
      await assertVideoReaderReady(tab, adapter);
      const result = await adapter.availableSubtitleTracks!(tab.url ?? sourceUrl);
      if (live) setTrackInfo({ sourceKey: key, ...result });
    })().catch(() => {
      if (live) setTrackInfo({ sourceKey: key, status: "unknown", tracks: [] });
    }).finally(() => { if (live) setTrackBusy(false); });
    return () => { live = false; };
  }, [sourceUrl]);

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
    if (hydrated) void chrome.storage.local.set({ attentionNotificationsEnabled, analysisNotificationsEnabled, profile, agent, agentProfiles, agentModelPreferences, destination, backup, repeat, delay, sceneRepeat, sceneDelay, playbackRate, uiLocalePreference: localePreference, themePreference, explanationLanguageMode });
  }, [hydrated, attentionNotificationsEnabled, analysisNotificationsEnabled, profile, agent, agentProfiles, agentModelPreferences, destination, backup, repeat, delay, sceneRepeat, sceneDelay, playbackRate, localePreference, themePreference, explanationLanguageMode]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);


  useEffect(() => {
    if (hydrated && explanationLanguageMode === "auto") {
      setProfile(previous => previous.instructionLanguage === uiLocale ? previous
        : { ...previous, instructionLanguage: uiLocale });
    }
  }, [hydrated, explanationLanguageMode, uiLocale]);

  function nativeOnce(request: { id: string; type: string; [key: string]: unknown }): Promise<HostMessage> {
    return sendHostRequest(request);
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

  const listEndedJobs = useCallback(async (): Promise<JobSummary[]> => {
    const response = await nativeOnce({ id: crypto.randomUUID(), type: "listEndedJobs" });
    if (response.type !== "jobs") throw new Error("Unexpected task history response");
    return response.jobs;
  }, []);

  async function deleteJobRecords(jobIds: string[]) {
    const response = await nativeOnce({ id: crypto.randomUUID(), type: "deleteJobHistory", jobIds });
    if (response.type !== "jobHistoryDeleted") throw new Error("Unexpected deletion response");
    const removed = new Set(response.deleted);
    setJobs(previous => previous.filter(job => !removed.has(job.id)));
    loadJobs();
    return response;
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
    next = { provider: next.provider, modelId: next.modelId, thinkingLevel: next.thinkingLevel };
    setAgent(next);
    setAgentProfiles(previous => ({
      ...previous,
      [next.provider]: { modelId: next.modelId, accountConfigDir: undefined, thinkingLevel: next.thinkingLevel },
    }));
    setAgentModelPreferences(previous => ({
      ...previous, [agentModelPreferenceKey(next.provider, undefined)]: next.modelId,
    }));
  }

  function selectAgent(provider: string): void {
    if (!isPiProviderId(provider)) return;
    const previous = agentProfiles[provider];
    updateAgent({
      provider,
      thinkingLevel: previous?.thinkingLevel,
      modelId: savedAgentModel(provider, undefined, agentModelPreferences, previous?.modelId ?? ""),
    });
  }

  function checkHost(): void {
    setHostStatus("");
    setHostBusy(true);
    const startedAt = performance.now();
    const finishCheck = () => window.setTimeout(() => setHostBusy(false),
      Math.max(0, 500 - (performance.now() - startedAt)));
    const id = crypto.randomUUID();
    let replied = false;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((raw: unknown) => {
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const old = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
        if (old?.id !== id) return;
        replied = true;
        setHostChecked(true);
        setInstalled({});
        setHostVersion(typeof old.version === "string" ? old.version : null);
        setHostProtocolVersion(null);
        setHostSdkMode(false);
        finishCheck();
        port.disconnect();
        return;
      }
      const message = parsed.data;
      if (message.id === id && message.type === "health") {
        replied = true;
        setHostChecked(true);
        // Older Hosts may still advertise built-in adapters despite matching version numbers.
        const imported = Array.isArray(message.agents)
          ? message.agents.filter(entry => isPiProviderId(entry.id)) : [];
        setInstalled(Object.fromEntries(Object.entries(message.installed)
          .filter(([id]) => isPiProviderId(id))));
        setHostVersion(typeof message.version === "string" ? message.version : null);
        setHostSdkMode(message.agentMode === "pi-sdk");
        setHostProtocolVersion(message.protocolVersion ?? null);
        setAgentCatalog(imported);
        setAgent(current => current.provider &&
          (!isPiProviderId(current.provider) ||
            !imported.some(entry => entry.id === current.provider))
          ? DEFAULT_AGENT : current);
        finishCheck();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!replied) {
        setHostChecked(true);
        setInstalled(null);
        setHostVersion(null);
        setHostSdkMode(false);
        setHostProtocolVersion(null);
        setHostStatus(chrome.runtime.lastError?.message ?? "Native Host connection failed.");
        finishCheck();
      }
    });
    port.postMessage({ id, type: "health" });
  }

  useEffect(() => {
    if (hydrated) checkHost();
    // Run the initial health check once after saved settings have been loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (!hostReady || !agent.provider) {
      setModelBusy(false);
      setModelOptions([]);
      setModelNotice("");
      return;
    }
    if (!installed[agent.provider]) {
      setModelOptions([]);
      setModelNotice(t("agentMissing"));
      return;
    }
    let ignore = false;
    let settleTimer: number | undefined;
    const startedAt = performance.now();
    setModelBusy(true);
    if (modelCatalogProviderRef.current !== agent.provider) setModelOptions([]);
    modelCatalogProviderRef.current = agent.provider;
    setModelNotice("");
    void nativeOnce({
      id: crypto.randomUUID(), type: "agentModels",
      settings: { provider: agent.provider, modelId: "" },
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
  }, [hydrated, installed, hostReady, agent.provider, modelRefreshVersion]);

  function receiveGeneratedDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setProgress(t("statusSaved"));
    setPage(current => current === "create" ? "lessons" : current);
    void loadLessons();
  }

  function showDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setDocument(parsed.data);
    setPage("lesson");
    setProgress(t("statusSaved"));
  }

  async function saveDocumentPlaybackRange(
    documentId: string, cueId: string, range: { startMs: number; endMs: number } | null,
  ): Promise<void> {
    const response = await nativeOnce({
      id: crypto.randomUUID(), type: "savePlaybackRange", documentId, cueId, range,
    });
    if (response.type !== "playbackRangeSaved" || response.cueId !== cueId) {
      throw new Error("Native Host did not confirm the playback calibration");
    }
    if (response.warning) setError(response.warning);
    // The Host persists first; only then update the reader and JSON/Markdown export.
    setDocument(current => {
      if (current?.id !== documentId) return current;
      return withSentenceTiming(current, cueId, response.range);
    });
  }

  async function saveDocumentScenePlaybackRange(
    documentId: string, sceneId: string, range: { startMs: number; endMs: number } | null,
  ): Promise<void> {
    const response = await nativeOnce({
      id: crypto.randomUUID(), type: "saveScenePlaybackRange", documentId, sceneId, range,
    });
    if (response.type !== "scenePlaybackRangeSaved" || response.sceneId !== sceneId) {
      throw new Error("Native Host did not confirm the scene playback calibration");
    }
    if (response.warning) setError(response.warning);
    setDocument(current => {
      if (current?.id !== documentId) return current;
      const scenePlaybackOverrides = { ...current.scenePlaybackOverrides };
      if (response.range) scenePlaybackOverrides[sceneId] = response.range;
      else delete scenePlaybackOverrides[sceneId];
      return { ...current, scenePlaybackOverrides };
    });
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
    setPage("create");
    setProgress(t(input.type === "resume" ? "statusResuming" : "statusConnecting"));
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try { receiveGeneratedDocument(raw); }
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
        if (/^(?:Error: )?This operation was aborted\.?$/.test(message.message)) {
          setError("");
          setNotice(piFeedback(uiLocale, message.message, "generation").message);
        } else setError(message.message);
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
    setTemporaryAgent(null);
  }

  function startGeneration(): void {
    if (checking || generating) return;
    if (!hostReady) {
      setError(installed === null ? piCopy[uiLocale].unavailable : hostUi.unsupportedMode);
      setSettingsSection("advanced"); setPage("settings");
      return;
    }
    if (!isPiProviderId(generationAgent.provider) || installed?.[generationAgent.provider] !== true) {
      setError(piCopy[uiLocale].empty);
      setSettingsSection("ai"); setPage("settings");
      return;
    }
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
      const payload = buildGenerationRequest({
        source: { platform, title: title.trim(), ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
        profile, agent: generationAgent, destination, backup, cues,
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
    port.onMessage.addListener((raw: unknown) => {
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        received = true;
        setError("Native Host returned invalid job data. Update the Host and try again.");
        finishLoading();
        port.disconnect();
        return;
      }
      const message = parsed.data;
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

  function fetchSavedDocument(documentId: string, handle: (raw: unknown) => void): void {
    if (generating) return;
    setError("");
    setGenerating(true);
    const id = crypto.randomUUID();
    const port = chrome.runtime.connectNative(HOST_NAME);
    const chunks = new DocumentChunkAssembler();
    let finished = false;
    function complete(raw: unknown): void {
      try { handle(raw); }
      catch (error) { setError(error instanceof Error ? error.message : t("errorDocumentOpen")); }
      finished = true;
      setGenerating(false);
      port.disconnect();
    }
    port.onMessage.addListener((raw: unknown) => {
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        finished = true;
        setGenerating(false);
        setError("Native Host returned an invalid lesson response. Update the Host and try again.");
        port.disconnect();
        return;
      }
      const message = parsed.data;
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
    if (!hydrated) return;
    const route = new URLSearchParams(window.location.search);
    const lesson = route.get("lesson");
    if (lesson && hostReady) { openSavedDocument(lesson); window.history.replaceState(null, "", window.location.pathname); }
    else if (route.has("activity")) { setPage("activity"); loadJobs(); window.history.replaceState(null, "", window.location.pathname); }
  }, [hydrated, hostReady]);

  function openSavedDocument(documentId: string): void {
    fetchSavedDocument(documentId, showDocument);
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
  }, [raw, title, sourceUrl, profile, generationAgent, destination, backup]);

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
      const found = await detectCurrentVideoMetadata("");
      if (request !== metadataRequestRef.current) return;
      if (!found) throw new Error(metadataUi.unavailable);

      const follow = shouldFollowSelectedVideo(originalSource, found.url, raw, captionSource?.origin);
      const safety = metadataSourceSafety(originalSource, follow ? "" : raw, found.url);
      if (safety === "mismatch") throw new Error(metadataUi.mismatch);
      if (safety === "confirm" && !window.confirm(metadataUi.confirmUnlinked)) return;
      if (request !== metadataRequestRef.current) return;

      // Preserve manual transcripts; video captions are cached separately per source.
      if (follow) {
        ++captionRequestRef.current;
        const cached = captionDraftsRef.current.get(captionCacheKey(found.url, profile.targetLanguage));
        setRaw(cached?.raw ?? "");
        setFileName(cached?.fileName ?? "");
        setCaptionSource(cached?.source ?? null);
        setSubtitleStatus("");
        manuallyEditedTitleRef.current = false;
        setTitle("");
      }
      // An explicitly confirmed metadata link can bind an imported transcript to this video.
      // Editing a video URL directly never silently rebinds an unrelated subtitle file.
      if (!originalSource && captionSource?.origin === "manual" && raw.trim()) {
        const source: CaptionProvenance = { ...captionSource, sourceKey: videoSourceKey(found.url) };
        setCaptionSource(source);
        captionDraftsRef.current.set(captionCacheKey(found.url, profile.targetLanguage), {
          raw, fileName, source,
        });
      }
      setSourceUrl(found.url);
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
      setSubtitleTone("neutral");
      setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageReady, {
        language: learningLanguageName(language, uiLocale),
      }));
      return;
    }
    if (!cached && captionSource?.origin === "manual" && raw.trim()) {
      setSubtitleTone("missing");
      setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageChanged, {
        language: learningLanguageName(language, uiLocale),
      }));
      return;
    }
    if (!getVideoAdapter(activeVideo?.url ?? sourceUrl).fetchSubtitles) {
      setSubtitleTone("missing");
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
    if (subtitleReaderBlocked || (!replacing && (subtitleBusy || metadataBusy)) || checking || generating) return;
    const request = ++captionRequestRef.current;
    let attemptedUrl = "";
    setCaptionSource(null);
    setSubtitleBusy(true);
    setSubtitleTone("loading");
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
      setSubtitleTone("success");
      setSubtitleStatus(subtitleMessage(subtitleUi.success, {
        count: parsed.length, language: fetched.language,
      }));
    } catch (cause) {
      if (request !== captionRequestRef.current) return;
      const trackMissing = cause instanceof VideoCommandError &&
        cause.code === "TRACK_UNAVAILABLE";
      const diagnostic = cause instanceof Error ? cause.message : "";
      const readerUnavailable = needsVideoReaderReload(diagnostic);
      if (attemptedUrl && readerUnavailable) setVideoRecoveryUrl(attemptedUrl);
      setSubtitleTone(trackMissing ? "missing" : "error");
      setSubtitleStatus({
        code: readerUnavailable ? "READER_UNAVAILABLE"
          : cause instanceof VideoCommandError && cause.code ? cause.code : "CAPTION_FAILED",
        language,
      });
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
      setSubtitleTone("neutral");
      setSubtitleStatus(subtitleUi.reloadedTab);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : subtitleUi.reloadFailed);
    } finally {
      setReloadingVideoTab(false);
    }
  }

  function usePastedSubtitles(text: string): void {
    if (!text.trim()) return;
    ++metadataRequestRef.current;
    setMetadataBusy(false);
    setMetadataStatus("");
    ++captionRequestRef.current;
    setSubtitleBusy(false);
    const source: CaptionProvenance = {
      origin: "manual", sourceKey: videoSourceKey(sourceUrl), language: profile.targetLanguage,
    };
    setRaw(text);
    setCaptionSource(source);
    setFileName("");
    captionDraftsRef.current.set(captionCacheKey(sourceUrl, profile.targetLanguage), {
      raw: text, fileName: "", source,
    });
    setSubtitleTone("neutral");
    setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageReady, {
      language: learningLanguageName(profile.targetLanguage, uiLocale),
    }));
    setError("");
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
    setSubtitleTone("neutral");
    setSubtitleStatus(subtitleMessage(subtitleUi.manualLanguageReady, {
      language: learningLanguageName(profile.targetLanguage, uiLocale),
    }));
    if (!title) {
      manuallyEditedTitleRef.current = true;
      setTitle(file.name.replace(/\.(srt|vtt|txt)$/i, ""));
    }
    setError("");
  }

  const levelOptions = levelsForTargetLanguage(profile.targetLanguage);

  const activeJob = jobs.find(job => job.id === lastJobIdRef.current);
  useEffect(() => {
    if (page === "lessons") void loadLessons();
  }, [page, backup.accountId, driveAccounts.length]);

  return (
    <div className={(page === "lesson" ? "h-dvh flex flex-col overflow-hidden pb-0 " : "pb-9 ") + "mx-auto min-w-0 max-w-[780px] px-3 text-[13px] leading-[1.5] antialiased font-[Outfit,'Noto_Sans_TC',-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] [color-scheme:light] dark:[color-scheme:dark] [font-synthesis:none]"}>
      <header className="flex items-center justify-between gap-2 py-2.5 [&>div]:flex [&>div]:min-w-0 [&>div]:items-center [&>div]:gap-2 [&_strong]:min-w-0 [&_strong]:text-xs [&_strong]:leading-[1.25] [&_strong]:wrap-anywhere">
        <div><img className="block size-7 shrink-0 rounded-[var(--radius)] object-contain" src={chrome.runtime.getURL("icons/icon48.png")} alt="" /><strong>Contextual Language Learning</strong></div>
        <HeaderActions locale={uiLocale} page={page} attentionCount={jobs.filter(job => ["waiting", "failed"].includes(job.status)).length}
          onActivity={() => { if (page === "activity") return; if (page === "create" || page === "lessons" || page === "lesson") setReturnPage(page); setPage("activity"); loadJobs(); }}
          onSettings={() => { if (page === "create" || page === "lessons" || page === "lesson") setReturnPage(page); setSettingsSection(null); setPage("settings"); }} />
      </header>
      <SidePanelNavigation page={page} onNavigate={setPage} t={t} />

      <NoticeViewport locale={uiLocale} videoRecovery={page === "create" && !generating ? undefined : videoRecovery} error={error} notice={notice}
        closeLabel={t("closeNotification")} regionLabel={t("notificationsRegion")}
        theme={resolveTheme(themePreference, systemDark)}
        dismiss={() => { setError(""); setNotice(""); }} />

      {page === "create" && <main id="page-panel-create" aria-labelledby="page-nav-create" className="space-y-4 py-3">
        {generating ? <GenerationStatus locale={uiLocale} job={activeJob} title={title} progress={progress}
          notificationsEnabled={analysisNotificationsEnabled} onLibrary={() => setPage("lessons")}
          onCancel={cancelGeneration} /> : <>
        <PageSection framed>
          <h2>{flow.video}</h2>
          <div className="min-w-0 border-b border-border pb-4">
            <strong className="block text-sm wrap-anywhere">{title || activeVideo?.title || flow.videoEmpty}</strong>
            <p className="mt-1 text-sm text-muted-foreground">{!activeVideo ? flow.videoEntryHint : getVideoAdapter(sourceUrl || activeVideo.url).id === "import" ? t("providerImport") : getVideoAdapter(sourceUrl || activeVideo.url).label}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={metadataBusy || subtitleBusy || checking}
                onClick={() => void fetchCurrentVideoMetadata()}>
                {metadataBusy ? metadataUi.busy : flow.useVideo}</Button>
              {activeVideo && <Button variant="ghost" size="sm" aria-expanded={editingVideo} onClick={() => setEditingVideo(value => !value)}>{editingVideo ? flow.done : flow.editVideoDetails}</Button>}
            </div>
          {metadataStatus && <p className="my-2 text-xs text-muted-foreground" role="status">{metadataStatus}</p>}
          {(editingVideo || !activeVideo) && <>
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
          </>}
          </div>
          <section aria-label={subtitleLayout.heading} data-ui="subtitleState" data-state={subtitleState} className="my-3 grid min-w-0 gap-2">
            <h3 className="text-sm font-semibold">{subtitleLayout.heading}</h3>
            <div role={subtitleState === "error" ? "alert" : "status"} className="grid gap-1 text-sm wrap-anywhere">
              <p className="flex items-center gap-2 font-medium">
                {subtitleState === "ready" && <Check aria-hidden="true" className="size-4 shrink-0" />}
                {subtitleState === "loading" && <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />}
                {subtitleState === "error" && <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-destructive" />}
                {subtitleState === "ready" ? learningLanguageName(profile.targetLanguage, uiLocale) + " · " + subtitleMessage(subtitleLayout.count, { count: cues.length }) : subtitleReaderBlocked ? subtitleLayout.reloadNeeded : subtitleState === "loading" ? subtitleUi.busy : subtitleState === "error" ? subtitleLayout.failed : subtitleLayout.empty}
              </p>
              {!subtitleReaderBlocked && (subtitleState === "loading" || subtitleState === "error") && <p className="text-xs text-muted-foreground">{subtitleState === "loading" ? subtitleMessage(subtitleUi.loadingLanguage, { language: learningLanguageName(profile.targetLanguage, uiLocale) }) : (subtitleStatus ? typeof subtitleStatus === "string" ? subtitleStatus : subtitleFailureMessage(uiLocale, subtitleStatus) : subtitleMessage(subtitleUi.languageNotReady, { language: learningLanguageName(profile.targetLanguage, uiLocale) }))}</p>}
              {subtitleReaderBlocked && subtitleState === "ready" && <p className="text-xs text-muted-foreground">{subtitleLayout.reloadNeeded}</p>}
              {videoRecovery.failed && <p className="text-xs text-destructive">{subtitleUi.reloadFailed}</p>}
              {subtitleState === "ready" && captionSource?.origin === "manual" && <p className="text-xs text-muted-foreground">{subtitleLayout.source}：{fileName ? fileName.split(".").pop()?.toUpperCase() : subtitleLayout.paste}</p>}
            </div>
            {subtitleState === "ready" && <>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" aria-expanded={subtitlePreview} aria-controls="subtitle-preview" onClick={() => setSubtitlePreview(value => !value)}>{subtitlePreview ? subtitleLayout.close : subtitleLayout.preview}</Button>
                {!subtitleReaderBlocked && (subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && <Button variant="ghost" size="sm"
                  disabled={subtitleReaderBlocked || subtitleBusy || metadataBusy || checking || generating}
                  onClick={() => void fetchCurrentSubtitles()}>
                  {subtitleBusy ? subtitleUi.busy : subtitleLayout.refresh}
                </Button>}
              </div>
              {subtitlePreview && <ol id="subtitle-preview" aria-label={subtitleLayout.preview} tabIndex={0} className="grid max-h-64 gap-2 overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-border p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {cues.map((cue, index) => <li key={index} className="flex min-w-0 items-start gap-3"><span className="shrink-0 tabular-nums text-muted-foreground">{cue.startMs === null ? "—" : String(Math.floor(cue.startMs / 60000)).padStart(2, "0") + ":" + String(Math.floor(cue.startMs / 1000) % 60).padStart(2, "0")}</span><span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{cue.originalText}</span></li>)}
              </ol>}
            </>}
          </section>
          {(subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && <>
            {!subtitleReaderBlocked && subtitleState !== "ready" && trackBusy && <p className="my-2 text-xs text-muted-foreground" role="status">{subtitleUi.tracksChecking}</p>}
            {!subtitleReaderBlocked && subtitleState !== "ready" && !trackBusy && trackInfo?.status !== "unknown" && trackInfo?.sourceKey === videoSourceKey(sourceUrl) && <p className="my-2 text-xs text-muted-foreground wrap-anywhere" role="status">{
              (() => {
                const available = LEARNING_LANGUAGES.filter(language => trackInfo.tracks.some(track =>
                  subtitleLanguageMatches(language, track.language)));
                const names = available.map(language => learningLanguageName(language, uiLocale) +
                  (trackInfo.tracks.some(track => subtitleLanguageMatches(language, track.language) && track.kind === "manual")
                    ? "" : " (" + subtitleUi.tracksAuto + ")"));
                const summary = subtitleMessage(subtitleUi.tracksAvailable, {
                  languages: names.join("、") || subtitleUi.tracksNone,
                });
                return available.includes(profile.targetLanguage) ? summary : summary + " " +
                  subtitleMessage(subtitleUi.tracksMissing, {
                    language: learningLanguageName(profile.targetLanguage, uiLocale),
                  });
              })()
            }</p>}

            {!subtitleReaderBlocked && subtitleState !== "ready" && <Button size="sm" className="min-w-0 text-center leading-[1.4] whitespace-normal wrap-anywhere"
              disabled={subtitleReaderBlocked || subtitleBusy || metadataBusy || checking || generating}
              onClick={() => void fetchCurrentSubtitles()}>
              {subtitleBusy ? subtitleUi.busy : subtitleState === "error" ? subtitleLayout.retry : subtitleUi.button}
            </Button>}
            {(videoRecoveryUrl || videoRecovery.unavailable) && <div className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full" data-ui="actions">
              <Button variant="outline" size="sm"
                disabled={reloadingVideoTab || videoRecovery.busy || subtitleBusy || metadataBusy}
                onClick={() => {
                  if (videoRecovery.unavailable) { setVideoRecoveryUrl(""); void videoRecovery.reload(); }
                  else void reloadVideoReader();
                }}>
                {reloadingVideoTab || videoRecovery.busy ? subtitleUi.reloadingTab : subtitleLayout.reloadVideo}
              </Button>
            </div>}
          </>}
          <Disclosure className="mt-2 min-w-0 [&>div]:border-b-0" key={subtitlePlatform + ":" + String(subtitleState === "error")} defaultOpen={subtitleState === "error"} title={<>{flow.otherSubtitles}</>}>
            {subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube" && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("subtitleHint")}</p>}
            <SubtitleImport
              value={subtitlePasteDrafts[captionCacheKey(sourceUrl, profile.targetLanguage)] ??
                (captionSource?.origin === "manual" && !fileName ? raw : "")}
              onValueChange={text => setSubtitlePasteDrafts(current => ({
                ...current, [captionCacheKey(sourceUrl, profile.targetLanguage)]: text,
              }))}
              onFile={onFile} onPaste={usePastedSubtitles} disabled={subtitleBusy || checking || generating}
              importedFileLabel={fileName ? t("importedFile", { name: fileName }) : undefined}
              copy={{ hint: t("subtitleImportHint"), fileTab: t("subtitleFileTab"),
                pasteTab: t("subtitlePasteTab"), fileHint: t("subtitleFileHint"),
                fileButton: t("importSubtitleFile"), pasteLabel: t("pasteSubtitles"),
                pasteButton: t("usePastedSubtitles"), placeholder: t("subtitlePlaceholder") }} />
          </Disclosure>


        </PageSection>

        <PageSection framed className="[&_[data-ui=hint]]:my-[4px_9px] [&_[data-ui=settingField]_[data-slot=select-trigger]]:min-h-8 [&_[data-ui=settingField]_[data-slot=select-trigger]]:w-full [&_[data-ui=advancedLessonSettings]]:mt-4 [&_[data-ui=advancedLessonSettings]>div]:border-b-0">
          <h2>{flow.learning}</h2>
          <div className="my-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-4 gap-y-3 [&_[data-ui=settingField]]:m-0">
            <div className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full" data-ui="settingField">
              <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="learning-target">{t("targetLanguage")}</label>
                <SettingInfo label={t("targetLanguage")} infoLabel={settingsCopy.infoLabel}
                  explanation={settingsCopy.fieldHints.targetLanguage}
                  />
              </div>
              <SearchableSelectField id="learning-target" ariaLabel={t("targetLanguage")}
                value={profile.targetLanguage} onValueChange={chooseLearningLanguage} disabled={checking || generating}
                options={learningLanguageOptions(uiLocale)} copy={LEARNING_LANGUAGE_SEARCH_COPY[uiLocale]} />
            </div>
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
                ...current, sceneCount: normalizeLessonLength(Number(value)),
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
          </div>
          <Disclosure className="my-2 min-w-0" data-ui="advancedLessonSettings" title={<>{t("advancedLessonSettings")}</>}>
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
          </Disclosure>
        </PageSection>

        <PageSection framed>
          <h2>{flow.generate}</h2>
          {duplicateWarning && <Alert className="my-3 min-w-0 wrap-anywhere" aria-label={t("duplicateConfirmLabel")}>
            <AlertTitle>{t("duplicateFound", { count: duplicateWarning.matches.length })}</AlertTitle>
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
          </Alert>}
          <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere mt-[5px] mb-[14px]">{t("lessonContentSummary", {
            scenes: profile.sceneCount, examples: profile.contextualExampleCount ?? 2,
          })}</p>
          <GenerationService locale={uiLocale} selected={generationAgent} defaultAgent={agent}
            providers={agentCatalog} available={hostReady} modelPreferences={agentModelPreferences}
            disabled={checking} onChange={setTemporaryAgent} onReady={setGenerationServiceReady}
            onConfigure={() => { setReturnPage("create"); setSettingsSection("ai"); setPage("settings"); }} />
          <Button className="h-auto min-h-9 w-full px-3 py-2 text-center text-xs font-semibold leading-[1.4] whitespace-normal wrap-anywhere" onClick={startGeneration} disabled={!hostReady || !generationServiceReady || checking || subtitleBusy || !isPiProviderId(generationAgent.provider) || installed?.[generationAgent.provider] !== true || !captionsReady || !cues.length || !title.trim()}>
            {(generating || checking) && <span className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
            {checking ? t("checkingExistingShort") : t("create")}
          </Button>
        </PageSection>

        </>}
      </main>}

      <main id={page === "lesson" ? undefined : "page-panel-lessons"} aria-labelledby="page-nav-lessons" hidden={page !== "lessons"}>
        {jobs.filter(job => ["running", "queued", "waiting", "failed"].includes(job.status)).sort((a, b) => Number(["running", "queued"].includes(b.status)) - Number(["running", "queued"].includes(a.status))).slice(0, 1).map(job =>
          <GenerationStatus key={job.id} compact locale={uiLocale} job={job} title={job.sourceTitle} progress=""
            notificationsEnabled={analysisNotificationsEnabled} onLibrary={() => setPage("lessons")}
            onActivity={() => { setReturnPage("lessons"); setPage("activity"); loadJobs(); }}
            onResume={hostReady && !generating && agentCatalog.some(provider => provider.id === job.provider && provider.installed)
              ? () => runGeneration({ type: "resume", jobId: job.id }) : undefined} />)}
        <VideoLibrary localLessons={localLessons} cloudLessons={cloudLessons}
          driveAccounts={driveAccounts} driveConfigured={driveConfigured}
          lessonsBusy={lessonsBusy} catalogError={catalogError} restoreBusy={restoreBusy}
          generating={generating} storageBusy={storageBusy} uiLocale={uiLocale} t={t}
          onRefresh={loadLessons} onConnectDrive={connectDrive}
          onOpen={openSavedDocument} onRestore={restoreLesson} />
      </main>

      {page === "activity" && <main id="page-panel-activity" aria-labelledby="activity-title">
        <Button variant="ghost" size="sm" className="mb-2 justify-start rounded-sm px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => setPage(returnPage)}><ArrowLeft className="size-4" aria-hidden="true" />{layout.back}</Button>
        <h1 id="activity-title" className="text-sm font-semibold">{layout.activity}</h1>
        <TaskHistory jobs={jobs} loadingJobs={loadingJobs} hostReady={hostReady}
          generating={generating} storageBusy={storageBusy} agentCatalog={agentCatalog} locale={uiLocale} onConfigure={() => { setSettingsSection("ai"); setPage("settings"); }} t={t}
          onRefresh={loadJobs} onResume={jobId => runGeneration({ type: "resume", jobId })}
          onOpen={openSavedDocument} onRetryPublication={retryPublication}
          onRetryBackup={retryBackup} onListEnded={listEndedJobs} onDeleteRecords={deleteJobRecords} />
      </main>}

      {page === "settings" && <main id="page-panel-settings" aria-label={t("settings")}>
        {settingsSection ? ((settingsSection !== "ai" || !providerDetail) && <Button variant="ghost" size="sm" className="mb-1 justify-start rounded-sm px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => setSettingsSection(null)}>
          <ArrowLeft className="size-4" aria-hidden="true" />{layout.back}</Button>) : <PageSection>
          <Button variant="ghost" size="sm" className="mb-2 justify-start rounded-sm px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={() => setPage(returnPage)}><ArrowLeft className="size-4" aria-hidden="true" />{layout.back}</Button>
          <h1 className="text-sm font-semibold">{t("settings")}</h1>
          <nav aria-label={t("settings")} className="mt-2 grid divide-y divide-border">
            {(["general", "ai", "storage", "advanced"] as const).map(section => <Button key={section}
              variant="ghost" className="h-auto min-h-12 justify-between rounded-none px-1 py-2.5 text-left"
              onClick={() => setSettingsSection(section)}>
              <span className="min-w-0"><span className="block text-xs font-semibold">{layout[section]}</span>
                <span className="mt-0.5 block whitespace-normal text-[11px] text-muted-foreground">{section === "ai" && agent.provider
                  ? agentDisplayName(agent.provider, agentCatalog.find(provider => provider.id === agent.provider)?.label) + (agent.modelId ? " · " + agent.modelId : "")
                  : section === "storage" ? (backup.enabled ? layout.storageHint : t("localCopy")) : layout[(section + "Hint") as "generalHint"]}</span></span>
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            </Button>)}
          </nav>
        </PageSection>}

        {settingsSection === "general" && <PageSection>
          <h2>{layout.general}</h2>
          <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="ui-language-select">{t("uiLanguage")}</label>
            </div>
            <Select value={localePreference} onValueChange={next => {
              if (isLocalePreference(next)) setLocalePreference(next);
            }}>
              <SelectTrigger id="ui-language-select" aria-label={t("uiLanguage")} aria-describedby="ui-language-hint">
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
            <p id="ui-language-hint" className="mt-2 text-sm text-muted-foreground">{t("uiLanguageHint")}</p>
          </div>
          <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
            <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
              <label className="m-0 min-w-0 text-xs font-semibold leading-5" htmlFor="appearance-select">{t("appearance")}</label>
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
          <NotificationSettings locale={uiLocale} completed={analysisNotificationsEnabled}
            attention={attentionNotificationsEnabled} onCompleted={setAnalysisNotificationsEnabled}
            onAttention={setAttentionNotificationsEnabled} />
        </PageSection>}
        {settingsSection === "ai" && <PageSection>
          <div hidden={providerDetail}>
          <h2 id="agent-settings-heading" tabIndex={-1}>{piCopy[uiLocale].title}</h2>
          <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{piCopy[uiLocale].hint}</p>
          <AiModelSelection locale={uiLocale} id="settings" provider={agent.provider} modelId={agent.modelId}
            providers={agentCatalog} models={modelOptions} available={hostReady && !generating}
            busy={modelBusy} notice={modelNotice} onProvider={selectAgent}
            onModel={modelId => updateAgent({ ...agent, modelId, thinkingLevel: undefined })}
            thinkingLevel={agent.thinkingLevel} onThinking={thinkingLevel => updateAgent({ ...agent, thinkingLevel })}
            onRefresh={() => { setModelBusy(true); setModelRefreshVersion(current => current + 1); }}
            />
          </div>
          <PiSettings onDetailChange={setProviderDetail} locale={uiLocale} available={hostReady}
            selectedProvider={agent.provider} onSelect={selectAgent} onChanged={checkHost} />
        </PageSection>}
        {settingsSection === "storage" && <PageSection>
          <h2>{layout.storage}</h2>
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
          <h3 className="mt-5 border-t border-border pt-4 text-sm font-semibold">Google Drive</h3>
          <div className="my-[12px_4px] flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px] [&_[data-ui=hint]]:mt-1 [&_[data-ui=hint]]:mb-0">
              <strong>{t("autoBackup")}</strong>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupHint")}</p>
            </div>
            <Switch checked={backup.enabled} aria-label={t("autoBackup")} disabled={storageBusy}
              onCheckedChange={enabled => enabled ? void enableBackup()
                : setBackup(current => ({ ...current, enabled: false }))} />
          </div>
          {backup.enabled && driveAccessVerified && <div className="flex items-center justify-between gap-2 [&_[data-ui=hint]]:my-[3px] [&_[data-ui=hint]]:min-w-0 [&_[data-ui=hint]]:wrap-anywhere">
            <span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupConnected", { email:
              driveAccounts.find(account => account.id === backup.accountId)?.email ?? t("backupUnknownAccount") })}</span>
            <Button variant="ghost" size="sm" onClick={() => { setSettingsSection("storage"); setPage("settings"); }}>{t("manageDrive")}</Button>
          </div>}
          {!backup.enabled && !driveAccounts.length && driveConfigured &&
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupConnectToEnable")}</p>}
          {driveConnectError && <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">{driveConnectError}</p>}
          {backupStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{backupStatus}</p>}
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
          {driveAccounts.length > 0 && <Disclosure className="my-2 min-w-0" data-ui="agentProfileAdvanced" title={<>{t("manageDrive")} · {driveAccounts.length}</>}>
            <div className="mt-[10px] grid gap-[5px]">
              {driveAccounts.map(account => <div className="flex min-w-0 items-center justify-between gap-2 py-[5px] not-first:border-t not-first:border-border [&_span]:min-w-0 [&_span]:text-xs [&_span]:wrap-anywhere" key={account.id}>
                <span title={account.email}>{account.email}</span>
                <Button variant="ghost" size="sm" disabled={storageBusy}
                  onClick={() => void disconnectDrive(account.id)}>{t("disconnectGoogle")}</Button>
              </div>)}
            </div>
          </Disclosure>}
          {driveAccounts.length > 0 && <section className="mt-[14px] grid justify-items-start gap-1 border-t border-border pt-3 [&_strong]:text-xs [&_[data-ui=hint]]:mt-0 [&_[data-ui=hint]]:mb-[5px]">
            <strong>{t("backupExisting")}</strong>
            <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{t("backupExistingHint")}</p>
            <Button variant="outline" size="sm" disabled={storageBusy || !driveAccounts.length}
              onClick={() => void backupExistingLessons()}>{t("backupExisting")}</Button>
          </section>}
          {driveConnectError && <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">{driveConnectError}</p>}
          {backupStatus && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{backupStatus}</p>}
        </PageSection>}
        {settingsSection === "advanced" && <PageSection><h2>{layout.advanced}</h2>
          <p className="my-3 text-xs text-muted-foreground">{layout.hostHelp}</p>
          <HostConnectionSettings locale={uiLocale} connected={installed !== null} checked={hostChecked}
            sdkMode={hostSdkMode} protocolVersion={hostProtocolVersion}
            version={hostVersion} busy={hostBusy} error={hostStatus} onCheck={checkHost} />
        </PageSection>}
      </main>}

      {page === "lesson" && <main className="flex min-h-0 flex-1 flex-col" id="page-panel-lessons" aria-labelledby="page-nav-lessons">
        <Button variant="ghost" size="sm" className="mb-2" onClick={() => setPage("lessons")}>{t("lessonLibrary")}</Button>
        {document ? <ContextualSceneReader key={document.id}
          document={document} adapter={readerAdapter} locale={uiLocale}
          repeat={repeat} setRepeat={setRepeat} delay={delay} setDelay={setDelay}
          sceneRepeat={sceneRepeat} setSceneRepeat={setSceneRepeat} sceneDelay={sceneDelay} setSceneDelay={setSceneDelay}
          playbackRate={playbackRate} setPlaybackRate={setPlaybackRate}
          onError={setError} onNotice={setNotice}
          onSaveRange={(cueId, range) => saveDocumentPlaybackRange(document.id, cueId, range)}
          onSaveSceneRange={(sceneId, range) => saveDocumentScenePlaybackRange(document.id, sceneId, range)}
        /> : <AppPanel><h2>{t("emptyHeading")}</h2>
          <Button variant="outline" onClick={() => setPage("lessons")}>{t("lessonLibrary")}</Button>
        </AppPanel>}
      </main>}
    </div>
  );
}
