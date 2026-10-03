import { subtitleLayoutCopy } from "./i18n/subtitle-layout";
import { useSubtitleDraft } from "./hooks/use-subtitle-draft";
import { usePlatformVideoNotice } from "./hooks/use-platform-video-notice";
import { IconTooltip } from "./components/icon-tooltip";
import { HeaderActions } from "./components/header-actions";
import { PageHeading } from "./components/page-heading";
import { PageSection } from "./components/page-section";
import { GenerationService } from "./components/generation-service";
import { GenerationStatus } from "./components/generation-status";
import { sidePanelLayoutCopy } from "./i18n/side-panel-layout";
import { settingsLayoutCopy } from "./i18n/settings-layout";
import { NotificationSettings } from "./components/notification-settings";
import { ArrowLeft, ChevronRight, Check, LoaderCircle, ExternalLink } from "lucide-react";
import { piFeedback } from "./i18n/pi-feedback";
import { SubtitleImport } from "./components/subtitle-import";
import { Switch } from "./components/ui/switch";
import { Alert, AlertTitle } from "./components/ui/alert";
import { Disclosure } from "./components/disclosure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  withSentenceTiming,
  LearningDocumentSchema,
  HOST_PROTOCOL_VERSION,
  LEARNING_LANGUAGES,
  EXPLANATION_LANGUAGES,
  levelsForTargetLanguage,
  defaultLevelForTargetLanguage,
  type AgentInfo,
  type AgentModel,
  type GenerationRequest,
  type JobSummary,
  type BackupSettings,
  type Destination,
  type DriveAccount,
  type DriveLessonSummary,
  type LessonSummary,
  type DuplicateMatch,
  type AgentSettings,
  type HostMessage,
  type LearningDocument,
  type LearningProfile,
} from "@immersive/core";
import { getVideoAdapter } from "./video";
import { contextualGenerationProfile, normalizeLessonLength } from "./lib/contextual-profile";
import { buildGenerationRequest } from "./lib/generation-request";
import { type RepeatOption } from "./lib/loop-preferences";
import { videoMetadataMessages } from "./i18n/video-metadata";
import {
  subtitleAcquisition,
  subtitleMessage,
  subtitleFailureMessage,
} from "./i18n/subtitle-acquisition";
import {
  captionCacheKey,
  subtitleLanguageMatches,
  videoSourceKey,
} from "./video/caption-provenance";
import { getActiveWindowTab } from "./video/tab";
import { getDocument, nativeOnce as sendHostRequest, type OnceRequest } from "./native/host-client";
import { AiModelSelection } from "./components/ai-model-selection";
import { PiSettings } from "./components/pi-settings";
import { agentDisplayName } from "./i18n/agent-display";
import { piCopy } from "./i18n/pi";
import { HostConnectionSettings } from "./components/host-connection-settings";
import { hostConnectionCopy } from "./i18n/host-connection";
import { isPiProviderId } from "./agent-selection";
import { GenerationSession } from "./native/generation-session";
import { AlertCircle } from "lucide-react";
import { SidePanelNavigation, type SidePanelPage } from "./components/side-panel-navigation";
import { Button } from "./components/ui/button";
import { AppPanel } from "./components/app-panel";
import { TaskHistory, jobStatusKeys } from "./components/task-history";
import { VideoLibrary } from "./components/video-library";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectField,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { SearchableSelectField } from "./components/searchable-select-field";
import { Badge } from "./components/ui/badge";
import { ContextualSceneReader } from "./components/contextual-scene-reader";
import { NoticeViewport } from "./components/notice-viewport";
import { toast } from "sonner";
import { SettingInfo } from "./components/setting-info";
import { learningSettingsCopy, levelHint } from "./i18n/learning-settings";
import { agentModelPreferenceKey, savedAgentModel } from "./i18n/agent-model-preferences";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale,
  isLocalePreference,
  isThemePreference,
  resolveTheme,
  nativeLanguageName,
  learningLanguageName,
  learningLanguageOptions,
  explanationLanguageName,
  LEARNING_LANGUAGE_SEARCH_COPY,
  type LocalePreference,
  type ThemePreference,
} from "./i18n/preferences";

import { getPreferencesStore } from "./lib/preferences-store";

type Page = SidePanelPage;
type Installed = Record<string, boolean>;

const DEFAULT_PROFILE: LearningProfile = {
  targetLanguage: "en",
  instructionLanguage: "zh-TW",
  level: "B1",
  sceneCount: 4,
  contextualExampleCount: 2,
};
const DEFAULT_AGENT: AgentSettings = { provider: "", modelId: "" };

export default function App() {
  const [page, setPage] = useState<Page>("create");
  const [settingsSection, setSettingsSection] = useState<
    "general" | "ai" | "storage" | "advanced" | null
  >(null);
  const [returnPage, setReturnPage] = useState<"create" | "lessons" | "lesson">("create");
  const [editingVideo, setEditingVideo] = useState(false);
  const [generationServiceReady, setGenerationServiceReady] = useState(false);
  const [attentionNotificationsEnabled, setAttentionNotificationsEnabled] = useState(true);
  const [browserLocale] = useState(getBrowserLocale);
  const [analysisNotificationsEnabled, setAnalysisNotificationsEnabled] = useState(true);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("auto");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const preferencesStore = useMemo(
    () => getPreferencesStore(chrome.storage.local, browserLocale),
    [],
  );
  const uiLocale = localePreference === "auto" ? browserLocale : localePreference;
  const layout = settingsLayoutCopy[uiLocale];
  const flow = sidePanelLayoutCopy[uiLocale];
  const subtitleUi = subtitleAcquisition[uiLocale];
  const subtitleLayout = subtitleLayoutCopy[uiLocale];
  const [subtitlePreview, setSubtitlePreview] = useState(false);
  const metadataUi = videoMetadataMessages[uiLocale];
  const settingsCopy = learningSettingsCopy[uiLocale];
  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(uiLocale, key, params),
    [uiLocale],
  );
  const hostUi = hostConnectionCopy[uiLocale];
  const [profile, setProfile] = useState<LearningProfile>(() => ({
    ...DEFAULT_PROFILE,
    instructionLanguage: browserLocale,
  }));
  const [explanationLanguageMode, setExplanationLanguageMode] = useState<"auto" | "custom">("auto");
  const [agent, setAgent] = useState<AgentSettings>(DEFAULT_AGENT);
  const generationAgent = agent;
  const [providerSettings, setProviderSettings] = useState<
    Record<string, Pick<AgentSettings, "modelId" | "thinkingLevel">>
  >({});
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
  const [hostLastCheckedAt, setHostLastCheckedAt] = useState<number | null>(null);
  const hostCheckInFlight = useRef(false);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const videoRecovery = usePlatformVideoNotice();
  const [generating, setGenerating] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [localLessons, setLocalLessons] = useState<LessonSummary[]>([]);
  const [cloudLessons, setCloudLessons] = useState<DriveLessonSummary[]>([]);
  const [lessonsBusy, setLessonsBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  const [destination, setDestination] = useState<Extract<Destination, { kind: "local" }>>({
    kind: "local",
  });
  const [backup, setBackup] = useState<BackupSettings>({ enabled: false });
  const [backupStatus, setBackupStatus] = useState("");
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);
  const [driveConnectError, setDriveConnectError] = useState("");
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveAccountsLoaded, setDriveAccountsLoaded] = useState(false);
  const [driveAccess, setDriveAccess] = useState<{
    accountId: string;
    status: "checking" | "verified" | "failed";
  } | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    payload: GenerationRequest;
    token: string;
    matches: DuplicateMatch[];
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [repeat, setRepeat] = useState<RepeatOption>("3");
  const [delay, setDelay] = useState(1);
  const [sceneRepeat, setSceneRepeat] = useState<RepeatOption>("3");
  const [sceneDelay, setSceneDelay] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const generationSession = useMemo(() => new GenerationSession(), []);
  // Keep the last job across the controller dropping its active connection.
  const lastJobIdRef = useRef<string | null>(null);
  const lastJobSummaryRef = useRef<JobSummary | null>(null);
  const catalogLoadIdRef = useRef(0);

  const { draft: subtitleDraft, state: draftState } = useSubtitleDraft(
    profile.targetLanguage,
    uiLocale,
  );
  const {
    raw,
    fileName,
    subtitleBusy,
    subtitleStatus,
    trackInfo,
    trackBusy,
    subtitleTone,
    captionSource,
    videoRecoveryUrl,
    reloadingVideoTab,
    metadataBusy,
    metadataStatus,
    title,
    sourceUrl,
    activeVideo,
    cues,
    ready: captionsReady,
    pasteDrafts: subtitlePasteDrafts,
  } = draftState;
  const subtitleReaderBlocked =
    !!videoRecovery.unavailable || !!videoRecoveryUrl || reloadingVideoTab;
  subtitleDraft.configure(uiLocale, checking || generating, subtitleReaderBlocked);
  useEffect(() => {
    if (draftState.error) setError(draftState.error);
  }, [draftState.error]);
  const subtitleState = subtitleBusy
    ? "loading"
    : subtitleStatus && (subtitleTone === "missing" || subtitleTone === "error")
      ? "error"
      : captionsReady
        ? "ready"
        : raw.trim()
          ? "error"
          : "idle";
  useEffect(() => {
    setSubtitlePreview(false);
  }, [raw, sourceUrl, profile.targetLanguage]);
  const platform = getVideoAdapter(sourceUrl).id;
  // A valid saved source remains actionable when the Side Panel temporarily loses its tab context.
  const subtitlePlatform = getVideoAdapter(activeVideo?.url ?? sourceUrl).id;
  const readerAdapter = getVideoAdapter(document?.source.url);
  const selectedDriveId = backup.accountId ?? driveAccounts[0]?.id;
  const driveAccessVerified =
    !!selectedDriveId &&
    driveAccess?.accountId === selectedDriveId &&
    driveAccess.status === "verified";
  const hostReady =
    installed !== null &&
    hostSdkMode &&
    hostProtocolVersion === HOST_PROTOCOL_VERSION &&
    hostVersion === chrome.runtime.getManifest().version;
  useEffect(() => {
    let live = true;
    setDriveFolderUrl(null);
    if (hostReady && selectedDriveId) {
      void nativeOnce({ id: crypto.randomUUID(), type: "driveFolder", accountId: selectedDriveId })
        .then(reply => {
          if (live && reply.type === "driveFolder") setDriveFolderUrl(reply.url);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [hostReady, selectedDriveId, backupStatus]);
  const backupJobs = jobs.filter(job => job.backup?.accountId === selectedDriveId);
  const backupDone = backupJobs.filter(job => job.backup?.status === "backed-up");
  const backupFailed = backupJobs.filter(job => job.backup?.status === "failed");
  const lastBackupAt = backupDone
    .map(job => job.backup!.updatedAt)
    .sort()
    .at(-1);
  function applyPreferences(saved: ReturnType<typeof preferencesStore.current>) {
    setProfile(saved.profile);
    setExplanationLanguageMode(saved.explanationLanguageMode);
    setAgent(saved.agent ?? DEFAULT_AGENT);
    setProviderSettings(saved.providerSettings);
    setAgentModelPreferences(saved.agentModelPreferences);
    setDestination(saved.destination);
    setBackup(saved.backup);
    setAttentionNotificationsEnabled(saved.attentionNotificationsEnabled);
    setAnalysisNotificationsEnabled(saved.analysisNotificationsEnabled);
    setLocalePreference(saved.uiLocalePreference);
    setThemePreference(saved.themePreference);
    setRepeat(saved.repeat);
    setDelay(saved.delay);
    setSceneRepeat(saved.sceneRepeat);
    setSceneDelay(saved.sceneDelay);
    setPlaybackRate(saved.playbackRate);
    setHydrated(true);
  }
  useEffect(() => {
    void preferencesStore.load().then(applyPreferences);
    void refreshDriveAccounts();
    // Resolve the hosting Chrome window on every refresh. Discard stale async results
    // when navigation, activation and Side Panel initialization overlap.
    let mounted = true;
    let syncVersion = 0;
    const syncActiveTab = () => {
      const version = ++syncVersion;
      void getActiveWindowTab()
        .then(tab => {
          if (!mounted || version !== syncVersion) return;
          void subtitleDraft.selectVideo(
            tab && tab.id !== undefined && tab.url && getVideoAdapter(tab.url).id !== "import"
              ? { tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title ?? "Video" }
              : null,
          );
        })
        .catch(() => {
          if (mounted && version === syncVersion) void subtitleDraft.selectVideo(null);
        });
    };
    const onActivated = () => syncActiveTab();
    const onUpdated = (
      _tabId: number,
      change: { url?: string; status?: string; title?: string },
    ) => {
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
    };
  }, []);

  useEffect(() => {
    const unsubscribe = generationSession.subscribe(event => {
      if (event.type === "state") {
        setChecking(event.state.checking);
        setDuplicateWarning(event.state.duplicate);
        setGenerating(!!event.state.active);
        if (event.state.lastJobId) lastJobIdRef.current = event.state.lastJobId;
        if (event.state.active?.summary) updateJob(event.state.active.summary);
        return;
      }
      if (event.type === "document") {
        receiveGeneratedDocument(event.document);
        return;
      }
      switch (event.type) {
        case "job":
          updateJob(event.job);
          break;
        case "progress":
          setProgress(t("statusProgress", { completed: event.completed, total: event.total }));
          break;
        case "published":
          break;
        case "publicationFailed":
          setError(t("publishFailed", { message: event.message }));
          break;
        case "backupPublished":
          setBackupStatus(t("backupSaved"));
          break;
        case "backupFailed":
          setBackupStatus(t("backupFailedMessage"));
          break;
        case "generationSettled":
        case "backupsFinished":
          void loadJobs();
          break;
        case "error":
          if (/^(?:Error: )?This operation was aborted\.?$/.test(event.message)) {
            setError("");
            setNotice(piFeedback(uiLocale, event.message, "generation").message);
          } else setError(event.message);
          void loadJobs();
          break;
      }
    });
    return () => {
      unsubscribe();
      generationSession.dispose();
    };
  }, []);

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

  const preferenceRevision = useRef(0);
  useEffect(() => {
    const revision = ++preferenceRevision.current;
    if (hydrated)
      void preferencesStore
        .save({
          schemaVersion: 2,
          attentionNotificationsEnabled,
          analysisNotificationsEnabled,
          profile,
          agent: isPiProviderId(agent.provider) ? agent : null,
          providerSettings,
          agentModelPreferences,
          destination,
          backup,
          repeat,
          delay,
          sceneRepeat,
          sceneDelay,
          playbackRate,
          uiLocalePreference: localePreference,
          themePreference,
          explanationLanguageMode,
        })
        .catch(error => {
          if (revision === preferenceRevision.current) applyPreferences(preferencesStore.current());
          setError(String(error));
        });
  }, [
    hydrated,
    attentionNotificationsEnabled,
    analysisNotificationsEnabled,
    profile,
    agent,
    providerSettings,
    agentModelPreferences,
    destination,
    backup,
    repeat,
    delay,
    sceneRepeat,
    sceneDelay,
    playbackRate,
    localePreference,
    themePreference,
    explanationLanguageMode,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (hydrated && explanationLanguageMode === "auto") {
      setProfile(previous =>
        previous.instructionLanguage === uiLocale
          ? previous
          : { ...previous, instructionLanguage: uiLocale },
      );
    }
  }, [hydrated, explanationLanguageMode, uiLocale]);

  function nativeOnce(request: OnceRequest): Promise<HostMessage> {
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
    void nativeOnce({ id: crypto.randomUUID(), type: "driveValidate", accountId })
      .then(response => {
        if (cancelled) return;
        if (response.type !== "driveValidated")
          throw new Error("Google Drive access could not be verified.");
        setDriveAccess({ accountId, status: "verified" });
        setDriveConnectError("");
      })
      .catch(cause => {
        if (cancelled) return;
        setDriveAccess({ accountId, status: "failed" });
        setDriveConnectError(cause instanceof Error ? cause.message : t("connectDriveError"));
        // Keep locally saved lessons usable; never report an unusable backup as enabled.
        setBackup(current =>
          current.accountId === accountId && current.enabled
            ? { ...current, enabled: false }
            : current,
        );
      });
    return () => {
      cancelled = true;
    };
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
    } finally {
      setStorageBusy(false);
    }
  }

  async function connectDrive(): Promise<void> {
    setStorageBusy(true);
    setError("");
    setDriveConnectError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveConnect" });
      if (response.type !== "driveConnected") throw new Error("Unexpected Google account response");
      setDriveAccounts(current => [
        ...current.filter(item => item.id !== response.account.id),
        response.account,
      ]);
      // OAuth proves identity, not Drive API access. Do not turn backup on
      // until an actual request to the selected Drive account succeeds.
      const verified = await nativeOnce({
        id: crypto.randomUUID(),
        type: "driveValidate",
        accountId: response.account.id,
      });
      if (verified.type !== "driveValidated")
        throw new Error("Google Drive access could not be verified.");
      setDriveAccess({ accountId: response.account.id, status: "verified" });
      setBackup({ enabled: true, accountId: response.account.id });
      setDriveConnectError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("connectDriveError");
      setError(message);
      setDriveConnectError(message);
    } finally {
      setStorageBusy(false);
    }
  }

  async function disconnectDrive(accountId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "driveDisconnect",
        accountId,
      });
      if (response.type !== "driveDisconnected") throw new Error("Unexpected Drive response");
      const remaining = driveAccounts.filter(item => item.id !== accountId);
      setDriveAccounts(remaining);
      setBackup(current =>
        current.accountId === accountId ? { enabled: false, accountId: remaining[0]?.id } : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("connectDriveError"));
    } finally {
      setStorageBusy(false);
    }
  }

  async function enableBackup(): Promise<void> {
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) {
      await connectDrive();
      return;
    }
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "driveValidate",
        accountId,
      });
      if (response.type !== "driveValidated")
        throw new Error("Unexpected Drive validation response");
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
    } finally {
      setStorageBusy(false);
    }
  }

  const listEndedJobs = useCallback(async (): Promise<JobSummary[]> => {
    const response = await nativeOnce({ id: crypto.randomUUID(), type: "listEndedJobs" });
    if (response.type !== "jobs") throw new Error("Unexpected task history response");
    return response.jobs;
  }, []);

  async function deleteJobRecords(jobIds: string[]) {
    const response = await nativeOnce({
      id: crypto.randomUUID(),
      type: "deleteJobHistory",
      jobIds,
    });
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
    } finally {
      setStorageBusy(false);
    }
  }

  async function retryPublication(jobId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "publishJob", jobId });
      if (response.type === "publicationFailed") throw new Error(response.message);
      if (response.type !== "published") throw new Error("Unexpected publication response");
      setProgress(t("publishedTo", { location: response.location }));
      loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("publicationError"));
    } finally {
      setStorageBusy(false);
    }
  }

  function cancelDuplicate(): void {
    generationSession.dismissDuplicate();
  }

  function updateAgent(next: AgentSettings): void {
    next = { provider: next.provider, modelId: next.modelId, thinkingLevel: next.thinkingLevel };
    setAgent(next);
    setProviderSettings(previous => ({
      ...previous,
      [next.provider]: { modelId: next.modelId, thinkingLevel: next.thinkingLevel },
    }));
    setAgentModelPreferences(previous => ({
      ...previous,
      [agentModelPreferenceKey(next.provider)]: next.modelId,
    }));
  }

  function selectAgent(provider: string): void {
    if (!isPiProviderId(provider)) return;
    const previous = providerSettings[provider];
    updateAgent({
      provider,
      thinkingLevel: previous?.thinkingLevel,
      modelId: savedAgentModel(provider, agentModelPreferences, previous?.modelId ?? ""),
    });
  }

  function checkHost(manual = false): void {
    if (hostCheckInFlight.current) return;
    hostCheckInFlight.current = true;
    if (manual) toast.dismiss("host-connection-check");
    setHostStatus("");
    setHostBusy(true);
    // Keep manual checks visible for at least 500 ms while the Host request runs immediately.
    const minimumAnimation = manual
      ? new Promise<void>(resolve => setTimeout(resolve, 500))
      : Promise.resolve();
    void nativeOnce({ id: crypto.randomUUID(), type: "health" })
      .finally(() => minimumAnimation)
      .then(message => {
        if (message.type !== "health") throw new Error("Unexpected Host health response");
        const providers = message.agents.filter(entry => isPiProviderId(entry.id));
        setInstalled(
          Object.fromEntries(
            Object.entries(message.installed).filter(([id]) => isPiProviderId(id)),
          ),
        );
        setHostVersion(message.version ?? null);
        setHostSdkMode(message.agentMode === "pi-sdk");
        setHostProtocolVersion(message.protocolVersion ?? null);
        if (manual) {
          const options = { id: "host-connection-check", duration: 4000 };
          if (message.version !== chrome.runtime.getManifest().version) {
            toast.warning(hostUi.mismatch, options);
          } else if (message.protocolVersion !== HOST_PROTOCOL_VERSION) {
            toast.warning(hostUi.protocolMismatch, options);
          } else if (message.agentMode !== "pi-sdk") {
            toast.warning(hostUi.unsupportedMode, options);
          } else {
            toast.success(hostUi.checkSucceeded, options);
          }
        }
        setAgentCatalog(providers);
        setAgent(current =>
          current.provider && !providers.some(entry => entry.id === current.provider)
            ? DEFAULT_AGENT
            : current,
        );
      })
      .catch(() => {
        setInstalled(null);
        setHostVersion(null);
        setHostSdkMode(false);
        setHostProtocolVersion(null);
        setHostStatus(hostUi.connectionFailed);
        if (manual)
          toast.error(hostUi.connectionFailed, { id: "host-connection-check", duration: 4000 });
      })
      .finally(() => {
        setHostChecked(true);
        setHostLastCheckedAt(Date.now());
        setHostBusy(false);
        hostCheckInFlight.current = false;
      });
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
      setModelNotice(piCopy[uiLocale].empty);
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
      id: crypto.randomUUID(),
      type: "agentModels",
      settings: { provider: agent.provider, modelId: "" },
    })
      .then(response => {
        if (ignore) return;
        if (response.type !== "agentModels") throw new Error("Unexpected model catalog response.");
        setModelOptions(response.models);
        setModelNotice(response.notice ?? "");
      })
      .catch(cause => {
        if (!ignore) {
          setModelOptions([]);
          setModelNotice(cause instanceof Error ? cause.message : t("modelsError"));
        }
      })
      .finally(() => {
        if (!ignore)
          settleTimer = window.setTimeout(
            () => {
              if (!ignore) setModelBusy(false);
            },
            Math.max(0, 500 - (performance.now() - startedAt)),
          );
      });
    return () => {
      ignore = true;
      window.clearTimeout(settleTimer);
    };
  }, [hydrated, installed, hostReady, agent.provider, modelRefreshVersion]);

  function receiveGeneratedDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    setProgress(t("statusSaved"));
    setPage(current => (current === "create" ? "lessons" : current));
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
    documentId: string,
    cueId: string,
    range: { startMs: number; endMs: number } | null,
  ): Promise<void> {
    const response = await nativeOnce({
      id: crypto.randomUUID(),
      type: "savePlaybackRange",
      documentId,
      cueId,
      range,
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
    documentId: string,
    sceneId: string,
    range: { startMs: number; endMs: number } | null,
  ): Promise<void> {
    const response = await nativeOnce({
      id: crypto.randomUUID(),
      type: "saveScenePlaybackRange",
      documentId,
      sceneId,
      range,
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
          provider: agentDisplayName(
            summary.provider,
            agentCatalog.find(item => item.id === summary.provider)?.label,
          ),
          status: t(jobStatusKeys[summary.status]),
          completed: summary.completed,
          total: summary.total,
        });
  }

  function updateJob(summary: JobSummary): void {
    setJobs(previous =>
      [summary, ...previous.filter(job => job.id !== summary.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
    if (summary.id === lastJobIdRef.current) {
      lastJobSummaryRef.current = summary;
      setProgress(jobStatusLine(summary));
    }
  }

  function runGeneration(input: { type: "resume"; jobId: string }): void {
    if (generating) return;
    setError("");
    setPage("create");
    setProgress(t("statusResuming"));
    generationSession.resume(input.jobId);
  }

  function startGeneration(): void {
    if (checking || generating) return;
    if (!hostReady) {
      setError(installed === null ? piCopy[uiLocale].unavailable : hostUi.unsupportedMode);
      setSettingsSection("advanced");
      setPage("settings");
      return;
    }
    if (
      !isPiProviderId(generationAgent.provider) ||
      installed?.[generationAgent.provider] !== true
    ) {
      setError(piCopy[uiLocale].empty);
      setSettingsSection("ai");
      setPage("settings");
      return;
    }
    if (subtitleBusy || !captionsReady) {
      setError(
        subtitleMessage(subtitleUi.languageNotReady, {
          language: learningLanguageName(profile.targetLanguage, uiLocale),
        }),
      );
      return;
    }
    if (backup.enabled && !driveAccessVerified) {
      setError(t("driveAccessNotVerified"));
      return;
    }
    setError("");
    cancelDuplicate();
    setBackupStatus("");
    try {
      const payload = buildGenerationRequest({
        source: {
          platform,
          title: title.trim(),
          ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}),
        },
        profile,
        agent: generationAgent,
        destination,
        backup,
        cues,
      });
      setProgress(t("checkingExisting"));
      generationSession.start(payload);
    } catch (cause) {
      setChecking(false);
      setError(cause instanceof Error ? cause.message : t("errorGenerationSettings"));
    }
  }

  function confirmRegeneration(): void {
    generationSession.confirmRegeneration();
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
          const cloud = await nativeOnce({
            id: crypto.randomUUID(),
            type: "listDriveLessons",
            accountId,
          });
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
      if (version === catalogLoadIdRef.current)
        setCatalogError(cause instanceof Error ? cause.message : t("lessonCatalogError"));
    } finally {
      if (version === catalogLoadIdRef.current) setLessonsBusy(false);
    }
  }

  async function restoreLesson(lesson: DriveLessonSummary): Promise<void> {
    setRestoreBusy(lesson.documentId);
    setCatalogError("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "restoreDriveLesson",
        accountId: lesson.accountId,
        documentId: lesson.documentId,
      });
      if (response.type !== "driveRestored") throw new Error("Unexpected restore response");
      await loadLessons();
      openSavedDocument(response.documentId);
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : t("lessonRestoreError"));
    } finally {
      setRestoreBusy(null);
    }
  }

  async function backupExistingLessons(): Promise<void> {
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) {
      await connectDrive();
      return;
    }
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "backupExisting",
        accountId,
      });
      if (response.type !== "backupsScheduled") throw new Error("Unexpected backup response");
      setBackupStatus(t("existingBackupsScheduled", { count: response.count }));
      generationSession.resumeBackups();
      void loadJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("publicationError"));
    } finally {
      setStorageBusy(false);
    }
  }

  function loadJobs(): void {
    if (loadingJobs) return;
    setLoadingJobs(true);
    void nativeOnce({ id: crypto.randomUUID(), type: "listJobs" })
      .then(message => {
        if (message.type !== "jobs") throw new Error("Unexpected job history response");
        setJobs(message.jobs);
        const current = message.jobs.find(job => job.id === lastJobIdRef.current);
        if (current) updateJob(current);
      })
      .catch(error => setError(String(error)))
      .finally(() => setLoadingJobs(false));
  }

  function fetchSavedDocument(
    documentId: string,
    handle: (document: LearningDocument) => void,
  ): void {
    if (generating) return;
    setError("");
    setGenerating(true);
    void getDocument(documentId)
      .then(handle)
      .catch(error => setError(String(error)))
      .finally(() => setGenerating(false));
  }

  useEffect(() => {
    if (!hydrated) return;
    const route = new URLSearchParams(window.location.search);
    const lesson = route.get("lesson");
    if (lesson && hostReady) {
      openSavedDocument(lesson);
      window.history.replaceState(null, "", window.location.pathname);
    } else if (route.has("activity")) {
      setPage("activity");
      loadJobs();
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [hydrated, hostReady]);

  function openSavedDocument(documentId: string): void {
    fetchSavedDocument(documentId, showDocument);
  }

  useEffect(() => {
    generationSession.invalidatePreflight();
  }, [raw, title, sourceUrl, profile, generationAgent, destination, backup]);

  function cancelGeneration(): void {
    generationSession.cancel();
    setProgress(t("statusCancelling"));
  }

  const fetchCurrentVideoMetadata = () => subtitleDraft.fetchMetadata();
  const fetchCurrentSubtitles = () => subtitleDraft.fetchSubtitles();
  const reloadVideoReader = () => subtitleDraft.reloadReader();
  const usePastedSubtitles = (text: string) => subtitleDraft.importText(text);
  const onFile = (file: File | undefined) => subtitleDraft.importFile(file);
  function chooseLearningLanguage(next: string) {
    const language = LEARNING_LANGUAGES.find(value => value === next);
    if (!language || checking || generating) return;
    subtitleDraft.setLanguage(language);
    setProfile(current => ({
      ...current,
      targetLanguage: language,
      level: defaultLevelForTargetLanguage(language),
    }));
  }

  const levelOptions = levelsForTargetLanguage(profile.targetLanguage);

  const activeJob = jobs.find(job => job.id === lastJobIdRef.current);
  useEffect(() => {
    if (page === "lessons") void loadLessons();
  }, [page, backup.accountId, driveAccounts.length]);

  return (
    <div
      className={
        "h-dvh flex flex-col overflow-hidden " +
        "mx-auto min-w-0 max-w-[780px] px-3 text-[13px] leading-[1.5] antialiased font-[Outfit,'Noto_Sans_TC',-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] [color-scheme:light] dark:[color-scheme:dark] [font-synthesis:none]"
      }
    >
      <header className="shrink-0 flex items-center justify-between gap-2 py-2.5 [&>div]:flex [&>div]:min-w-0 [&>div]:items-center [&>div]:gap-2 [&_strong]:min-w-0 [&_strong]:text-xs [&_strong]:leading-[1.25] [&_strong]:wrap-anywhere">
        <div>
          <img
            className="block size-7 shrink-0 rounded-[var(--radius)] object-contain"
            src={chrome.runtime.getURL("icons/icon48.png")}
            alt=""
          />
          <strong>Contextual Language Learning</strong>
        </div>
        <HeaderActions
          locale={uiLocale}
          page={page}
          attentionCount={jobs.filter(job => ["waiting", "failed"].includes(job.status)).length}
          onActivity={() => {
            if (page === "activity") return;
            if (page === "create" || page === "lessons" || page === "lesson") setReturnPage(page);
            setPage("activity");
            loadJobs();
          }}
          onSettings={() => {
            if (page === "create" || page === "lessons" || page === "lesson") setReturnPage(page);
            setSettingsSection(null);
            setPage("settings");
          }}
        />
      </header>
      <SidePanelNavigation page={page} onNavigate={setPage} t={t} />

      <NoticeViewport
        locale={uiLocale}
        videoRecovery={page === "create" && !generating ? undefined : videoRecovery}
        error={error}
        notice={notice}
        closeLabel={t("closeNotification")}
        regionLabel={t("notificationsRegion")}
        theme={resolveTheme(themePreference, systemDark)}
        dismiss={() => {
          setError("");
          setNotice("");
        }}
      />

      <div
        className={
          page === "lesson"
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-9"
        }
      >
        {page === "create" && (
          <main id="page-panel-create" aria-labelledby="page-nav-create" className="space-y-4 py-3">
            {generating ? (
              <GenerationStatus
                locale={uiLocale}
                job={activeJob}
                title={title}
                progress={progress}
                notificationsEnabled={analysisNotificationsEnabled}
                onLibrary={() => setPage("lessons")}
                onCancel={cancelGeneration}
              />
            ) : (
              <>
                <PageSection framed>
                  <h2>{flow.video}</h2>
                  <div className="min-w-0 border-b border-border pb-4">
                    <strong className="block text-sm wrap-anywhere">
                      {title || activeVideo?.title || flow.videoEmpty}
                    </strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {!activeVideo
                        ? flow.videoEntryHint
                        : getVideoAdapter(sourceUrl || activeVideo.url).id === "import"
                          ? t("providerImport")
                          : getVideoAdapter(sourceUrl || activeVideo.url).label}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={metadataBusy || subtitleBusy || checking}
                        onClick={() => void fetchCurrentVideoMetadata()}
                      >
                        {metadataBusy ? metadataUi.busy : flow.useVideo}
                      </Button>
                      {activeVideo && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={editingVideo}
                          onClick={() => setEditingVideo(value => !value)}
                        >
                          {editingVideo ? flow.done : flow.editVideoDetails}
                        </Button>
                      )}
                    </div>
                    {metadataStatus && (
                      <p className="my-2 text-xs text-muted-foreground" role="status">
                        {metadataStatus}
                      </p>
                    )}
                    {(editingVideo || !activeVideo) && (
                      <>
                        <label className="my-3 grid gap-[6px] text-xs font-semibold">
                          {t("videoTitle")}{" "}
                          <Input
                            value={title}
                            onChange={event => subtitleDraft.setTitle(event.target.value)}
                            placeholder={t("titlePlaceholder")}
                          />
                        </label>
                        <label className="my-3 grid gap-[6px] text-xs font-semibold">
                          {t("videoUrl")}{" "}
                          <Input
                            type="url"
                            value={sourceUrl}
                            onChange={event => subtitleDraft.setSource(event.target.value)}
                            placeholder="https://www.youtube.com/watch?v=…"
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <section
                    aria-label={subtitleLayout.heading}
                    data-ui="subtitleState"
                    data-state={subtitleState}
                    className="my-3 grid min-w-0 gap-2"
                  >
                    <h3 className="text-sm font-semibold">{subtitleLayout.heading}</h3>
                    <div
                      role={subtitleState === "error" ? "alert" : "status"}
                      className="grid gap-1 text-sm wrap-anywhere"
                    >
                      <p className="flex items-center gap-2 font-medium">
                        {subtitleState === "ready" && (
                          <Check aria-hidden="true" className="size-4 shrink-0" />
                        )}
                        {subtitleState === "loading" && (
                          <LoaderCircle
                            aria-hidden="true"
                            className="size-4 shrink-0 motion-safe:animate-spin"
                          />
                        )}
                        {subtitleState === "error" && (
                          <AlertCircle
                            aria-hidden="true"
                            className="size-4 shrink-0 text-destructive"
                          />
                        )}
                        {subtitleState === "ready"
                          ? learningLanguageName(profile.targetLanguage, uiLocale) +
                            " · " +
                            subtitleMessage(subtitleLayout.count, { count: cues.length })
                          : subtitleReaderBlocked
                            ? subtitleLayout.reloadNeeded
                            : subtitleState === "loading"
                              ? subtitleUi.busy
                              : subtitleState === "error"
                                ? subtitleLayout.failed
                                : subtitleLayout.empty}
                      </p>
                      {!subtitleReaderBlocked &&
                        (subtitleState === "loading" || subtitleState === "error") && (
                          <p className="text-xs text-muted-foreground">
                            {subtitleState === "loading"
                              ? subtitleMessage(subtitleUi.loadingLanguage, {
                                  language: learningLanguageName(profile.targetLanguage, uiLocale),
                                })
                              : subtitleStatus
                                ? typeof subtitleStatus === "string"
                                  ? subtitleStatus
                                  : subtitleFailureMessage(uiLocale, subtitleStatus)
                                : subtitleMessage(subtitleUi.languageNotReady, {
                                    language: learningLanguageName(
                                      profile.targetLanguage,
                                      uiLocale,
                                    ),
                                  })}
                          </p>
                        )}
                      {subtitleReaderBlocked && subtitleState === "ready" && (
                        <p className="text-xs text-muted-foreground">
                          {subtitleLayout.reloadNeeded}
                        </p>
                      )}
                      {videoRecovery.failed && (
                        <p className="text-xs text-destructive">{subtitleUi.reloadFailed}</p>
                      )}
                      {subtitleState === "ready" && captionSource?.origin === "manual" && (
                        <p className="text-xs text-muted-foreground">
                          {subtitleLayout.source}：
                          {fileName
                            ? fileName.split(".").pop()?.toUpperCase()
                            : subtitleLayout.paste}
                        </p>
                      )}
                    </div>
                    {subtitleState === "ready" && (
                      <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-expanded={subtitlePreview}
                            aria-controls="subtitle-preview"
                            onClick={() => setSubtitlePreview(value => !value)}
                          >
                            {subtitlePreview ? subtitleLayout.close : subtitleLayout.preview}
                          </Button>
                          {!subtitleReaderBlocked &&
                            (subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={
                                  subtitleReaderBlocked ||
                                  subtitleBusy ||
                                  metadataBusy ||
                                  checking ||
                                  generating
                                }
                                onClick={() => void fetchCurrentSubtitles()}
                              >
                                {subtitleBusy ? subtitleUi.busy : subtitleLayout.refresh}
                              </Button>
                            )}
                        </div>
                        {subtitlePreview && (
                          <ol
                            id="subtitle-preview"
                            aria-label={subtitleLayout.preview}
                            tabIndex={0}
                            className="grid max-h-64 gap-2 overflow-y-auto overscroll-contain rounded-[var(--radius)] border border-border p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {cues.map((cue, index) => (
                              <li key={index} className="flex min-w-0 items-start gap-3">
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {cue.startMs === null
                                    ? "—"
                                    : String(Math.floor(cue.startMs / 60000)).padStart(2, "0") +
                                      ":" +
                                      String(Math.floor(cue.startMs / 1000) % 60).padStart(2, "0")}
                                </span>
                                <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">
                                  {cue.originalText}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </>
                    )}
                  </section>
                  {(subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && (
                    <>
                      {!subtitleReaderBlocked && subtitleState !== "ready" && trackBusy && (
                        <p className="my-2 text-xs text-muted-foreground" role="status">
                          {subtitleUi.tracksChecking}
                        </p>
                      )}
                      {!subtitleReaderBlocked &&
                        subtitleState !== "ready" &&
                        !trackBusy &&
                        trackInfo?.status !== "unknown" &&
                        trackInfo?.sourceKey === videoSourceKey(sourceUrl) && (
                          <p
                            className="my-2 text-xs text-muted-foreground wrap-anywhere"
                            role="status"
                          >
                            {(() => {
                              const available = LEARNING_LANGUAGES.filter(language =>
                                trackInfo.tracks.some(track =>
                                  subtitleLanguageMatches(language, track.language),
                                ),
                              );
                              const names = available.map(
                                language =>
                                  learningLanguageName(language, uiLocale) +
                                  (trackInfo.tracks.some(
                                    track =>
                                      subtitleLanguageMatches(language, track.language) &&
                                      track.kind === "manual",
                                  )
                                    ? ""
                                    : " (" + subtitleUi.tracksAuto + ")"),
                              );
                              const summary = subtitleMessage(subtitleUi.tracksAvailable, {
                                languages: names.join("、") || subtitleUi.tracksNone,
                              });
                              return available.includes(profile.targetLanguage)
                                ? summary
                                : summary +
                                    " " +
                                    subtitleMessage(subtitleUi.tracksMissing, {
                                      language: learningLanguageName(
                                        profile.targetLanguage,
                                        uiLocale,
                                      ),
                                    });
                            })()}
                          </p>
                        )}

                      {!subtitleReaderBlocked && subtitleState !== "ready" && (
                        <Button
                          size="sm"
                          className="min-w-0 text-center leading-[1.4] whitespace-normal wrap-anywhere"
                          disabled={
                            subtitleReaderBlocked ||
                            subtitleBusy ||
                            metadataBusy ||
                            checking ||
                            generating
                          }
                          onClick={() => void fetchCurrentSubtitles()}
                        >
                          {subtitleBusy
                            ? subtitleUi.busy
                            : subtitleState === "error"
                              ? subtitleLayout.retry
                              : subtitleUi.button}
                        </Button>
                      )}
                      {(videoRecoveryUrl || videoRecovery.unavailable) && (
                        <div
                          className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                          data-ui="actions"
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              reloadingVideoTab ||
                              videoRecovery.busy ||
                              subtitleBusy ||
                              metadataBusy
                            }
                            onClick={() => {
                              if (videoRecovery.unavailable) {
                                subtitleDraft.clearRecovery();
                                void videoRecovery.reload();
                              } else void reloadVideoReader();
                            }}
                          >
                            {reloadingVideoTab || videoRecovery.busy
                              ? subtitleUi.reloadingTab
                              : subtitleLayout.reloadVideo}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  <Disclosure
                    className="mt-2 min-w-0 [&>div]:border-b-0"
                    key={subtitlePlatform + ":" + String(subtitleState === "error")}
                    defaultOpen={subtitleState === "error"}
                    title={<>{flow.otherSubtitles}</>}
                  >
                    {subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube" && (
                      <p
                        className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                        data-ui="hint"
                      >
                        {t("subtitleHint")}
                      </p>
                    )}
                    <SubtitleImport
                      value={
                        subtitlePasteDrafts[captionCacheKey(sourceUrl, profile.targetLanguage)] ??
                        (captionSource?.origin === "manual" && !fileName ? raw : "")
                      }
                      onValueChange={text => subtitleDraft.setPasteDraft(text)}
                      onFile={onFile}
                      onPaste={usePastedSubtitles}
                      disabled={subtitleBusy || checking || generating}
                      importedFileLabel={
                        fileName ? t("importedFile", { name: fileName }) : undefined
                      }
                      copy={{
                        hint: t("subtitleImportHint"),
                        fileTab: t("subtitleFileTab"),
                        pasteTab: t("subtitlePasteTab"),
                        fileHint: t("subtitleFileHint"),
                        fileButton: t("importSubtitleFile"),
                        pasteLabel: t("pasteSubtitles"),
                        pasteButton: t("usePastedSubtitles"),
                        placeholder: t("subtitlePlaceholder"),
                      }}
                    />
                  </Disclosure>
                </PageSection>

                <PageSection
                  framed
                  className="[&_[data-ui=hint]]:my-[4px_9px] [&_[data-ui=settingField]_[data-slot=select-trigger]]:min-h-8 [&_[data-ui=settingField]_[data-slot=select-trigger]]:w-full [&_[data-ui=advancedLessonSettings]]:mt-4 [&_[data-ui=advancedLessonSettings]>div]:border-b-0"
                >
                  <h2>{flow.learning}</h2>
                  <div className="my-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-4 gap-y-3 [&_[data-ui=settingField]]:m-0">
                    <div
                      className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full"
                      data-ui="settingField"
                    >
                      <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                        <label
                          className="m-0 min-w-0 text-xs font-semibold leading-5"
                          htmlFor="learning-target"
                        >
                          {t("targetLanguage")}
                        </label>
                        <SettingInfo
                          label={t("targetLanguage")}
                          infoLabel={settingsCopy.infoLabel}
                          explanation={settingsCopy.fieldHints.targetLanguage}
                        />
                      </div>
                      <SearchableSelectField
                        id="learning-target"
                        ariaLabel={t("targetLanguage")}
                        value={profile.targetLanguage}
                        onValueChange={chooseLearningLanguage}
                        disabled={checking || generating}
                        options={learningLanguageOptions(uiLocale)}
                        copy={LEARNING_LANGUAGE_SEARCH_COPY[uiLocale]}
                      />
                    </div>
                    <div
                      className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full"
                      data-ui="settingField"
                    >
                      <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                        <label
                          className="m-0 min-w-0 text-xs font-semibold leading-5"
                          htmlFor="learning-level"
                        >
                          {t("level")}
                        </label>
                        <SettingInfo
                          label={t("level")}
                          infoLabel={settingsCopy.infoLabel}
                          explanation={levelHint(settingsCopy, profile.targetLanguage)}
                          items={levelOptions.map(value => {
                            const info = settingsCopy.levels[profile.targetLanguage][value];
                            return {
                              value,
                              label: info?.label ?? value,
                              description: info?.description ?? "",
                            };
                          })}
                        />
                      </div>
                      <SelectField
                        id="learning-level"
                        ariaLabel={t("level")}
                        value={profile.level}
                        onValueChange={level => setProfile(current => ({ ...current, level }))}
                        options={levelOptions.map(level => ({
                          value: level,
                          label:
                            level +
                            " · " +
                            (settingsCopy.levels[profile.targetLanguage][level]?.label ?? level),
                        }))}
                      />
                    </div>
                    <div
                      className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full"
                      data-ui="settingField"
                    >
                      <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                        <label
                          className="m-0 min-w-0 text-xs font-semibold leading-5"
                          htmlFor="learning-length"
                        >
                          {t("lessonLength")}
                        </label>
                        <SettingInfo
                          label={t("lessonLength")}
                          infoLabel={settingsCopy.infoLabel}
                          explanation={t("lessonLengthHint")}
                        />
                      </div>
                      <SelectField
                        id="learning-length"
                        ariaLabel={t("lessonLength")}
                        value={String(profile.sceneCount)}
                        onValueChange={value =>
                          setProfile(current =>
                            contextualGenerationProfile({
                              ...current,
                              sceneCount: normalizeLessonLength(Number(value)),
                            }),
                          )
                        }
                        options={[
                          { value: "2", label: t("lessonLengthShort") },
                          { value: "4", label: t("lessonLengthStandard") },
                          { value: "6", label: t("lessonLengthRich") },
                        ]}
                      />
                    </div>
                    <div
                      className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full"
                      data-ui="settingField"
                    >
                      <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                        <label
                          className="m-0 min-w-0 text-xs font-semibold leading-5"
                          htmlFor="contextual-examples"
                        >
                          {t("contextualExamples")}
                        </label>
                        <SettingInfo
                          label={t("contextualExamples")}
                          infoLabel={settingsCopy.infoLabel}
                          explanation={t("contextualExamplesHint")}
                        />
                      </div>
                      <SelectField
                        id="contextual-examples"
                        ariaLabel={t("contextualExamples")}
                        value={String(profile.contextualExampleCount ?? 2)}
                        onValueChange={value =>
                          setProfile(current => ({
                            ...current,
                            contextualExampleCount: Number(value),
                          }))
                        }
                        options={[1, 2, 3].map(value => ({
                          value: String(value),
                          label: t("contextualExamplesValue", { count: value }),
                        }))}
                      />
                    </div>
                  </div>
                  <Disclosure
                    className="my-2 min-w-0"
                    data-ui="advancedLessonSettings"
                    title={<>{t("advancedLessonSettings")}</>}
                  >
                    <div
                      className="relative my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full only:col-span-full"
                      data-ui="settingField"
                    >
                      <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                        <label
                          className="m-0 min-w-0 text-xs font-semibold leading-5"
                          htmlFor="learning-explanation-language"
                        >
                          {t("instructionLanguage")}
                        </label>
                        <SettingInfo
                          label={t("instructionLanguage")}
                          infoLabel={settingsCopy.infoLabel}
                          explanation={settingsCopy.fieldHints.instructionLanguage}
                        />
                      </div>
                      <SelectField
                        id="learning-explanation-language"
                        ariaLabel={t("instructionLanguage")}
                        value={
                          explanationLanguageMode === "auto"
                            ? "__auto__"
                            : profile.instructionLanguage
                        }
                        onValueChange={value => {
                          if (value === "__auto__") {
                            setExplanationLanguageMode("auto");
                            setProfile(current => ({ ...current, instructionLanguage: uiLocale }));
                          } else {
                            setExplanationLanguageMode("custom");
                            setProfile(current => ({
                              ...current,
                              instructionLanguage: value as LearningProfile["instructionLanguage"],
                            }));
                          }
                        }}
                        options={[
                          { value: "__auto__", label: t("explanationAuto") },
                          ...EXPLANATION_LANGUAGES.map(value => ({
                            value,
                            label: explanationLanguageName(value, uiLocale),
                          })),
                        ]}
                      />
                    </div>
                  </Disclosure>
                </PageSection>

                <PageSection framed>
                  <h2>{flow.generate}</h2>
                  {duplicateWarning && (
                    <Alert
                      className="my-3 min-w-0 wrap-anywhere"
                      aria-label={t("duplicateConfirmLabel")}
                    >
                      <AlertTitle>
                        {t("duplicateFound", { count: duplicateWarning.matches.length })}
                      </AlertTitle>
                      <p
                        className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                        data-ui="hint"
                      >
                        {t("duplicateNewVersion")}
                      </p>
                      {duplicateWarning.matches.map(match => (
                        <div
                          className="mb-2 min-w-0 max-w-full rounded-[var(--radius)] border border-border p-3 text-[13px] wrap-anywhere [&_strong]:mr-2 [&_strong]:text-primary [&_p]:mt-[6px] [&_p]:text-xs [&_p]:text-muted-foreground"
                          key={match.documentId}
                        >
                          <strong>{match.title}</strong>
                          <p>
                            {new Date(match.createdAt).toLocaleString(uiLocale)} ·{" "}
                            {match.destination} ·{" "}
                            {t(match.exactSettings ? "sameSettings" : "differentSettings")}
                            {match.jobStatus ? " · " + match.jobStatus : ""}
                          </p>
                          <div
                            className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                            data-ui="actions"
                          >
                            {match.local && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  cancelDuplicate();
                                  openSavedDocument(match.documentId);
                                }}
                              >
                                {t("openExisting")}
                              </Button>
                            )}
                            {match.url && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void chrome.tabs.create({ url: match.url })}
                              >
                                {t("openInDrive")}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      <div
                        className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                        data-ui="actions"
                      >
                        <Button variant="destructive" size="sm" onClick={confirmRegeneration}>
                          {t("confirmNewVersion")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={cancelDuplicate}>
                          {t("cancelNoGeneration")}
                        </Button>
                      </div>
                    </Alert>
                  )}
                  <p className="mt-[10px] min-w-0 max-w-full rounded-[var(--radius)] border border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] p-[10px] text-xs text-foreground wrap-anywhere mt-[5px] mb-[14px]">
                    {t("lessonContentSummary", {
                      scenes: profile.sceneCount,
                      examples: profile.contextualExampleCount ?? 2,
                    })}
                  </p>
                  <GenerationService
                    locale={uiLocale}
                    selected={generationAgent}
                    providers={agentCatalog}
                    available={hostReady}
                    disabled={checking}
                    onReady={setGenerationServiceReady}
                    onConfigure={() => {
                      setReturnPage("create");
                      setSettingsSection("ai");
                      setPage("settings");
                    }}
                  />
                  <Button
                    className="h-auto min-h-9 w-full px-3 py-2 text-center text-xs font-semibold leading-[1.4] whitespace-normal wrap-anywhere"
                    onClick={startGeneration}
                    disabled={
                      !hostReady ||
                      !generationServiceReady ||
                      checking ||
                      subtitleBusy ||
                      !isPiProviderId(generationAgent.provider) ||
                      installed?.[generationAgent.provider] !== true ||
                      !captionsReady ||
                      !cues.length ||
                      !title.trim()
                    }
                  >
                    {(generating || checking) && (
                      <span
                        className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    )}
                    {checking ? t("checkingExistingShort") : t("create")}
                  </Button>
                </PageSection>
              </>
            )}
          </main>
        )}

        <main
          id={page === "lesson" ? undefined : "page-panel-lessons"}
          aria-labelledby="page-nav-lessons"
          hidden={page !== "lessons"}
        >
          {jobs
            .filter(job => ["running", "queued", "waiting", "failed"].includes(job.status))
            .sort(
              (a, b) =>
                Number(["running", "queued"].includes(b.status)) -
                Number(["running", "queued"].includes(a.status)),
            )
            .slice(0, 1)
            .map(job => (
              <GenerationStatus
                key={job.id}
                compact
                locale={uiLocale}
                job={job}
                title={job.sourceTitle}
                progress=""
                notificationsEnabled={analysisNotificationsEnabled}
                onLibrary={() => setPage("lessons")}
                onActivity={() => {
                  setReturnPage("lessons");
                  setPage("activity");
                  loadJobs();
                }}
                onResume={
                  hostReady &&
                  !generating &&
                  agentCatalog.some(provider => provider.id === job.provider && provider.installed)
                    ? () => runGeneration({ type: "resume", jobId: job.id })
                    : undefined
                }
              />
            ))}
          <VideoLibrary
            localLessons={localLessons}
            cloudLessons={cloudLessons}
            driveAccounts={driveAccounts}
            driveConfigured={driveConfigured}
            lessonsBusy={lessonsBusy}
            catalogError={catalogError}
            restoreBusy={restoreBusy}
            generating={generating}
            storageBusy={storageBusy}
            uiLocale={uiLocale}
            t={t}
            onRefresh={loadLessons}
            onConnectDrive={connectDrive}
            onOpen={openSavedDocument}
            onRestore={restoreLesson}
          />
        </main>

        {page === "activity" && (
          <main id="page-panel-activity" aria-labelledby="activity-title">
            <PageHeading
              id="activity-title"
              title={layout.activity}
              backLabel={layout.back}
              onBack={() => setPage(returnPage)}
            />
            <TaskHistory
              jobs={jobs}
              loadingJobs={loadingJobs}
              hostReady={hostReady}
              generating={generating}
              storageBusy={storageBusy}
              agentCatalog={agentCatalog}
              locale={uiLocale}
              onConfigure={() => {
                setSettingsSection("ai");
                setPage("settings");
              }}
              t={t}
              onRefresh={loadJobs}
              onResume={jobId => runGeneration({ type: "resume", jobId })}
              onOpen={openSavedDocument}
              onRetryPublication={retryPublication}
              onRetryBackup={retryBackup}
              onListEnded={listEndedJobs}
              onDeleteRecords={deleteJobRecords}
            />
          </main>
        )}

        {page === "settings" && (
          <main id="page-panel-settings" aria-label={t("settings")}>
            <PageHeading
              title={settingsSection ? layout[settingsSection] : t("settings")}
              backLabel={layout.back}
              onBack={() => (settingsSection ? setSettingsSection(null) : setPage(returnPage))}
            />
            {!settingsSection && (
              <PageSection>
                <nav aria-label={t("settings")} className="mt-2 grid divide-y divide-border">
                  {(["general", "ai", "storage", "advanced"] as const).map(section => (
                    <Button
                      key={section}
                      variant="ghost"
                      className="h-auto min-h-12 justify-between rounded-none px-1 py-2.5 text-left"
                      onClick={() => setSettingsSection(section)}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold">{layout[section]}</span>
                        <span className="mt-0.5 block whitespace-normal text-[11px] text-muted-foreground">
                          {section === "ai" && agent.provider
                            ? agentDisplayName(
                                agent.provider,
                                agentCatalog.find(provider => provider.id === agent.provider)
                                  ?.label,
                              ) + (agent.modelId ? " · " + agent.modelId : "")
                            : section === "storage"
                              ? backup.enabled
                                ? layout.storageHint
                                : t("localCopy")
                              : layout[(section + "Hint") as "generalHint"]}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    </Button>
                  ))}
                </nav>
              </PageSection>
            )}

            {settingsSection === "general" && (
              <PageSection>
                <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
                  <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                    <label
                      className="m-0 min-w-0 text-xs font-semibold leading-5"
                      htmlFor="ui-language-select"
                    >
                      {t("uiLanguage")}
                    </label>
                  </div>
                  <Select
                    value={localePreference}
                    onValueChange={next => {
                      if (isLocalePreference(next)) setLocalePreference(next);
                    }}
                  >
                    <SelectTrigger
                      id="ui-language-select"
                      aria-label={t("uiLanguage")}
                      aria-describedby="ui-language-hint"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t("browserLanguage")} · {nativeLanguageName(browserLocale)}
                      </SelectItem>
                      <SelectItem value="en">{nativeLanguageName("en")}</SelectItem>
                      <SelectItem value="zh-TW">{nativeLanguageName("zh-TW")}</SelectItem>
                      <SelectItem value="zh-CN">{nativeLanguageName("zh-CN")}</SelectItem>
                      <SelectItem value="ja">{nativeLanguageName("ja")}</SelectItem>
                      <SelectItem value="ko">{nativeLanguageName("ko")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p id="ui-language-hint" className="mt-2 text-sm text-muted-foreground">
                    {t("uiLanguageHint")}
                  </p>
                </div>
                <div className="my-3 min-w-0 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full">
                  <div className="relative mb-[6px] flex min-w-0 items-center gap-2">
                    <label
                      className="m-0 min-w-0 text-xs font-semibold leading-5"
                      htmlFor="appearance-select"
                    >
                      {t("appearance")}
                    </label>
                  </div>
                  <Select
                    value={themePreference}
                    onValueChange={next => {
                      if (isThemePreference(next)) setThemePreference(next);
                    }}
                  >
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
                <NotificationSettings
                  locale={uiLocale}
                  completed={analysisNotificationsEnabled}
                  attention={attentionNotificationsEnabled}
                  onCompleted={setAnalysisNotificationsEnabled}
                  onAttention={setAttentionNotificationsEnabled}
                />
              </PageSection>
            )}
            {settingsSection === "ai" && (
              <PageSection>
                <div>
                  <h2 id="agent-settings-heading" tabIndex={-1}>
                    {piCopy[uiLocale].title}
                  </h2>
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                  >
                    {piCopy[uiLocale].hint}
                  </p>
                  <AiModelSelection
                    locale={uiLocale}
                    id="settings"
                    provider={agent.provider}
                    modelId={agent.modelId}
                    providers={agentCatalog}
                    models={modelOptions}
                    available={hostReady && !generating}
                    busy={modelBusy}
                    notice={modelNotice}
                    onProvider={selectAgent}
                    onModel={modelId =>
                      updateAgent({ ...agent, modelId, thinkingLevel: undefined })
                    }
                    thinkingLevel={agent.thinkingLevel}
                    onThinking={thinkingLevel => updateAgent({ ...agent, thinkingLevel })}
                    onRefresh={() => {
                      setModelBusy(true);
                      setModelRefreshVersion(current => current + 1);
                    }}
                  />
                </div>
                <PiSettings
                  locale={uiLocale}
                  available={hostReady}
                  selectedProvider={agent.provider}
                  onSelect={selectAgent}
                  onChanged={checkHost}
                />
              </PageSection>
            )}
            {settingsSection === "storage" && (
              <PageSection>
                <label className="my-3 grid gap-[6px] text-xs font-semibold">
                  {t("storageLocation")}
                </label>
                <p
                  className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                  data-ui="hint"
                >
                  {t("currentFolder", {
                    path:
                      destination.kind === "local"
                        ? (destination.directory ?? t("defaultFolder"))
                        : t("defaultFolder"),
                  })}
                </p>
                <div
                  className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                  data-ui="actions"
                >
                  <Button
                    variant="outline"
                    disabled={storageBusy || generating}
                    onClick={() => void chooseFolder()}
                  >
                    {t("chooseFolder")}
                  </Button>
                  {destination.kind === "local" && destination.directory && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDestination({ kind: "local" })}
                    >
                      {t("useDefaultFolder")}
                    </Button>
                  )}
                </div>
                <p
                  className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                  data-ui="hint"
                >
                  {t("localAlways")}
                </p>
                <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">Google Drive</h3>
                  <IconTooltip
                    label={driveFolderUrl ? t("manageDrive") : t("driveAccessNotVerified")}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t("manageDrive")}
                      disabled={!driveFolderUrl}
                      onClick={() =>
                        driveFolderUrl && void chrome.tabs.create({ url: driveFolderUrl })
                      }
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </Button>
                  </IconTooltip>
                </div>
                <div className="my-[12px_4px] flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 text-[13px] [&_[data-ui=hint]]:mt-1 [&_[data-ui=hint]]:mb-0">
                    <strong>{t("autoBackup")}</strong>
                    <p
                      className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                      data-ui="hint"
                    >
                      {t("backupHint")}
                    </p>
                  </div>
                  <Switch
                    checked={backup.enabled}
                    aria-label={t("autoBackup")}
                    disabled={storageBusy}
                    onCheckedChange={enabled =>
                      enabled
                        ? void enableBackup()
                        : setBackup(current => ({ ...current, enabled: false }))
                    }
                  />
                </div>
                {backup.enabled && driveAccessVerified && (
                  <div className="flex items-center justify-between gap-2 [&_[data-ui=hint]]:my-[3px] [&_[data-ui=hint]]:min-w-0 [&_[data-ui=hint]]:wrap-anywhere">
                    <span
                      className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                      data-ui="hint"
                    >
                      {t("backupConnected", {
                        email:
                          driveAccounts.find(account => account.id === backup.accountId)?.email ??
                          t("backupUnknownAccount"),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSettingsSection("storage");
                        setPage("settings");
                      }}
                    >
                      {t("manageDrive")}
                    </Button>
                  </div>
                )}
                {!backup.enabled && !driveAccounts.length && driveConfigured && (
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                  >
                    {t("backupConnectToEnable")}
                  </p>
                )}
                {driveConnectError && (
                  <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">
                    {driveConnectError}
                  </p>
                )}
                {backupStatus && (
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                    role="status"
                  >
                    {backupStatus}
                  </p>
                )}
                <p
                  className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                  data-ui="hint"
                >
                  {t("driveOauthHelp")}
                </p>
                {!driveConfigured && (
                  <p className="my-3 min-w-0 max-w-full rounded-[var(--radius)] border border-dashed border-border bg-muted p-3 text-xs leading-[1.6] text-muted-foreground wrap-anywhere">
                    {t("oauthFirst")}
                  </p>
                )}
                {driveAccounts.length === 1 && (
                  <div className="my-3 flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius)] border border-border px-[11px] py-[10px] [&>div]:min-w-0 [&_strong]:block [&_strong]:text-xs [&_strong]:wrap-anywhere [&_[data-ui=hint]]:mt-[2px] [&_[data-ui=hint]]:mb-0 [&_[data-ui=hint]]:block">
                    <div>
                      <strong>{driveAccounts[0].email}</strong>
                      <span
                        className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                        data-ui="hint"
                      >
                        {t("backupAccount")}
                      </span>
                    </div>
                    <Badge>{t("driveConnectedStatus")}</Badge>
                  </div>
                )}
                {driveAccounts.length > 1 && (
                  <label className="my-3 grid gap-[6px] text-xs font-semibold">
                    {t("backupAccount")}
                    <SelectField
                      ariaLabel={t("backupAccount")}
                      value={backup.accountId ?? driveAccounts[0].id}
                      onValueChange={accountId => setBackup(current => ({ ...current, accountId }))}
                      options={driveAccounts.map(account => ({
                        value: account.id,
                        label: account.email,
                      }))}
                    />
                  </label>
                )}
                {selectedDriveId && (
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                    role="status"
                  >
                    {driveAccess?.accountId === selectedDriveId && driveAccess.status === "checking"
                      ? t("driveAccessChecking")
                      : driveAccessVerified
                        ? t("driveAccessVerified")
                        : t("driveAccessNotVerified")}
                  </p>
                )}
                <div
                  className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                  data-ui="actions"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={storageBusy || !driveConfigured}
                    onClick={() => void connectDrive()}
                  >
                    {driveAccounts.length ? t("connectAnother") : t("connectGoogle")}
                  </Button>
                  {selectedDriveId && !driveAccessVerified && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={storageBusy || driveAccess?.status === "checking"}
                      onClick={() => void enableBackup()}
                    >
                      {t("retryDriveAccess")}
                    </Button>
                  )}
                </div>
                {driveAccounts.length > 0 && (
                  <Disclosure
                    className="my-2 min-w-0"
                    data-ui="driveAccountsAdvanced"
                    title={
                      <>
                        {t("manageDrive")} · {driveAccounts.length}
                      </>
                    }
                  >
                    <div className="mt-[10px] grid gap-[5px]">
                      {driveAccounts.map(account => (
                        <div
                          className="flex min-w-0 items-center justify-between gap-2 py-[5px] not-first:border-t not-first:border-border [&_span]:min-w-0 [&_span]:text-xs [&_span]:wrap-anywhere"
                          key={account.id}
                        >
                          <span title={account.email}>{account.email}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={storageBusy}
                            onClick={() => void disconnectDrive(account.id)}
                          >
                            {t("disconnectGoogle")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                )}
                {driveAccounts.length > 0 && (
                  <section className="mt-[14px] grid justify-items-start gap-1 border-t border-border pt-3 [&_strong]:text-xs [&_[data-ui=hint]]:mt-0 [&_[data-ui=hint]]:mb-[5px]">
                    <strong>{t("backupExisting")}</strong>
                    <p role="status" className="text-xs text-muted-foreground">
                      {layout.backupResults
                        .replace("{success}", String(backupDone.length))
                        .replace("{failed}", String(backupFailed.length))
                        .replace(
                          "{pending}",
                          String(
                            backupJobs.filter(job =>
                              ["pending", "uploading"].includes(job.backup?.status ?? ""),
                            ).length,
                          ),
                        )}
                      {lastBackupAt ? ` · ${new Date(lastBackupAt).toLocaleString(uiLocale)}` : ""}
                    </p>
                    {backupFailed.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={storageBusy}
                        onClick={() => void backupExistingLessons()}
                      >
                        {t("retryBackup")}
                      </Button>
                    )}

                    <p
                      className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                      data-ui="hint"
                    >
                      {t("backupExistingHint")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={storageBusy || !driveAccounts.length}
                      onClick={() => void backupExistingLessons()}
                    >
                      {t("backupExisting")}
                    </Button>
                  </section>
                )}
                {driveConnectError && (
                  <p className="my-[5px] text-[11px] text-destructive wrap-anywhere" role="status">
                    {driveConnectError}
                  </p>
                )}
                {backupStatus && (
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                    role="status"
                  >
                    {backupStatus}
                  </p>
                )}
              </PageSection>
            )}
            {settingsSection === "advanced" && (
              <PageSection>
                <p className="my-3 text-xs text-muted-foreground">{layout.hostHelp}</p>
                <HostConnectionSettings
                  locale={uiLocale}
                  connected={installed !== null}
                  checked={hostChecked}
                  sdkMode={hostSdkMode}
                  protocolVersion={hostProtocolVersion}
                  version={hostVersion}
                  busy={hostBusy}
                  lastCheckedAt={hostLastCheckedAt}
                  error={hostStatus}
                  onCheck={() => checkHost(true)}
                />
              </PageSection>
            )}
          </main>
        )}

        {page === "lesson" && (
          <main
            className="flex min-h-0 flex-1 flex-col"
            id="page-panel-lessons"
            aria-labelledby="page-nav-lessons"
          >
            <Button variant="ghost" size="sm" className="mb-2" onClick={() => setPage("lessons")}>
              {t("lessonLibrary")}
            </Button>
            {document ? (
              <ContextualSceneReader
                key={document.id}
                document={document}
                adapter={readerAdapter}
                locale={uiLocale}
                repeat={repeat}
                setRepeat={setRepeat}
                delay={delay}
                setDelay={setDelay}
                sceneRepeat={sceneRepeat}
                setSceneRepeat={setSceneRepeat}
                sceneDelay={sceneDelay}
                setSceneDelay={setSceneDelay}
                playbackRate={playbackRate}
                setPlaybackRate={setPlaybackRate}
                onError={setError}
                onNotice={setNotice}
                onSaveRange={(cueId, range) => saveDocumentPlaybackRange(document.id, cueId, range)}
                onSaveSceneRange={(sceneId, range) =>
                  saveDocumentScenePlaybackRange(document.id, sceneId, range)
                }
              />
            ) : (
              <AppPanel>
                <h2>{t("emptyHeading")}</h2>
                <Button variant="outline" onClick={() => setPage("lessons")}>
                  {t("lessonLibrary")}
                </Button>
              </AppPanel>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
