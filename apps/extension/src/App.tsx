import { rememberCustomModelId } from "./lib/custom-models";
import { FavoritesLibrary } from "./components/favorites-library";
import { getFavoritesStore } from "./lib/favorites-store";
import { sameFavoriteCollection } from "./native/favorite-chunks";
import { favoritesCopy } from "./i18n/favorites";
import { ContextualSceneReader } from "./components/contextual-scene-reader";
import { getJobPreview, type JobPreviewInfo } from "./native/host-client";
import { createPreviewSession } from "./native/preview-session";
import { generationPreviewCopy } from "./i18n/generation-preview";
import { VideoLibrary } from "./components/video-library";
import { NOTIFICATION_ROUTE_KEY } from "./native/notification-navigation";
import { wasOperationCancelled } from "./lib/operation-cancellation";
import { DriveAccountMismatchError } from "./lib/drive-reconnection";
import { notificationDestination } from "./native/analysis-notifications";
import { useCreateFlow } from "./hooks/use-create-flow";
import { CreateFrame } from "./components/create-frame";
import { AppearancePreferences } from "./components/appearance-preferences";
import { connectDriveAndVerify } from "./lib/drive-connection";
import { useJobHistoryRefresh } from "./hooks/use-job-history-refresh";
import { VideoMetadataButton } from "./components/video-metadata-button";
import { ActionFeedbackButton } from "./components/action-feedback-button";
import { backupFeedbackResult, isRetiredBackup } from "./lib/backup-feedback";
import { SystemSpeechProvider } from "./components/system-speech";
import {
  SpeechDownloadsProvider,
  useSpeechDownloads,
  useSpeechDownloadSnapshot,
} from "./components/speech-downloads-provider";
import { isSpeechDownloadActive, type SpeechDownloadTask } from "@contextual/core";
import { speechDownloadTaskText } from "./i18n/speech-download-task";
import { speechDownloadCopy } from "./i18n/speech-downloads";
import { RequestBackupSwitch } from "./components/request-backup-switch";
import { RequestFolderSelection } from "./components/request-folder-selection";
import { backupSettingsCopy } from "./i18n/backup-settings";
import { CancellationNotice } from "./components/cancellation-notice";
import { RequestModelSelection } from "./components/request-model-selection";
import { GenerationEstimate } from "./components/generation-estimate";
import { createFlowCopy } from "./i18n/create-flow";
import { Sheet, SheetContent, SheetTitle, SheetTitleRow } from "./components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { cleanVideoTitle } from "./video/metadata";
import { subtitleLayoutCopy } from "./i18n/subtitle-layout";
import { useSubtitleDraft } from "./hooks/use-subtitle-draft";
import { useVideoConnection } from "./hooks/use-video-connection";
import { usePlatformVideoNotice } from "./hooks/use-platform-video-notice";
import {
  VideoConnectionNotice,
  VideoConnectionReloadButton,
} from "./components/video-connection-notice";
import { IconTooltip, restoreFocusWithoutTooltip } from "./components/icon-tooltip";
import { AnalysisRangePicker } from "./components/analysis-range";
import { analysisRangeCopy } from "./i18n/analysis-range";
import { CustomPrompt } from "./components/custom-prompt";
import { exportMarkdown } from "./lib/export-markdown";
import { DeferredView, deferView } from "./components/deferred-view";
import { ExecutionDetails } from "./components/execution-details";
import { customContentCopy } from "./i18n/custom-content";
import { Dialog, DialogContent, DialogHeader, DialogDescription } from "./components/ui/dialog";
import { DialogTitleBar } from "./components/dialog-title-bar";
import { HeaderActions } from "./components/header-actions";
import { PageHeading } from "./components/page-heading";
import { PageSection } from "./components/page-section";
import { activityCopy } from "./i18n/activity";
import { sidePanelLayoutCopy } from "./i18n/side-panel-layout";
import { settingsLayoutCopy } from "./i18n/settings-layout";
import { motionCopy } from "./i18n/motion";
import { type MotionPreference } from "./lib/motion";
import { useContentMotion, useMotionPreference } from "./hooks/use-content-motion";
import { NotificationSettings } from "./components/notification-settings";
import {
  ArrowLeft,
  ChevronRight,
  Check,
  LoaderCircle,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { piFeedback } from "./i18n/pi-feedback";
import { SubtitleImport } from "./components/subtitle-import";
import { Switch } from "./components/ui/switch";
import { Alert, AlertTitle } from "./components/ui/alert";
import { Disclosure } from "./components/disclosure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  withSentenceTiming,
  favoriteReaderDocument,
  customFavoriteReaderDocument,
  type CustomFavoriteSnapshot,
  type FavoriteSnapshot,
  type FavoriteSummary,
  type FavoriteReaderDocument,
  CustomGenerationRequestSchema,
  type CustomDocument,
  type CustomContentSummary,
  type CustomDriveSummary,
  type ExecutionMetadata,
  LearningDocumentSchema,
  HOST_PROTOCOL_VERSION,
  LEARNING_LANGUAGES,
  type LearningLanguage,
  levelsForTargetLanguage,
  UNRESTRICTED_LEVEL,
  defaultLevelForTargetLanguage,
  type AgentInfo,
  type AgentModel,
  type JobSummary,
  type BackupSettings,
  type Destination,
  type DriveAccount,
  type DriveLessonSummary,
  type LessonSummary,
  type AgentSettings,
  type HostMessage,
  type LearningDocument,
  type LearningProfile,
} from "@contextual/core";
import { getVideoAdapter } from "./video";
import { contextualGenerationProfile, normalizeLessonLength } from "./lib/contextual-profile";
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
import { getActiveWindowTab, openOrFocusVideoTab } from "./video/tab";
import {
  getDocument,
  getFavorite,
  getCustomResource,
  nativeOnce as sendHostRequest,
  type OnceRequest,
} from "./native/host-client";
import { AiModelSelection } from "./components/ai-model-selection";
import { agentDisplayName } from "./i18n/agent-display";
import { piCopy } from "./i18n/pi";
import { HostConnectionSettings } from "./components/host-connection-settings";
import { hostConnectionCopy } from "./i18n/host-connection";
import { isPiProviderId } from "./agent-selection";
import { GenerationSession, type GenerationState } from "./native/generation-session";
import { AlertCircle } from "lucide-react";
import { SidePanelNavigation, type SidePanelPage } from "./components/side-panel-navigation";
import { Button } from "./components/ui/button";
import { AppPanel } from "./components/app-panel";
import { TaskHistory, jobStatusKeys } from "./components/task-history";
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
import { NoticeViewport } from "./components/notice-viewport";
import { toast } from "sonner";
import { SettingInfo } from "./components/setting-info";
import { learningSettingsCopy, levelHint, learningLevelLabel } from "./i18n/learning-settings";
import { agentModelPreferenceKey, savedAgentModel } from "./i18n/agent-model-preferences";
import { translate, type MessageKey, type MessageParams } from "./i18n/messages";
import {
  getBrowserLocale,
  resolveTheme,
  learningLanguageName,
  learningLanguageOptions,
  explanationLanguageName,
  LEARNING_LANGUAGE_SEARCH_COPY,
  type LocalePreference,
  type ThemePreference,
} from "./i18n/preferences";

import { getPreferencesStore } from "./lib/preferences-store";

const SubtitleEditor = deferView(() =>
  import("./components/subtitle-editor").then(module => ({ default: module.SubtitleEditor })),
);
const DriveBackupSettings = deferView(() =>
  import("./components/drive-backup-settings").then(module => ({
    default: module.DriveBackupSettings,
  })),
);
const SpeechSettingsPanel = deferView(() =>
  import("./components/speech-settings").then(module => ({ default: module.SpeechSettingsPanel })),
);
const SiriVoiceManagerPage = deferView(() =>
  import("./components/siri-voice-downloads").then(module => ({
    default: module.SiriVoiceManagerPage,
  })),
);
const PiSettings = deferView(() =>
  import("./components/pi-settings").then(module => ({ default: module.PiSettings })),
);
const CustomViewer = deferView(() =>
  import("./components/custom-viewer").then(module => ({ default: module.CustomViewer })),
);

type Page = SidePanelPage;
type Installed = Record<string, boolean>;

const DEFAULT_PROFILE: LearningProfile = contextualGenerationProfile({
  targetLanguage: "en",
  instructionLanguage: "zh-TW",
  level: "B1",
  sceneCount: 4,
  contextualExampleCount: 1,
});
const DEFAULT_AGENT: AgentSettings = { provider: "", modelId: "" };

export default function App() {
  const [store] = useState(() => getPreferencesStore(chrome.storage.local, getBrowserLocale()));
  return (
    <SpeechDownloadsProvider>
      <SystemSpeechProvider store={store}>
        <AppContent />
      </SystemSpeechProvider>
    </SpeechDownloadsProvider>
  );
}

function AppContent() {
  const [page, setPage] = useState<Page>("create");
  const [unsavedCredentials, setUnsavedCredentials] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "general" | "ai" | "storage" | "advanced" | "speech-resources" | null
  >(null);
  const [speechSettingsLanguage, setSpeechSettingsLanguage] = useState<string | null>(null);
  const [speechTargetVoice, setSpeechTargetVoice] = useState<{
    id: string;
    tab: "installed" | "downloadable";
  } | null>(null);
  const speechDownloads = useSpeechDownloads();
  const downloadSnapshot = useSpeechDownloadSnapshot();
  const speechManagerHeading = useRef<HTMLHeadingElement>(null);
  const speechSettingsScroll = useRef(0);
  const [speechManageFocus, setSpeechManageFocus] = useState(false);
  const [returnPage, setReturnPage] = useState<"create" | "lessons" | "lesson" | "custom">(
    "create",
  );
  const [editingVideo, setEditingVideo] = useState(false);
  const [generationServiceReady, setGenerationServiceReady] = useState(false);
  const [attentionNotificationsEnabled, setAttentionNotificationsEnabled] = useState(true);
  const [browserLocale] = useState(getBrowserLocale);
  const [analysisNotificationsEnabled, setAnalysisNotificationsEnabled] = useState(true);
  const [localePreference, setLocalePreference] = useState<LocalePreference>("auto");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [motionPreference, setMotionPreference] = useState<MotionPreference>("full");
  useMotionPreference(motionPreference);
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
  const ux = createFlowCopy(uiLocale);
  const localeRef = useRef(uiLocale);
  localeRef.current = uiLocale;
  useEffect(
    () =>
      speechDownloads.subscribeNotices(task => {
        if (task.progress.status === "completed")
          toast.success(
            speechDownloadTaskText(localeRef.current, "noticeCompleted", { name: task.voice.name }),
          );
        if (task.progress.status === "failed")
          toast.error(
            speechDownloadTaskText(localeRef.current, "noticeFailed", { name: task.voice.name }),
          );
      }),
    [speechDownloads],
  );
  const pageRef = useRef(page);
  pageRef.current = page;
  const overlay = page === "settings" || page === "activity";
  const basePage = overlay ? returnPage : page;
  const sheetPage = useRef<"settings" | "activity">("settings");
  if (overlay) sheetPage.current = page;
  const sheetOrigin = useRef("header-settings");
  if (overlay)
    sheetOrigin.current =
      returnPage === "lesson" || returnPage === "custom"
        ? returnPage === "custom"
          ? "custom-reader-options"
          : "reader-options"
        : page === "settings"
          ? "header-settings"
          : "header-activity";
  const subtitleUi = subtitleAcquisition[uiLocale];
  const subtitleLayout = subtitleLayoutCopy[uiLocale];
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
  const [providerSettings, setProviderSettings] = useState<
    Record<string, Pick<AgentSettings, "modelId" | "thinkingLevel" | "customModel">>
  >({});
  const [customModels, setCustomModels] = useState<Record<string, string[]>>({});
  const [agentModelPreferences, setAgentModelPreferences] = useState<Record<string, string>>({});
  const [modelOptions, setModelOptions] = useState<AgentModel[]>([]);
  const modelCatalogProviderRef = useRef("");
  const [modelBusy, setModelBusy] = useState(false);
  const [modelNotice, setModelNotice] = useState("");
  const [modelWarning, setModelWarning] = useState("");
  const [modelRefreshVersion, setModelRefreshVersion] = useState(0);
  const [installed, setInstalled] = useState<Installed | null>(null);
  const [hostVersion, setHostVersion] = useState<string | null>(null);
  const [hostSdkMode, setHostSdkMode] = useState(false);
  const [hostProtocolVersion, setHostProtocolVersion] = useState<number | null>(null);
  const [hostStatus, setHostStatus] = useState("");
  const [hostChecked, setHostChecked] = useState(false);
  const [hostLastCheckedAt, setHostLastCheckedAt] = useState<number | null>(null);
  const hostCheckInFlight = useRef(false);
  const [hostCheckSuccess, setHostCheckSuccess] = useState(false);
  const [agentCatalog, setAgentCatalog] = useState<AgentInfo[]>([]);
  const [document, setDocument] = useState<LearningDocument | null>(null);
  const [previewInfo, setPreviewInfo] = useState<JobPreviewInfo | null>(null);
  const previewRef = useRef<JobPreviewInfo | null>(null);
  const previewConnectionRef = useRef<string | undefined>(undefined);
  const notifiedPreviewJobs = useRef(new Set<string>());
  const previewSession = useMemo(
    () =>
      createPreviewSession({
        load: getJobPreview,
        onSnapshot: ({ info, document }) => {
          const opening = previewRef.current?.jobId !== info.jobId;
          const active = info.status === "completed" ? null : info;
          previewRef.current = active;
          setPreviewInfo(active);
          setFavoriteReader(null);
          setDocument(document);
          if (opening) setPage("lesson");
        },
        onError: error => setError(String(error)),
      }),
    [],
  );
  useEffect(() => {
    if (basePage !== "lesson" && previewRef.current) {
      previewSession.close();
      previewRef.current = null;
      setPreviewInfo(null);
    }
  }, [basePage, previewSession]);
  useEffect(() => () => previewSession.close(), [previewSession]);
  const [libraryView, setLibraryView] = useState<"all" | "favorites">("all");
  const [favoriteReader, setFavoriteReader] = useState<{
    document: FavoriteReaderDocument;
    origin: FavoriteSnapshot["origin"];
  } | null>(null);
  const [customFavoriteReader, setCustomFavoriteReader] = useState<CustomFavoriteSnapshot | null>(
    null,
  );
  const favoritesStore = getFavoritesStore();
  useEffect(() => favoritesStore.connect(), [favoritesStore]);
  async function openFavorite(summary: FavoriteSummary) {
    const collection = favoritesStore.getSnapshot().collection;
    const snapshot = await getFavorite(collection, summary.key);
    if (!sameFavoriteCollection(collection, favoritesStore.getSnapshot().collection)) return;
    if (snapshot.snapshotVersion === 2) {
      setFavoriteReader(null);
      setCustomFavoriteReader(snapshot);
      setPage("custom");
      return;
    }
    setCustomFavoriteReader(null);
    const progressId =
      "favorite:" +
      (collection.kind === "local" ? "local" : collection.accountId) +
      ":" +
      summary.key;
    setFavoriteReader({
      document: favoriteReaderDocument(snapshot, progressId),
      origin: snapshot.origin,
    });
    setPage("lesson");
  }
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const videoRecovery = usePlatformVideoNotice();
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [hostBusy, setHostBusy] = useState(false);
  const [localLessons, setLocalLessons] = useState<LessonSummary[]>([]);
  const [cloudLessons, setCloudLessons] = useState<DriveLessonSummary[]>([]);
  const [lessonsBusy, setLessonsBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogErrorAccountId, setCatalogErrorAccountId] = useState<string>();
  const [restoreBusy, setRestoreBusy] = useState<string | null>(null);
  const [destination, setDestination] = useState<Extract<Destination, { kind: "local" }>>({
    kind: "local",
  });
  const [backup, setBackup] = useState<BackupSettings>({ enabled: false });
  const [backupStatus, setBackupStatus] = useState("");
  const [backupPhase, setBackupPhase] = useState<"checking" | "uploading" | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{
    accountId: string;
    action: "backup" | "retry";
    success: boolean;
  } | null>(null);
  useEffect(() => {
    if (!backupFeedback?.success) return;
    const timer = window.setTimeout(() => setBackupFeedback(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [backupFeedback]);
  const [driveFolderUrl, setDriveFolderUrl] = useState<string | null>(null);
  const [driveConnectError, setDriveConnectError] = useState("");
  const [driveAccounts, setDriveAccounts] = useState<DriveAccount[]>([]);
  const [driveConfigured, setDriveConfigured] = useState<boolean | null>(null);
  const [driveAccountsLoaded, setDriveAccountsLoaded] = useState(false);
  const [driveAccountsLoading, setDriveAccountsLoading] = useState(true);
  const [driveAccountsError, setDriveAccountsError] = useState("");
  const driveAccountsRequest = useRef(false);
  const [driveAccess, setDriveAccess] = useState<{
    accountId: string;
    status: "checking" | "verified" | "failed";
  } | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<GenerationState["duplicate"]>(null);
  const [customDocument, setCustomDocument] = useState<CustomDocument | null>(null);
  const [localCustom, setLocalCustom] = useState<CustomContentSummary[]>([]);
  const [cloudCustom, setCloudCustom] = useState<CustomDriveSummary[]>([]);
  const [connection, setConnection] = useState<GenerationState["connection"]>();
  const [cancellations, setCancellations] = useState<NonNullable<GenerationState["cancellations"]>>(
    {},
  );
  const [executionDetails, setExecutionDetails] = useState<{
    title: string;
    execution: ExecutionMetadata | null;
    markdown?: string;
  } | null>(null);
  const customUi = customContentCopy(uiLocale);
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

  const {
    draft: subtitleDraft,
    state: draftState,
    saveStatus: subtitleSaveStatus,
    loaded: subtitlesLoaded,
  } = useSubtitleDraft(profile.targetLanguage, uiLocale);
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
  subtitleDraft.configure(uiLocale, checking, subtitleReaderBlocked);
  useEffect(() => {
    if (draftState.error) setError(draftState.error);
  }, [draftState.error]);
  const autoCaptionAttempts = useRef(new Set<string>());
  useEffect(() => {
    if (
      !subtitlesLoaded ||
      subtitleBusy ||
      metadataBusy ||
      raw.trim() ||
      subtitleReaderBlocked ||
      checking
    )
      return;
    const key = captionCacheKey(sourceUrl, profile.targetLanguage);
    if (
      !sourceUrl ||
      !getVideoAdapter(sourceUrl).fetchSubtitles ||
      autoCaptionAttempts.current.has(key)
    )
      return;
    autoCaptionAttempts.current.add(key);
    void subtitleDraft.fetchSubtitles();
  }, [
    subtitlesLoaded,
    subtitleBusy,
    metadataBusy,
    sourceUrl,
    raw,
    profile.targetLanguage,
    subtitleReaderBlocked,
    checking,
  ]);
  const subtitleState = subtitleBusy
    ? "loading"
    : captionsReady
      ? "ready"
      : subtitleStatus && (subtitleTone === "missing" || subtitleTone === "error")
        ? "error"
        : raw.trim()
          ? "error"
          : "idle";
  const platform = getVideoAdapter(sourceUrl).id;
  // A valid saved source remains actionable when the Side Panel temporarily loses its tab context.
  const subtitlePlatform = getVideoAdapter(activeVideo?.url ?? sourceUrl).id;
  const showVideoRecovery =
    subtitleReaderBlocked && (subtitlePlatform === "netflix" || subtitlePlatform === "youtube");
  const currentSubtitleTracks =
    !trackBusy &&
    trackInfo?.status === "available" &&
    trackInfo.sourceKey === videoSourceKey(sourceUrl)
      ? trackInfo.tracks
      : null;
  const subtitleTrackKind = (language: string) => {
    const matching = currentSubtitleTracks?.filter(track =>
      subtitleLanguageMatches(language as LearningLanguage, track.language),
    );
    return (
      matching?.find(track => track.kind === "manual")?.kind ??
      matching?.find(track => track.kind === "auto")?.kind ??
      matching?.[0]?.kind
    );
  };
  const subtitleTrackLabel = (language: string) => {
    const kind = subtitleTrackKind(language);
    return kind === "manual"
      ? subtitleLayout.originalTrack
      : kind === "auto"
        ? subtitleLayout.autoTrack
        : kind === "translated"
          ? subtitleLayout.translatedTrack
          : currentSubtitleTracks
            ? subtitleLayout.missingTrack
            : undefined;
  };
  const selectedSubtitleKind = subtitleTrackKind(profile.targetLanguage);
  const subtitleRecoveryCopy = !subtitleStatus
    ? undefined
    : typeof subtitleStatus === "string"
      ? subtitleStatus
      : subtitlePlatform === "youtube" &&
          ["CAPTION_EMPTY", "CAPTION_TIMEOUT", "CAPTION_FAILED"].includes(subtitleStatus.code)
        ? subtitleMessage(
            selectedSubtitleKind === "translated"
              ? subtitleLayout.youtubeTranslationRetry
              : subtitleLayout.youtubeRetry,
            { language: learningLanguageName(subtitleStatus.language, uiLocale) },
          )
        : subtitleFailureMessage(uiLocale, subtitleStatus);
  const analysisAdapter = getVideoAdapter(sourceUrl);
  const videoConnection = useVideoConnection(analysisAdapter, sourceUrl, activeVideo?.tabId);
  const videoDurationMs = videoConnection.durationMs;
  const createFlow = useCreateFlow({
    source: {
      url: sourceUrl,
      title,
      raw,
      originalRaw: draftState.originalRaw,
      activeVideoUrl: activeVideo?.url,
      cues,
      captionsReady,
      subtitleBusy,
      loaded: subtitlesLoaded,
      videoDurationMs,
    },
    profile,
    defaults: { agent, destination, backup },
    hydrated,
    locale: uiLocale,
    initialLocale: browserLocale,
    session: generationSession,
    onProfile: setProfile,
    onTitle: value => subtitleDraft.setTitle(value),
    onError: setError,
  });
  const {
    createStep,
    subtitlePreview,
    contentMode,
    customPrompt,
    customContext,
    analysisSelection,
    requestDestination,
    requestBackup,
  } = createFlow.state;
  const { generationAgent, analysisDurationMs, estimatePayload } = createFlow;
  const readerAdapter = getVideoAdapter(
    favoriteReader?.document.source.url ?? document?.source.url,
  );
  const selectedDriveId = backup.accountId ?? driveAccounts[0]?.id;
  const driveAccessVerified =
    !!selectedDriveId &&
    driveAccess?.accountId === selectedDriveId &&
    driveAccess.status === "verified";
  const hostReady =
    installed !== null &&
    hostSdkMode &&
    hostProtocolVersion === HOST_PROTOCOL_VERSION &&
    hostVersion === chrome.runtime.getManifest().version &&
    !["failed", "incompatible", "reconnecting"].includes(connection?.status ?? "");
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
  const backupFailed = backupJobs.filter(
    job => job.backup?.status === "failed" && !isRetiredBackup(job),
  );
  function applyPreferences(saved: ReturnType<typeof preferencesStore.current>) {
    setProfile(contextualGenerationProfile(saved.profile));
    setExplanationLanguageMode(saved.explanationLanguageMode);
    setAgent(saved.agent ?? DEFAULT_AGENT);
    setProviderSettings(saved.providerSettings);
    setCustomModels(saved.customModels ?? {});
    setAgentModelPreferences(saved.agentModelPreferences);
    setDestination(saved.destination);
    setBackup(saved.backup);
    setAttentionNotificationsEnabled(saved.attentionNotificationsEnabled);
    setAnalysisNotificationsEnabled(saved.analysisNotificationsEnabled);
    setLocalePreference(saved.uiLocalePreference);
    setThemePreference(saved.themePreference);
    setMotionPreference(saved.motionPreference);
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
        setConnection(event.state.connection);
        const nextConnection = event.state.connection?.status;
        if (nextConnection === "ready" && previewConnectionRef.current !== "ready")
          previewSession.reconnect();
        previewConnectionRef.current = nextConnection;
        setCancellations(event.state.cancellations ?? {});
        onJobsConnectionStatus(event.state.connection?.status);
        setChecking(event.state.checking);
        setSubmitting(!!event.state.submitting);
        setDuplicateWarning(event.state.duplicate);
        setGenerating(!!event.state.active);
        if (event.state.lastJobId) lastJobIdRef.current = event.state.lastJobId;
        if (event.state.active?.summary) updateJob(event.state.active.summary);
        for (const run of event.state.queue ?? []) {
          if (run.summary) updateJob(run.summary);
        }
        return;
      }
      if (event.type === "customDocument") {
        toast.success(customContentCopy(localeRef.current).created, {
          action: {
            label: t("openLesson"),
            onClick: () => void openCustomDocument(event.document.id),
          },
        });
        void loadLessons();
        return;
      }
      if (event.type === "document") {
        receiveGeneratedDocument(event.document);
        return;
      }
      switch (event.type) {
        case "admitted": {
          createFlow.admitted(event.job);
          const ui = activityCopy[localeRef.current];
          toast.success(ui.addedToQueue, {
            id: `admitted:${event.job.id}`,
            description: event.job.sourceTitle,
            action: { label: ui.viewActivity, onClick: () => openActivity() },
          });
          break;
        }
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
          void loadJobs();
          break;
        case "backupFailed":
          setBackupStatus(t("backupFailedMessage"));
          void loadJobs();
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
    if (hydrated) {
      const pending: Parameters<typeof preferencesStore.save>[0] = {
        schemaVersion: 2,
        attentionNotificationsEnabled,
        analysisNotificationsEnabled,
        profile,
        agent: isPiProviderId(agent.provider) ? agent : null,
        providerSettings,
        customModels,
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
        motionPreference,
        explanationLanguageMode,
      };
      // A rollback restores committed values; do not save that same snapshot again.
      if (
        Object.entries(pending).every(
          ([key, value]) =>
            JSON.stringify(value) === JSON.stringify(Reflect.get(preferencesStore.current(), key)),
        )
      )
        return;
      const revision = ++preferenceRevision.current;
      void preferencesStore.save(pending).catch(error => {
        if (revision === preferenceRevision.current) applyPreferences(preferencesStore.current());
        setError(String(error));
      });
    }
  }, [
    hydrated,
    attentionNotificationsEnabled,
    analysisNotificationsEnabled,
    profile,
    agent,
    providerSettings,
    customModels,
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
    motionPreference,
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
    if (driveAccountsRequest.current) return;
    driveAccountsRequest.current = true;
    setDriveAccountsLoading(true);
    setDriveAccountsLoaded(false);
    setDriveAccountsError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "driveAccounts" });
      if (response.type !== "driveAccounts") throw new Error("Unexpected Drive accounts response");
      setDriveAccounts(response.accounts);
      setDriveConfigured(response.configured);
      setDriveAccountsLoaded(true);
      // Account choice no longer changes the local lesson destination.
    } catch (cause) {
      setDriveConfigured(null);
      setDriveAccountsError(
        cause instanceof Error ? cause.message : backupSettingsCopy(uiLocale).accountsFailed,
      );
    } finally {
      driveAccountsRequest.current = false;
      setDriveAccountsLoading(false);
    }
  }

  useEffect(() => {
    if (hostReady) void refreshDriveAccounts();
  }, [hostReady]);

  useEffect(() => {
    if (settingsSection === "storage") void refreshDriveAccounts();
  }, [settingsSection]);

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

  async function chooseFolder(forRequest = false): Promise<void> {
    setStorageBusy(true);
    setError("");
    try {
      const response = await nativeOnce({ id: crypto.randomUUID(), type: "chooseFolder" });
      if (response.type !== "folder") throw new Error("Unexpected folder picker response");
      const selected = { kind: "local" as const, directory: response.directory };
      if (forRequest) createFlow.edit({ requestDestination: selected });
      else setDestination(selected);
    } catch (cause) {
      if (!wasOperationCancelled(cause, "folder"))
        setError(cause instanceof Error ? cause.message : t("folderError"));
    } finally {
      setStorageBusy(false);
    }
  }

  async function openFolder(): Promise<void> {
    setStorageBusy(true);
    try {
      await nativeOnce({
        id: crypto.randomUUID(),
        type: "openFolder",
        directory: destination.directory,
      });
    } catch (cause) {
      toast.error(layout.openFolderError, {
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setStorageBusy(false);
    }
  }

  async function connectDrive(
    mode: "backup" | "library" = "backup",
    expectedAccountId?: string,
  ): Promise<void> {
    setStorageBusy(true);
    setError("");
    setDriveConnectError("");
    try {
      const account = await connectDriveAndVerify(nativeOnce, {
        expected: expectedAccountId
          ? (driveAccounts.find(account => account.id === expectedAccountId) ?? {
              id: expectedAccountId,
            })
          : undefined,
        onConnected: account =>
          setDriveAccounts(current =>
            current.some(existing => existing.id === account.id)
              ? current.map(existing => (existing.id === account.id ? account : existing))
              : [...current, account],
          ),
      });
      setDriveAccess({ accountId: account.id, status: "verified" });
      if (mode === "backup") setBackup({ enabled: true, accountId: account.id });
      setDriveConnectError("");
      if (mode === "library") await loadLessons();
    } catch (cause) {
      if (wasOperationCancelled(cause, "google")) return;
      const message = cause instanceof Error ? cause.message : t("connectDriveError");
      if (mode === "library") throw cause;
      setDriveConnectError(message);
    } finally {
      setStorageBusy(false);
    }
  }

  async function disconnectDrive(accountId: string): Promise<void> {
    setStorageBusy(true);
    setError("");
    setDriveConnectError("");
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
      setDriveConnectError(cause instanceof Error ? cause.message : t("connectDriveError"));
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
    createFlow.dismissDuplicate();
  }

  function rememberCustomModel(provider: string, modelId: string): void {
    setCustomModels(previous => rememberCustomModelId(previous, provider, modelId));
  }

  function updateAgent(next: AgentSettings): void {
    next = {
      provider: next.provider,
      modelId: next.modelId,
      thinkingLevel: next.thinkingLevel,
      customModel: next.customModel || undefined,
    };
    setAgent(next);
    if (next.customModel && next.modelId) {
      rememberCustomModel(next.provider, next.modelId);
    }
    createFlow.edit({ requestAgent: null });
    setProviderSettings(previous => ({
      ...previous,
      [next.provider]: {
        modelId: next.modelId,
        thinkingLevel: next.thinkingLevel,
        customModel: next.customModel,
      },
    }));
    setAgentModelPreferences(previous => ({
      ...previous,
      [agentModelPreferenceKey(next.provider)]: next.modelId,
    }));
  }

  function selectAgent(provider: string, modelId?: string): void {
    if (!isPiProviderId(provider)) return;
    const previous = providerSettings[provider];
    const selectedId =
      modelId ?? savedAgentModel(provider, agentModelPreferences, previous?.modelId ?? "");
    if (modelId !== undefined) setModelRefreshVersion(current => current + 1);
    updateAgent({
      provider,
      thinkingLevel: modelId !== undefined ? undefined : previous?.thinkingLevel,
      modelId: selectedId,
      customModel:
        (modelId === undefined &&
          (previous?.customModel || customModels[provider]?.includes(selectedId))) ||
        undefined,
    });
  }

  function checkHost(manual = false): void {
    if (hostCheckInFlight.current) return;
    hostCheckInFlight.current = true;
    if (manual) toast.dismiss("host-connection-check");
    setHostStatus("");
    setHostCheckSuccess(false);
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
            setHostCheckSuccess(true);
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
      setModelWarning("");
      return;
    }
    if (!installed[agent.provider]) {
      setModelOptions([]);
      setModelNotice(piCopy[uiLocale].empty);
      setModelWarning("");
      return;
    }
    let ignore = false;
    let settleTimer: number | undefined;
    const startedAt = performance.now();
    setModelBusy(true);
    if (modelCatalogProviderRef.current !== agent.provider) setModelOptions([]);
    modelCatalogProviderRef.current = agent.provider;
    setModelNotice("");
    setModelWarning("");
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
        setModelWarning(response.warning ?? "");
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
    toast.success(t("analysisCompleteTitle"), {
      action: { label: t("openLesson"), onClick: () => openSavedDocument(parsed.data.id) },
    });
    void loadLessons();
  }

  function showDocument(raw: unknown): void {
    const parsed = LearningDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Host returned an invalid learning document.");
    previewSession.close();
    previewRef.current = null;
    setPreviewInfo(null);
    setFavoriteReader(null);
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
    previewSession.update(summary);
    if (
      summary.id === lastJobIdRef.current &&
      summary.status === "running" &&
      summary.readySceneIds?.length &&
      !notifiedPreviewJobs.current.has(summary.id)
    ) {
      notifiedPreviewJobs.current.add(summary.id);
      const copy = generationPreviewCopy[localeRef.current];
      toast.info(
        copy.ready(
          summary.readySceneIds.length,
          summary.selectedSceneCount ?? summary.readySceneIds.length,
        ),
        {
          id: `preview:${summary.id}`,
          action: { label: copy.open, onClick: () => previewSession.open(summary.id) },
        },
      );
    }
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
    setError("");
    setProgress(t("statusResuming"));
    generationSession.resume(
      input.jobId,
      jobs.find(job => job.id === input.jobId)?.kind ?? "standard",
    );
  }

  function startGeneration(): void {
    const result = createFlow.submit({
      checking,
      submitting,
      hostReady,
      installed,
      driveAccessVerified,
    });
    if (result.status === "busy") return;
    if (result.status === "started") {
      setError("");
      setBackupStatus("");
      setProgress(t("checkingExisting"));
      return;
    }
    if (result.status === "error") {
      setChecking(false);
      setError(result.message || t("errorGenerationSettings"));
      return;
    }
    switch (result.reason) {
      case "range":
        setError(analysisRangeCopy(uiLocale).invalid);
        break;
      case "host":
        setError(installed === null ? piCopy[uiLocale].unavailable : hostUi.unsupportedMode);
        setSettingsSection("advanced");
        setPage("settings");
        break;
      case "provider":
        setError(piCopy[uiLocale].empty);
        setSettingsSection("ai");
        setPage("settings");
        break;
      case "subtitles":
        setError(
          subtitleMessage(subtitleUi.languageNotReady, {
            language: learningLanguageName(profile.targetLanguage, uiLocale),
          }),
        );
        break;
      case "backup":
        setError(t("driveAccessNotVerified"));
        break;
      case "draft":
        break;
    }
  }

  function viewDownloadedVoice(task: SpeechDownloadTask): void {
    const tab = task.progress.status === "completed" ? "installed" : "downloadable";
    setSpeechSettingsLanguage(task.voice.language);
    setSpeechTargetVoice({ id: task.voice.id, tab });
    setSettingsSection("speech-resources");
    setPage("settings");
    window.requestAnimationFrame(() =>
      speechManagerHeading.current?.focus({ preventScroll: true }),
    );
  }

  function openActivity(): void {
    const currentPage = pageRef.current;
    if (currentPage === "activity") return;
    if (
      currentPage === "create" ||
      currentPage === "lessons" ||
      currentPage === "lesson" ||
      currentPage === "custom"
    )
      setReturnPage(currentPage);
    setExecutionDetails(null);
    setPage("activity");
    void loadJobs();
  }

  function confirmRegeneration(): void {
    generationSession.confirmRegeneration();
  }

  async function loadLessons(): Promise<void> {
    const version = ++catalogLoadIdRef.current;
    setLessonsBusy(true);
    setCatalogError("");
    setCatalogErrorAccountId(undefined);
    try {
      // Show each local collection as soon as it arrives, even if its sibling stalls.
      const local = await Promise.allSettled([
        nativeOnce({ id: crypto.randomUUID(), type: "listLessons" }).then(response => {
          if (response.type !== "lessons") throw new Error("Unexpected lesson catalog response");
          if (version === catalogLoadIdRef.current) setLocalLessons(response.lessons);
        }),
        nativeOnce({ id: crypto.randomUUID(), type: "listCustomDocuments" }).then(response => {
          if (response.type !== "customDocuments")
            throw new Error("Unexpected custom catalog response");
          if (version === catalogLoadIdRef.current) setLocalCustom(response.documents);
        }),
      ]);
      if (version !== catalogLoadIdRef.current) return;
      const failed = local.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
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
          const customCloud = await nativeOnce({
            id: crypto.randomUUID(),
            type: "listCustomDriveDocuments",
            accountId,
          });
          if (customCloud.type === "customDriveDocuments" && version === catalogLoadIdRef.current)
            setCloudCustom(customCloud.documents);
        } catch (cause) {
          if (version === catalogLoadIdRef.current) {
            // Keep previously loaded cloud rows visible while the API is
            // temporarily unavailable; the local lesson catalog remains usable.
            setCatalogError(cause instanceof Error ? cause.message : t("lessonCatalogError"));
            setCatalogErrorAccountId(accountId);
          }
        }
      } else {
        setCloudLessons([]);
        setCloudCustom([]);
      }
    } catch (cause) {
      if (version === catalogLoadIdRef.current) {
        setCatalogError(cause instanceof Error ? cause.message : t("lessonCatalogError"));
        setCatalogErrorAccountId(undefined);
      }
    } finally {
      if (version === catalogLoadIdRef.current) setLessonsBusy(false);
    }
  }

  async function restoreLesson(lesson: DriveLessonSummary): Promise<void> {
    setRestoreBusy(lesson.documentId);
    setCatalogError("");
    setCatalogErrorAccountId(undefined);
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
      setCatalogErrorAccountId(lesson.accountId);
    } finally {
      setRestoreBusy(null);
    }
  }

  async function deleteLocalDocument(documentId: string, kind: "standard" | "custom") {
    setStorageBusy(true);
    try {
      await nativeOnce({
        id: crypto.randomUUID(),
        type: kind === "custom" ? "deleteCustomDocument" : "deleteLocalLesson",
        documentId,
      });
      // Invalidate catalog reads that started before deletion; retain the cloud row for restore.
      catalogLoadIdRef.current++;
      setLessonsBusy(false);
      if (kind === "custom") {
        setLocalCustom(items => items.filter(item => item.documentId !== documentId));
        setCustomDocument(current => (current?.id === documentId ? null : current));
      } else {
        setLocalLessons(items => items.filter(item => item.documentId !== documentId));
        setDocument(current => (current?.id === documentId ? null : current));
      }
    } finally {
      setStorageBusy(false);
    }
  }

  async function backupExistingLessons(): Promise<void> {
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) {
      await connectDrive();
      return;
    }
    const ui = backupSettingsCopy(uiLocale);
    const options = { id: "drive-backup", duration: 4000 };
    setStorageBusy(true);
    setBackupPhase("checking");
    setBackupFeedback({ accountId, action: "backup", success: false });
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "backupExisting",
        accountId,
      });
      if (response.type !== "backupsScheduled") throw new Error("Unexpected backup response");
      if (!response.count) {
        toast.info(ui.empty, options);
        return;
      }
      setBackupPhase("uploading");
      const scheduled = await nativeOnce({ id: crypto.randomUUID(), type: "listJobs" });
      if (scheduled.type !== "jobs") throw new Error("Unexpected task history response");
      setJobs(scheduled.jobs);
      const expectedIds = scheduled.jobs
        .filter(job => job.backup?.accountId === accountId)
        .map(job => job.id);
      await nativeOnce({ id: crypto.randomUUID(), type: "resumeBackups" });
      const result = await nativeOnce({ id: crypto.randomUUID(), type: "listJobs" });
      if (result.type !== "jobs") throw new Error("Unexpected task history response");
      setJobs(result.jobs);
      const outcome =
        expectedIds.length >= response.count
          ? backupFeedbackResult(result.jobs, accountId, expectedIds)
          : { status: "attention" as const, failed: 0 };
      if (outcome.status === "failed")
        toast.error(ui.failed.replace("{count}", String(outcome.failed)), options);
      else if (outcome.status === "attention") toast.warning(ui.needsAttention, options);
      else setBackupFeedback({ accountId, action: "backup", success: true });
      setBackupStatus(t("backupSaved"));
    } catch {
      toast.error(ui.unavailable, options);
      void loadJobs();
    } finally {
      setBackupPhase(null);
      setStorageBusy(false);
    }
  }

  async function retryFailedBackups(): Promise<void> {
    const ui = backupSettingsCopy(uiLocale);
    const accountId = backup.accountId ?? driveAccounts[0]?.id;
    if (!accountId) return;
    const failed = backupFailed.filter(job => job.backup?.accountId === accountId);
    if (!failed.length) return;
    let failures = 0;
    setStorageBusy(true);
    setBackupPhase("uploading");
    setBackupFeedback({ accountId, action: "retry", success: false });
    try {
      for (const job of failed) {
        try {
          await nativeOnce({ id: crypto.randomUUID(), type: "retryBackup", jobId: job.id });
        } catch {
          failures++;
        }
      }
      const result = await nativeOnce({ id: crypto.randomUUID(), type: "listJobs" });
      if (result.type !== "jobs") throw new Error("Unexpected task history response");
      setJobs(result.jobs);
      const outcome = backupFeedbackResult(
        result.jobs,
        accountId,
        failed.map(job => job.id),
      );
      if (failures)
        toast.error(ui.failed.replace("{count}", String(failures)), { id: "drive-backup" });
      else if (outcome.status === "failed")
        toast.error(ui.failed.replace("{count}", String(outcome.failed)), { id: "drive-backup" });
      else if (outcome.status === "attention")
        toast.warning(ui.needsAttention, { id: "drive-backup" });
      else setBackupFeedback({ accountId, action: "retry", success: true });
      setBackupStatus(t("backupSaved"));
    } catch {
      toast.error(ui.unavailable, { id: "drive-backup" });
      void loadJobs();
    } finally {
      setBackupPhase(null);
      setStorageBusy(false);
    }
  }

  const {
    loading: loadingJobs,
    refresh: loadJobs,
    onConnectionStatus: onJobsConnectionStatus,
  } = useJobHistoryRefresh(
    async () => {
      const message = await nativeOnce({ id: crypto.randomUUID(), type: "listJobs" });
      if (message.type !== "jobs") throw new Error("Unexpected job history response");
      setJobs(message.jobs);
      const activePreview = message.jobs.find(job => job.id === previewRef.current?.jobId);
      if (activePreview) previewSession.update(activePreview);
      const current = message.jobs.find(job => job.id === lastJobIdRef.current);
      if (current) updateJob(current);
    },
    error => setError(String(error)),
  );

  function fetchSavedDocument(
    documentId: string,
    handle: (document: LearningDocument) => void,
  ): void {
    setError("");
    void getDocument(documentId)
      .then(handle)
      .catch(error => setError(String(error)));
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

  useEffect(() => {
    if (!hydrated || !hostReady) return;
    let live = true;
    const navigate = async (value: unknown) => {
      if (!live || !value || typeof value !== "object") return;
      const route = value as { id?: string; windowId?: number };
      if (typeof route.id !== "string" || typeof route.windowId !== "number") return;
      const window = await chrome.windows.getCurrent();
      if (!live || window.id !== route.windowId) return;
      const path = notificationDestination(route.id);
      if (!path) return;
      if (route.id.startsWith("lesson-complete:"))
        openSavedDocument(route.id.slice("lesson-complete:".length));
      else {
        setReturnPage("create");
        setPage("activity");
        void loadJobs();
      }
      await chrome.storage.local.remove(NOTIFICATION_ROUTE_KEY);
    };
    void chrome.storage.local
      .get(NOTIFICATION_ROUTE_KEY)
      .then(saved => navigate(saved[NOTIFICATION_ROUTE_KEY]))
      .catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[NOTIFICATION_ROUTE_KEY])
        void navigate(changes[NOTIFICATION_ROUTE_KEY].newValue).catch(() => {});
    };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [hydrated, hostReady]);
  function openSavedDocument(documentId: string): void {
    const kind = jobs.find(job => job.documentId === documentId || job.id === documentId)?.kind;
    if (kind === "custom" || localCustom.some(doc => doc.documentId === documentId)) {
      void openCustomDocument(documentId);
      return;
    }
    // A notification can arrive before the catalog; resolve the document kind from storage.
    if (!localLessons.some(doc => doc.documentId === documentId)) {
      void getDocument(documentId)
        .then(showDocument)
        .catch(() => openCustomDocument(documentId));
      return;
    }
    fetchSavedDocument(documentId, showDocument);
  }

  async function openCustomDocument(documentId: string) {
    setCustomFavoriteReader(null);
    setStorageBusy(true);
    try {
      setCustomDocument(await getCustomResource("document", documentId));
      setPage("custom");
    } catch (error) {
      setError(String(error));
    } finally {
      setStorageBusy(false);
    }
  }
  async function restoreCustom(lesson: CustomDriveSummary) {
    setRestoreBusy(lesson.documentId);
    setCatalogError("");
    setCatalogErrorAccountId(undefined);
    try {
      await nativeOnce({
        id: crypto.randomUUID(),
        type: "restoreCustomDriveDocument",
        accountId: lesson.accountId,
        documentId: lesson.documentId,
      });
      await loadLessons();
      await openCustomDocument(lesson.documentId);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : t("lessonRestoreError"));
      setCatalogErrorAccountId(lesson.accountId);
    } finally {
      setRestoreBusy(null);
    }
  }
  async function customMutation(
    type: "renameCustomDocument" | "deleteCustomDocument",
    title?: string,
  ) {
    if (!customDocument) return;
    setStorageBusy(true);
    try {
      await nativeOnce(
        type === "renameCustomDocument"
          ? { id: crypto.randomUUID(), type, documentId: customDocument.id, title: title! }
          : { id: crypto.randomUUID(), type, documentId: customDocument.id },
      );
      if (type === "renameCustomDocument")
        setCustomDocument(await getCustomResource("document", customDocument.id));
      else {
        setCustomDocument(null);
        setPage("lessons");
      }
      await loadLessons();
    } catch (error) {
      setError(String(error));
      throw error;
    } finally {
      setStorageBusy(false);
    }
  }
  const executionFocus = useRef<HTMLElement | null>(null);
  const executionHeading = useRef<HTMLHeadingElement | null>(null);
  async function showExecution(job: JobSummary) {
    executionFocus.current =
      window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    try {
      const response = await nativeOnce({
        id: crypto.randomUUID(),
        type: "getJobExecution",
        jobId: job.id,
      });
      if (response.type !== "jobExecution") return;
      let markdown: string | undefined;
      if (job.kind === "custom" && job.phase === "saving" && job.status !== "completed") {
        const saved = await getCustomResource("job", job.id);
        markdown = saved.nodes.at(-1)?.output;
      }
      setExecutionDetails({ title: job.sourceTitle, execution: response.execution, markdown });
      window.requestAnimationFrame(() => executionHeading.current?.focus());
    } catch (error) {
      setError(String(error));
    }
  }
  const fetchCurrentVideoMetadata = () => subtitleDraft.fetchMetadata();
  // Offer a jump to the entered video whenever the selected browser tab is something else.
  const trimmedSourceUrl = sourceUrl.trim();
  const sourceVideoAdapter = getVideoAdapter(trimmedSourceUrl);
  const sourceVideoId =
    sourceVideoAdapter.id === "import" ? null : sourceVideoAdapter.getVideoId(trimmedSourceUrl);
  const activeIsSourceVideo =
    !!activeVideo &&
    getVideoAdapter(activeVideo.url).id === sourceVideoAdapter.id &&
    sourceVideoAdapter.getVideoId(activeVideo.url) === sourceVideoId;
  const canGoToSourceVideo = !!sourceVideoId && !activeIsSourceVideo;
  async function goToSourceVideo(): Promise<void> {
    if (!canGoToSourceVideo) return;
    try {
      await openOrFocusVideoTab(sourceVideoAdapter, trimmedSourceUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const [subtitleFetchSuccess, setSubtitleFetchSuccess] = useState<{
    sourceKey: string | null;
    language: string;
  } | null>(null);
  const subtitleFetchVersion = useRef(0);
  useEffect(() => {
    setSubtitleFetchSuccess(current =>
      current?.sourceKey === videoSourceKey(sourceUrl) &&
      current.language === profile.targetLanguage
        ? current
        : null,
    );
  }, [sourceUrl, profile.targetLanguage]);
  const fetchCurrentSubtitles = async () => {
    const version = ++subtitleFetchVersion.current;
    const language = profile.targetLanguage;
    setSubtitleFetchSuccess(null);
    await subtitleDraft.fetchSubtitles();
    const state = subtitleDraft.snapshot;
    if (
      version === subtitleFetchVersion.current &&
      !state.subtitleBusy &&
      state.subtitleTone === "success" &&
      state.cues.length > 0 &&
      !state.pendingCaption &&
      state.captionSource?.language === language
    )
      setSubtitleFetchSuccess({ sourceKey: state.captionSource.sourceKey, language });
  };
  const reloadVideoReader = () => {
    if (videoRecovery.unavailable) {
      subtitleDraft.clearRecovery();
      void videoRecovery.reload();
    } else void subtitleDraft.reloadReader();
  };
  const usePastedSubtitles = (text: string) => subtitleDraft.importText(text);
  const onFile = (file: File | undefined) => subtitleDraft.importFile(file);
  function chooseLearningLanguage(next: string) {
    const language = LEARNING_LANGUAGES.find(value => value === next);
    if (!language || checking) return;
    subtitleDraft.setLanguage(language);
    setProfile(current => ({
      ...current,
      targetLanguage: language,
      level:
        current.level === UNRESTRICTED_LEVEL
          ? current.level
          : defaultLevelForTargetLanguage(language),
    }));
  }

  const levelOptions = levelsForTargetLanguage(profile.targetLanguage);

  const runningCount = jobs.filter(job => job.status === "running").length;
  const queuedCount = jobs.filter(job => job.status === "queued").length;
  const downloadActiveCount = downloadSnapshot.tasks.filter(isSpeechDownloadActive).length;
  const readerExpanded =
    (basePage === "lesson" && (!!document || !!favoriteReader)) ||
    (basePage === "custom" && (!!customDocument || !!customFavoriteReader));
  const libraryMotionRef = useRef<HTMLElement>(null);
  const sheetMotionRef = useRef<HTMLDivElement>(null);
  useContentMotion(libraryMotionRef, "library", { active: basePage === "lessons", duration: 240 });
  const sheetDepth =
    sheetPage.current === "activity"
      ? executionDetails
        ? 1
        : 0
      : settingsSection === "speech-resources"
        ? 2
        : settingsSection
          ? 1
          : 0;
  useContentMotion(
    sheetMotionRef,
    `${sheetPage.current}:${settingsSection ?? "home"}:${!!executionDetails}`,
    {
      active: overlay,
      depth: sheetDepth,
      duration: 280,
      directional: true,
      activate: false,
    },
  );
  useEffect(() => {
    if (page === "lessons") void loadLessons();
  }, [page, backup.accountId, driveAccounts.length]);

  const backToLibrary = () => {
    setPage("lessons");
    window.requestAnimationFrame(() =>
      restoreFocusWithoutTooltip(window.document.getElementById("page-nav-lessons")),
    );
  };

  return (
    <div
      className={
        "relative h-full flex flex-col overflow-hidden " +
        (readerExpanded ? "px-0 " : "px-4 ") +
        "mx-auto w-full min-w-0 text-ui-body font-sans [color-scheme:light] dark:[color-scheme:dark]"
      }
    >
      {!readerExpanded && (
        <header
          data-ui="app-header"
          className="shrink-0 flex items-center justify-between gap-2 py-2.5 [&>div]:flex [&>div]:min-w-0 [&>div]:items-center [&>div]:gap-2 [&_strong]:min-w-0 [&_strong]:text-xs [&_strong]:font-semibold [&_strong]:leading-[1.25] [&_strong]:wrap-anywhere"
        >
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
            runningCount={runningCount}
            queuedCount={queuedCount}
            downloadActiveCount={downloadActiveCount}
            onActivity={openActivity}
            onSettings={() => {
              if (page === "create" || page === "lessons" || page === "lesson" || page === "custom")
                setReturnPage(page);
              setSettingsSection(null);
              setPage("settings");
            }}
          />
        </header>
      )}
      {!readerExpanded && <SidePanelNavigation page={basePage} onNavigate={setPage} t={t} />}

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

      <CancellationNotice
        cancellations={cancellations}
        locale={uiLocale}
        jobs={jobs}
        onRetry={(jobId, kind) => generationSession.cancelJob(jobId, kind)}
      />
      {connection && ["reconnecting", "failed", "incompatible"].includes(connection.status) && (
        <div
          className="flex shrink-0 items-center justify-between gap-2 py-2 text-ui-body"
          role="status"
        >
          <span>
            {connection.status === "reconnecting"
              ? `${customUi.reconnecting} · ${connection.attempt}/3`
              : connection.status === "incompatible"
                ? hostUi.updateNeeded
                : customUi.connectionFailed}
          </span>
          {connection.status !== "reconnecting" && (
            <Button
              variant="outline"
              size="sm"
              disabled={hostBusy}
              onClick={() => void checkHost(true)}
            >
              {customUi.retry}
            </Button>
          )}
        </div>
      )}
      <div
        data-ui="page-content"
        className={
          readerExpanded
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : basePage === "lesson" || basePage === "create"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden pt-4"
              : "min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 pb-9"
        }
      >
        <CreateFrame
          create={createFlow}
          locale={uiLocale}
          active={basePage === "create"}
          checking={checking}
          submitting={submitting}
          activeJobCount={runningCount + queuedCount}
          onSubmit={startGeneration}
          canSubmit={createFlow.canSubmit({
            checking,
            submitting,
            hostReady,
            installed,
            driveAccessVerified,
            modelReady: generationServiceReady,
          })}
          preview={
            subtitlePreview && (
              <DeferredView
                locale={uiLocale}
                onBack={() => createFlow.edit({ subtitlePreview: false })}
                backLabel={subtitleLayout.close}
              >
                <SubtitleEditor
                  draft={subtitleDraft}
                  cues={cues}
                  locale={uiLocale}
                  duration={videoDurationMs}
                  connected={videoConnection.connected && !subtitleReaderBlocked}
                  adapter={analysisAdapter}
                  sourceUrl={sourceUrl}
                  onPlaybackError={setError}
                  onSeek={ms => {
                    void analysisAdapter
                      .seek?.(sourceUrl, ms)
                      .catch(error => setError(String(error)));
                  }}
                  onBack={() => createFlow.edit({ subtitlePreview: false })}
                  saveStatus={subtitleSaveStatus}
                />
              </DeferredView>
            )
          }
        >
          <PageSection framed hidden={createStep !== 0}>
            <h2>{flow.video}</h2>
            <div className="min-w-0 border-b border-border pb-4">
              <strong className="block text-ui-heading font-semibold wrap-anywhere">
                {title ||
                  cleanVideoTitle(activeVideo?.title) ||
                  (activeVideo ? flow.videoTitlePending : flow.videoEmpty)}
              </strong>
              <p className="mt-1 text-ui-body text-muted-foreground">
                {!activeVideo
                  ? flow.videoEntryHint
                  : getVideoAdapter(sourceUrl || activeVideo.url).id === "import"
                    ? t("providerImport")
                    : getVideoAdapter(sourceUrl || activeVideo.url).label}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <VideoMetadataButton
                  label={flow.useVideo}
                  busyLabel={metadataUi.buttonBusy}
                  successLabel={metadataUi.buttonSuccess}
                  busy={metadataBusy}
                  success={metadataStatus === metadataUi.success}
                  disabled={metadataBusy || subtitleBusy || checking}
                  onClick={() => void fetchCurrentVideoMetadata()}
                />
                {canGoToSourceVideo && activeVideo && !editingVideo && (
                  <Button variant="outline" size="sm" onClick={() => void goToSourceVideo()}>
                    <ExternalLink aria-hidden="true" />
                    {flow.goToVideo}
                  </Button>
                )}
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
              {metadataStatus && metadataStatus !== metadataUi.success && (
                <p className="my-2 text-xs text-muted-foreground" role="status">
                  {metadataStatus}
                </p>
              )}
              {(editingVideo || !activeVideo) && (
                <>
                  <label className="my-3 grid gap-2 text-ui-label font-semibold">
                    {t("videoTitle")}{" "}
                    <Input
                      value={title}
                      onChange={event => subtitleDraft.setTitle(event.target.value)}
                      placeholder={t("titlePlaceholder")}
                    />
                  </label>
                  <div className="my-3 grid gap-2 text-ui-label font-semibold">
                    <label htmlFor="video-source-url">{t("videoUrl")}</label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="video-source-url"
                        className="min-w-0 flex-1"
                        type="url"
                        value={sourceUrl}
                        onChange={event => subtitleDraft.setSource(event.target.value)}
                        placeholder="https://www.youtube.com/watch?v=…"
                      />
                      {canGoToSourceVideo && (
                        <IconTooltip label={flow.goToVideo}>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-9 shrink-0"
                            aria-label={flow.goToVideo}
                            onClick={() => void goToSourceVideo()}
                          >
                            <ExternalLink aria-hidden="true" />
                          </Button>
                        </IconTooltip>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <section
              aria-label={subtitleLayout.heading}
              data-ui="subtitleState"
              data-state={subtitleState}
              className="mt-4 grid min-w-0 gap-2"
            >
              <h3 className="text-ui-heading font-semibold">{subtitleLayout.heading}</h3>
              <div
                className="relative mt-1 grid min-w-0 gap-2 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:min-w-0 [&_[data-slot=input]]:w-full"
                data-ui="settingField"
              >
                <div className="relative flex min-w-0 items-center gap-2">
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
                  disabled={checking}
                  options={learningLanguageOptions(uiLocale).map(option => ({
                    ...option,
                    description: subtitleReaderBlocked
                      ? undefined
                      : subtitleTrackLabel(option.value),
                  }))}
                  copy={LEARNING_LANGUAGE_SEARCH_COPY[uiLocale]}
                />
              </div>
              {(subtitleState !== "idle" || subtitleReaderBlocked || selectedSubtitleKind) && (
                <div
                  role={subtitleState === "error" ? "alert" : "status"}
                  className="grid gap-1.5 text-ui-body wrap-anywhere"
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {(subtitleState !== "idle" || subtitleReaderBlocked) && (
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        {subtitleState === "ready" && (
                          <Check aria-hidden="true" className="size-4 shrink-0" />
                        )}
                        {subtitleState === "loading" && (
                          <LoaderCircle
                            aria-hidden="true"
                            className="size-4 shrink-0 motion-safe:animate-spin"
                          />
                        )}
                        {subtitleState === "error" && !subtitleReaderBlocked && (
                          <AlertCircle
                            aria-hidden="true"
                            className="size-4 shrink-0 text-destructive"
                          />
                        )}
                        {subtitleState === "ready"
                          ? subtitleMessage(subtitleLayout.loaded, {
                              language: learningLanguageName(profile.targetLanguage, uiLocale),
                              count: cues.length,
                            })
                          : subtitleReaderBlocked
                            ? subtitleLayout.empty
                            : subtitleState === "loading"
                              ? subtitleMessage(subtitleUi.loadingLanguage, {
                                  language: learningLanguageName(profile.targetLanguage, uiLocale),
                                })
                              : subtitleState === "error"
                                ? subtitleMessage(subtitleLayout.failed, {
                                    language: learningLanguageName(
                                      profile.targetLanguage,
                                      uiLocale,
                                    ),
                                  })
                                : subtitleLayout.empty}
                      </span>
                    )}
                    {!subtitleReaderBlocked &&
                      subtitleState !== "ready" &&
                      selectedSubtitleKind && (
                        <span
                          className="text-xs font-normal text-muted-foreground"
                          data-ui="subtitleTrackKind"
                        >
                          {subtitleTrackLabel(profile.targetLanguage)}
                        </span>
                      )}
                  </p>
                  {!subtitleReaderBlocked &&
                    subtitleState !== "loading" &&
                    (subtitleState === "error" ||
                      subtitleTone === "missing" ||
                      subtitleTone === "error") && (
                      <p className="text-ui-body text-muted-foreground">
                        {subtitleRecoveryCopy
                          ? subtitleRecoveryCopy
                          : subtitleMessage(subtitleUi.languageNotReady, {
                              language: learningLanguageName(profile.targetLanguage, uiLocale),
                            })}
                      </p>
                    )}
                  {subtitleState === "ready" && captionSource?.origin === "manual" && (
                    <p className="text-xs text-muted-foreground">
                      {subtitleLayout.source}：
                      {fileName ? fileName.split(".").pop()?.toUpperCase() : subtitleLayout.paste}
                    </p>
                  )}
                </div>
              )}
              {showVideoRecovery && (
                <VideoConnectionNotice
                  locale={uiLocale}
                  hasSubtitles={captionsReady}
                  failed={videoRecovery.failed}
                />
              )}
              {(captionsReady || showVideoRecovery) && (
                <>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {captionsReady && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-expanded={subtitlePreview}
                        aria-controls="subtitle-preview"
                        disabled={subtitleBusy}
                        onClick={() =>
                          createFlow.edit(current => ({
                            subtitlePreview: !current.subtitlePreview,
                          }))
                        }
                      >
                        {subtitlePreview ? subtitleLayout.close : subtitleLayout.preview}
                      </Button>
                    )}
                    {showVideoRecovery && (
                      <VideoConnectionReloadButton
                        locale={uiLocale}
                        busy={reloadingVideoTab || videoRecovery.busy}
                        disabled={subtitleBusy || metadataBusy}
                        onReload={reloadVideoReader}
                      />
                    )}
                    {!subtitleReaderBlocked &&
                      (subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && (
                        <ActionFeedbackButton
                          variant="ghost"
                          data-ui="subtitle-fetch-button"
                          label={subtitleLayout.refresh}
                          busyLabel={subtitleLayout.buttonBusy}
                          successLabel={subtitleLayout.buttonSuccess}
                          busy={subtitleBusy}
                          success={
                            !!subtitleFetchSuccess &&
                            subtitleFetchSuccess.sourceKey === videoSourceKey(sourceUrl) &&
                            subtitleFetchSuccess.language === profile.targetLanguage
                          }
                          disabled={
                            subtitleReaderBlocked || subtitleBusy || metadataBusy || checking
                          }
                          onClick={() => void fetchCurrentSubtitles()}
                        />
                      )}
                  </div>
                </>
              )}
              {(subtitlePlatform === "netflix" || subtitlePlatform === "youtube") && (
                <>
                  {!subtitleReaderBlocked && !captionsReady && (
                    <ActionFeedbackButton
                      variant="outline"
                      data-ui="subtitle-fetch-button"
                      label={subtitleState === "error" ? subtitleLayout.retry : subtitleUi.button}
                      busyLabel={subtitleLayout.buttonBusy}
                      successLabel={subtitleLayout.buttonSuccess}
                      busy={subtitleBusy}
                      success={
                        !!subtitleFetchSuccess &&
                        subtitleFetchSuccess.sourceKey === videoSourceKey(sourceUrl) &&
                        subtitleFetchSuccess.language === profile.targetLanguage
                      }
                      className="w-fit min-w-0 text-center whitespace-normal wrap-anywhere"
                      disabled={subtitleReaderBlocked || subtitleBusy || metadataBusy || checking}
                      onClick={() => void fetchCurrentSubtitles()}
                    />
                  )}
                </>
              )}
            </section>
            <Disclosure
              className="mt-2 min-w-0 [&>div]:border-b-0"
              data-ui="subtitleImport"
              key={subtitlePlatform}
              defaultOpen={subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube"}
              title={<>{subtitleLayout.importAction}</>}
            >
              {subtitlePlatform !== "netflix" && subtitlePlatform !== "youtube" && (
                <p className="my-2 text-ui-body text-muted-foreground" data-ui="hint">
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
                disabled={subtitleBusy || checking}
                importedFileLabel={fileName ? t("importedFile", { name: fileName }) : undefined}
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
            {captionsReady && (
              <div className="border-t border-border pt-4">
                <AnalysisRangePicker
                  cues={cues}
                  value={analysisSelection}
                  onChange={value => createFlow.edit({ analysisSelection: value })}
                  durationMs={analysisDurationMs}
                  estimated={videoDurationMs === undefined}
                  connected={videoConnection.connected && !subtitleReaderBlocked}
                  adapter={analysisAdapter}
                  url={sourceUrl}
                  locale={uiLocale}
                  onError={setError}
                />
              </div>
            )}
          </PageSection>

          <div hidden={createStep !== 1}>
            <Tabs
              value={contentMode}
              onValueChange={value =>
                createFlow.edit({ contentMode: value as "standard" | "custom" })
              }
            >
              <TabsList aria-label={customUi.type} className="grid h-auto grid-cols-2">
                <TabsTrigger value="standard" className="min-h-9 whitespace-normal text-xs">
                  {customUi.standard}
                </TabsTrigger>
                <TabsTrigger value="custom" className="min-h-9 whitespace-normal text-xs">
                  {customUi.markdown}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <PageSection framed hidden={createStep !== 1 || contentMode !== "custom"}>
            <h2>{ux.contentSettings}</h2>
            <CustomPrompt
              locale={uiLocale}
              prompt={customPrompt}
              onPrompt={value => createFlow.edit({ customPrompt: value })}
              context={customContext}
              onContext={value => createFlow.edit({ customContext: value })}
            />
          </PageSection>
          <PageSection
            framed
            hidden={createStep !== 1 || contentMode !== "standard"}
            className="[&_[data-ui=hint]]:my-[4px_9px] [&_[data-ui=settingField]_[data-slot=select-trigger]]:min-h-8 [&_[data-ui=settingField]_[data-slot=select-trigger]]:w-full [&_[data-ui=advancedLessonSettings]]:mt-4 [&_[data-ui=advancedLessonSettings]>div]:border-b-0"
          >
            <h2>{ux.contentSettings}</h2>
            <div className="my-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-4 gap-y-3 [&_[data-ui=settingField]]:m-0">
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
                    explanation={levelHint(settingsCopy, profile.targetLanguage, profile.level)}
                    items={levelOptions.map(value => {
                      const info = settingsCopy.levels[profile.targetLanguage][value];
                      return {
                        value,
                        valueLabel: value === UNRESTRICTED_LEVEL ? "" : value,
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
                      level === UNRESTRICTED_LEVEL
                        ? learningLevelLabel(uiLocale, level)
                        : level +
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
                <SearchableSelectField
                  id="learning-explanation-language"
                  ariaLabel={t("instructionLanguage")}
                  value={
                    explanationLanguageMode === "auto" ? "__auto__" : profile.instructionLanguage
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
                    ...learningLanguageOptions(uiLocale).map(option => ({
                      ...option,
                      label: explanationLanguageName(option.value, uiLocale),
                    })),
                  ]}
                  copy={LEARNING_LANGUAGE_SEARCH_COPY[uiLocale]}
                />
              </div>
            </Disclosure>
          </PageSection>

          <PageSection framed hidden={createStep !== 2} data-ui="create-confirmation">
            <h2>{ux.confirm}</h2>
            <section
              className="grid gap-2 border-b border-border pb-4"
              data-ui="confirmation-summary"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-ui-heading font-semibold">{flow.video}</h3>
                <Button size="sm" variant="ghost" onClick={() => createFlow.goTo(0)}>
                  {ux.edit}
                </Button>
              </div>
              <div className="grid min-w-0 gap-1">
                <p className="line-clamp-2 wrap-anywhere" title={title}>
                  {title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {subtitleMessage(subtitleLayout.loaded, {
                    language: learningLanguageName(profile.targetLanguage, uiLocale),
                    count: cues.length,
                  })}{" "}
                  ·{" "}
                  {
                    analysisRangeCopy(uiLocale)[
                      analysisSelection.mode === "first"
                        ? "first"
                        : analysisSelection.mode === "second"
                          ? "second"
                          : analysisSelection.mode === "custom"
                            ? "custom"
                            : "full"
                    ]
                  }
                </p>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="grid min-w-0 gap-1">
                  <h3 className="text-ui-heading font-semibold">{ux.contentSettings}</h3>
                  <p>
                    {contentMode === "standard"
                      ? customUi.standard + " · " + learningLevelLabel(uiLocale, profile.level)
                      : customUi.markdown}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => createFlow.goTo(1)}>
                  {ux.edit}
                </Button>
              </div>
              {contentMode === "standard" && (
                <p
                  className="text-ui-body text-muted-foreground wrap-anywhere"
                  data-ui="confirmation-content-hint"
                >
                  {t("lessonContentSummary", { scenes: profile.sceneCount, examples: 1 })}
                </p>
              )}
            </section>
            <Dialog
              open={!!duplicateWarning}
              onOpenChange={open => {
                if (!open) cancelDuplicate();
              }}
            >
              <DialogContent
                showCloseButton={false}
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
              >
                <DialogTitleBar closeLabel={t("cancelNoGeneration")}>
                  {t("duplicateFound", { count: duplicateWarning?.matches.length ?? 0 })}
                </DialogTitleBar>
                <DialogDescription className="text-ui-body">
                  {t("duplicateNewVersion")}
                </DialogDescription>
                {duplicateWarning?.matches.map(match => (
                  <div
                    className="mb-2 min-w-0 max-w-full rounded-[var(--radius)] border border-border p-3 text-ui-body wrap-anywhere [&_p]:mt-2 [&_p]:text-ui-label [&_p]:text-muted-foreground"
                    key={match.documentId}
                  >
                    <strong className="font-semibold">{match.title}</strong>
                    <p>
                      {new Date(match.createdAt).toLocaleString(uiLocale)}
                      {match.jobStatus &&
                      match.jobStatus !== "completed" &&
                      Object.hasOwn(jobStatusKeys, match.jobStatus)
                        ? " · " + t(jobStatusKeys[match.jobStatus as JobSummary["status"]])
                        : ""}
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
                  <Button size="sm" onClick={confirmRegeneration}>
                    {t("confirmNewVersion")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelDuplicate}>
                    {t("cancelNoGeneration")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <RequestModelSelection
              locale={uiLocale}
              customModels={customModels[generationAgent.provider] ?? []}
              onCustomModel={modelId => rememberCustomModel(generationAgent.provider, modelId)}
              selected={generationAgent}
              providers={agentCatalog}
              available={hostReady && !checking}
              onChange={value => createFlow.edit({ requestAgent: value })}
              onReady={setGenerationServiceReady}
              onConfigure={() => {
                setReturnPage("create");
                setSettingsSection("ai");
                setPage("settings");
              }}
            />
            <section
              className="mt-4 grid min-w-0 gap-2 border-t border-border pt-4"
              data-ui="requestStorage"
            >
              <h3 className="text-ui-heading font-semibold">{t("storageLocation")}</h3>
              <RequestFolderSelection
                locale={uiLocale}
                directory={requestDestination?.directory ?? destination.directory}
                defaultPath={t("defaultFolder")}
                disabled={!hostReady || storageBusy || checking}
                onChoose={() => void chooseFolder(true)}
              />
              <RequestBackupSwitch
                locale={uiLocale}
                enabled={(requestBackup ?? backup).enabled}
                disabled={!driveAccessVerified || checking}
                accountEmail={driveAccounts.find(account => account.id === selectedDriveId)?.email}
                accessStatus={
                  !driveAccountsLoaded
                    ? "checking"
                    : !selectedDriveId
                      ? "disconnected"
                      : driveAccess?.accountId === selectedDriveId
                        ? driveAccess.status
                        : "checking"
                }
                onChange={enabled =>
                  createFlow.edit({
                    requestBackup: {
                      ...(requestBackup ?? backup),
                      enabled,
                      accountId: selectedDriveId,
                    },
                  })
                }
                onSettings={() => {
                  setReturnPage("create");
                  setSettingsSection("storage");
                  setPage("settings");
                }}
              />
            </section>
            <GenerationEstimate
              locale={uiLocale}
              payload={estimatePayload}
              available={createStep === 2 && hostReady && generationServiceReady && !checking}
            />
          </PageSection>
        </CreateFrame>

        <main
          id={basePage === "lesson" ? undefined : "page-panel-lessons"}
          ref={libraryMotionRef}
          aria-labelledby="page-nav-lessons"
          className="mx-auto w-full min-w-0 max-w-[640px]"
          hidden={basePage !== "lessons"}
        >
          <Tabs
            value={libraryView}
            onValueChange={view => setLibraryView(view === "favorites" ? "favorites" : "all")}
            className="pt-3"
          >
            <div className="px-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="all">{favoritesCopy(uiLocale).lessons}</TabsTrigger>
                <TabsTrigger value="favorites">{favoritesCopy(uiLocale).title}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="favorites" className="mt-0">
              <FavoritesLibrary
                locale={uiLocale}
                defaultAccountId={selectedDriveId}
                active={basePage === "lessons"}
                accounts={driveAccounts}
                onOpen={openFavorite}
                onConnect={accountId => connectDrive("library", accountId)}
              />
            </TabsContent>
            <TabsContent value="all" className="mt-0 p-3">
              <VideoLibrary
                localCustom={localCustom}
                cloudCustom={cloudCustom}
                onOpenCustom={openCustomDocument}
                onRestoreCustom={restoreCustom}
                onCreate={() => {
                  createFlow.goTo(0);
                  setPage("create");
                }}
                localLessons={localLessons}
                cloudLessons={cloudLessons}
                driveAccounts={driveAccounts}
                driveConfigured={driveConfigured === true}
                lessonsBusy={lessonsBusy}
                catalogError={catalogError}
                catalogErrorAccountId={catalogErrorAccountId}
                restoreBusy={restoreBusy}
                generating={generating}
                storageBusy={storageBusy}
                uiLocale={uiLocale}
                t={t}
                onRefresh={loadLessons}
                onConnectDrive={accountId => connectDrive("library", accountId)}
                onOpen={openSavedDocument}
                onRestore={restoreLesson}
                onDeleteLocal={deleteLocalDocument}
              />
            </TabsContent>
          </Tabs>
        </main>

        <Sheet
          open={overlay}
          onOpenChange={open => {
            if (!open && (!unsavedCredentials || window.confirm(ux.discardCredentials))) {
              setPage(returnPage);
            }
          }}
        >
          <SheetContent
            closeLabel={ux.close}
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-full max-w-[400px] gap-0 overflow-hidden sm:max-w-[400px] outline-none data-[state=open]:duration-[320ms] data-[state=closed]:duration-[240ms]"
            onInteractOutside={event => {
              if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]"))
                event.preventDefault();
            }}
            onEscapeKeyDown={event => {
              if (
                event.target instanceof Element &&
                event.target.closest('[data-ui="customModel"][data-editing="true"]')
              )
                event.preventDefault();
            }}
            onCloseAutoFocus={event => {
              event.preventDefault();
              restoreFocusWithoutTooltip(
                window.document.getElementById(sheetOrigin.current) ??
                  window.document.getElementById(
                    sheetPage.current === "settings" ? "header-settings" : "header-activity",
                  ),
              );
            }}
          >
            <header data-ui="sheet-header" className="shrink-0 border-b border-border px-4 py-3">
              <SheetTitleRow closeLabel={ux.close}>
                {sheetPage.current === "activity" ? (
                  executionDetails ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setExecutionDetails(null);
                        window.requestAnimationFrame(() => executionFocus.current?.focus());
                      }}
                    >
                      <ArrowLeft className="size-4" />
                      {layout.activity}
                    </Button>
                  ) : (
                    <SheetTitle ref={executionHeading} tabIndex={-1} className="outline-none">
                      {layout.activity}
                    </SheetTitle>
                  )
                ) : settingsSection ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={
                        settingsSection === "speech-resources"
                          ? speechDownloadCopy(uiLocale).back
                          : t("settings")
                      }
                      onClick={() => {
                        if (settingsSection === "speech-resources") {
                          setSpeechManageFocus(true);
                          setSettingsSection("general");
                          window.requestAnimationFrame(() => {
                            const scroll = window.document.querySelector(
                              '[data-ui="sheet-scroll"]',
                            );
                            if (scroll) scroll.scrollTop = speechSettingsScroll.current;
                            restoreFocusWithoutTooltip(
                              window.document.getElementById("system-speech-manage"),
                            );
                          });
                          return;
                        }
                        if (!unsavedCredentials || window.confirm(ux.discardCredentials))
                          setSettingsSection(null);
                      }}
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" />
                    </Button>
                    <SheetTitle
                      ref={
                        settingsSection === "speech-resources" ? speechManagerHeading : undefined
                      }
                      tabIndex={settingsSection === "speech-resources" ? -1 : undefined}
                      className="outline-none"
                    >
                      {settingsSection === "speech-resources"
                        ? speechDownloadCopy(uiLocale).title
                        : layout[settingsSection]}
                    </SheetTitle>
                  </>
                ) : (
                  <SheetTitle>{t("settings")}</SheetTitle>
                )}
              </SheetTitleRow>
              {sheetPage.current === "activity" && executionDetails && (
                <SheetTitle ref={executionHeading} tabIndex={-1} className="mt-2 outline-none">
                  {customUi.details}
                </SheetTitle>
              )}
            </header>
            <div
              data-ui="sheet-scroll"
              ref={sheetMotionRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 [&>main>section:first-child]:pt-4"
            >
              {sheetPage.current === "activity" && (
                <main id="page-panel-activity" aria-label={layout.activity}>
                  {executionDetails && (
                    <PageSection>
                      <p className="mb-4 text-ui-heading font-semibold wrap-anywhere">
                        {executionDetails.title}
                      </p>
                      <ExecutionDetails execution={executionDetails.execution} locale={uiLocale} />
                      {executionDetails.markdown && (
                        <Button
                          variant="outline"
                          className="mt-3"
                          onClick={() =>
                            exportMarkdown(executionDetails.markdown!, executionDetails.title)
                          }
                        >
                          {customUi.exportMarkdown}
                        </Button>
                      )}
                    </PageSection>
                  )}
                  <div hidden={!!executionDetails}>
                    <TaskHistory
                      onDetails={showExecution}
                      jobs={jobs}
                      cancellations={cancellations}
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
                      onCancel={job => generationSession.cancelJob(job.id, job.kind ?? "standard")}
                      onOpen={openSavedDocument}
                      onOpenPreview={id => previewSession.open(id)}
                      onRetryPublication={retryPublication}
                      onRetryBackup={retryBackup}
                      onListEnded={listEndedJobs}
                      onDeleteRecords={deleteJobRecords}
                      onViewVoice={viewDownloadedVoice}
                    />
                  </div>
                </main>
              )}

              {sheetPage.current === "settings" && (
                <main id="page-panel-settings" aria-label={t("settings")}>
                  {!settingsSection && (
                    <PageSection>
                      <nav aria-label={t("settings")}>
                        <ul className="grid divide-y divide-border">
                          {(["general", "ai", "storage", "advanced"] as const).map(section => (
                            <li key={section} className="py-2 first:pt-0 last:pb-0">
                              <Button
                                variant="ghost"
                                className="h-auto min-h-12 w-full justify-between rounded-lg px-3 py-3 text-left whitespace-normal"
                                onClick={() => setSettingsSection(section)}
                              >
                                <span className="min-w-0">
                                  <span className="block text-ui-heading font-semibold">
                                    {layout[section]}
                                  </span>
                                  <span className="mt-1 block whitespace-normal text-ui-label leading-relaxed text-muted-foreground wrap-anywhere">
                                    {section === "ai" && agent.provider
                                      ? agentDisplayName(
                                          agent.provider,
                                          agentCatalog.find(
                                            provider => provider.id === agent.provider,
                                          )?.label,
                                        ) + (agent.modelId ? " · " + agent.modelId : "")
                                      : section === "storage"
                                        ? layout.storageHint
                                        : layout[(section + "Hint") as "generalHint"]}
                                  </span>
                                </span>
                                <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </nav>
                    </PageSection>
                  )}

                  {settingsSection === "speech-resources" && (
                    <PageSection className="first:pt-2">
                      <DeferredView locale={uiLocale}>
                        <SiriVoiceManagerPage
                          locale={uiLocale}
                          defaultLanguage={speechSettingsLanguage ?? profile.targetLanguage}
                          focusVoice={speechTargetVoice}
                        />
                      </DeferredView>
                    </PageSection>
                  )}
                  {settingsSection === "general" && (
                    <PageSection className="grid gap-6 first:pt-2">
                      <div className="grid min-w-0 gap-3">
                        <h3 className="text-ui-heading font-semibold">
                          {layout.interfaceSettings}
                        </h3>
                        <AppearancePreferences
                          locale={uiLocale}
                          browserLocale={browserLocale}
                          localePreference={localePreference}
                          themePreference={themePreference}
                          onLocale={setLocalePreference}
                          onTheme={setThemePreference}
                        />
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <div className="grid min-w-0 gap-1">
                            <label
                              htmlFor="motion-preference"
                              className="text-ui-label font-semibold leading-5"
                            >
                              {motionCopy[uiLocale].label}
                            </label>
                            <p
                              id="motion-preference-hint"
                              className="text-ui-label leading-relaxed text-muted-foreground"
                            >
                              {motionCopy[uiLocale].hint}
                            </p>
                          </div>
                          <Switch
                            id="motion-preference"
                            aria-label={motionCopy[uiLocale].label}
                            aria-describedby="motion-preference-hint"
                            checked={motionPreference === "reduced"}
                            onCheckedChange={checked =>
                              setMotionPreference(checked ? "reduced" : "full")
                            }
                          />
                        </div>
                      </div>
                      <NotificationSettings
                        locale={uiLocale}
                        completed={analysisNotificationsEnabled}
                        attention={attentionNotificationsEnabled}
                        onCompleted={setAnalysisNotificationsEnabled}
                        onAttention={setAttentionNotificationsEnabled}
                      />
                      <DeferredView locale={uiLocale}>
                        <SpeechSettingsPanel
                          locale={uiLocale}
                          defaultLanguage={speechSettingsLanguage ?? profile.targetLanguage}
                          onManageVoices={language => {
                            setSpeechManageFocus(false);
                            setSpeechSettingsLanguage(language);
                            setSpeechTargetVoice(null);
                            speechSettingsScroll.current =
                              window.document.querySelector('[data-ui="sheet-scroll"]')
                                ?.scrollTop ?? 0;
                            setSettingsSection("speech-resources");
                            window.requestAnimationFrame(() => {
                              const scroll = window.document.querySelector(
                                '[data-ui="sheet-scroll"]',
                              );
                              if (scroll) scroll.scrollTop = 0;
                              speechManagerHeading.current?.focus({ preventScroll: true });
                            });
                          }}
                          restoreManageFocus={
                            speechManageFocus ? () => setSpeechManageFocus(false) : undefined
                          }
                        />
                      </DeferredView>
                    </PageSection>
                  )}
                  {settingsSection === "ai" && (
                    <PageSection className="grid gap-6">
                      <div>
                        <h2 id="agent-settings-heading" tabIndex={-1}>
                          {piCopy[uiLocale].title}
                        </h2>
                        <p className="mb-4 text-ui-body" data-ui="hint">
                          {piCopy[uiLocale].hint}
                        </p>
                        <AiModelSelection
                          locale={uiLocale}
                          id="settings"
                          provider={agent.provider}
                          modelId={agent.modelId}
                          customModel={agent.customModel}
                          customModels={customModels[agent.provider] ?? []}
                          onRemoveCustomModel={modelId =>
                            setCustomModels(previous => ({
                              ...previous,
                              [agent.provider]: (previous[agent.provider] ?? []).filter(
                                id => id !== modelId,
                              ),
                            }))
                          }
                          providers={agentCatalog}
                          models={modelOptions}
                          available={hostReady && !generating}
                          busy={modelBusy}
                          notice={modelNotice}
                          warning={modelWarning}
                          onProvider={selectAgent}
                          onModel={(modelId, customModel) =>
                            updateAgent({
                              ...agent,
                              modelId,
                              customModel,
                              thinkingLevel: undefined,
                            })
                          }
                          thinkingLevel={agent.thinkingLevel}
                          onThinking={thinkingLevel => updateAgent({ ...agent, thinkingLevel })}
                          onRefresh={() => {
                            setModelBusy(true);
                            setModelRefreshVersion(current => current + 1);
                          }}
                        />
                      </div>
                      <DeferredView locale={uiLocale}>
                        <PiSettings
                          locale={uiLocale}
                          available={hostReady}
                          selectedProvider={agent.provider}
                          onSelect={selectAgent}
                          onDirty={setUnsavedCredentials}
                          onChanged={checkHost}
                        />
                      </DeferredView>
                    </PageSection>
                  )}
                  {settingsSection === "storage" && (
                    <PageSection className="grid gap-6 first:pt-2">
                      <section data-ui="localStorage" className="grid min-w-0 gap-2">
                        <header className="flex items-center justify-between gap-2">
                          <h3 className="text-ui-heading font-semibold">{t("storageLocation")}</h3>
                          <IconTooltip label={layout.openFolder}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={layout.openFolder}
                              disabled={storageBusy || !hostReady}
                              onClick={() => void openFolder()}
                            >
                              <FolderOpen className="size-4" aria-hidden="true" />
                            </Button>
                          </IconTooltip>
                        </header>
                        <div className="grid min-w-0 gap-2">
                          <RequestFolderSelection
                            locale={uiLocale}
                            directory={destination.directory}
                            defaultPath={t("defaultFolder")}
                            disabled={storageBusy || generating || !hostReady}
                            onChoose={() => void chooseFolder()}
                          />
                          {destination.directory && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-self-start"
                              onClick={() => setDestination({ kind: "local" })}
                            >
                              {t("useDefaultFolder")}
                            </Button>
                          )}
                          <p className="text-ui-body text-muted-foreground" data-ui="hint">
                            {t("localAlways")}
                          </p>
                        </div>
                      </section>
                      <DeferredView locale={uiLocale}>
                        <DriveBackupSettings
                          locale={uiLocale}
                          backup={backup}
                          accounts={driveAccounts}
                          configured={driveConfigured}
                          accountsLoading={driveAccountsLoading}
                          accountsError={driveAccountsError}
                          onRetryAccounts={() => void refreshDriveAccounts()}
                          verified={driveAccessVerified}
                          accessChecking={
                            driveAccess?.accountId === selectedDriveId &&
                            driveAccess?.status === "checking"
                          }
                          busy={storageBusy}
                          error={driveConnectError}
                          folderUrl={driveFolderUrl}
                          jobs={jobs}
                          phase={backupPhase}
                          feedback={backupFeedback}
                          onEnabled={enabled =>
                            enabled
                              ? void enableBackup()
                              : setBackup(current => ({ ...current, enabled: false }))
                          }
                          onAccount={accountId => setBackup(current => ({ ...current, accountId }))}
                          onConnect={() => void connectDrive()}
                          onDisconnect={accountId => void disconnectDrive(accountId)}
                          onRetryAccess={() => void enableBackup()}
                          onReconnect={() => void connectDrive("backup", selectedDriveId)}
                          onOpenFolder={() =>
                            driveFolderUrl && void chrome.tabs.create({ url: driveFolderUrl })
                          }
                          onBackup={() => void backupExistingLessons()}
                          onRetryFailed={() => void retryFailedBackups()}
                        />
                      </DeferredView>
                    </PageSection>
                  )}
                  {settingsSection === "advanced" && (
                    <PageSection>
                      <p className="mb-4 text-ui-body">{layout.hostHelp}</p>
                      <HostConnectionSettings
                        locale={uiLocale}
                        connected={installed !== null}
                        checked={hostChecked}
                        sdkMode={hostSdkMode}
                        protocolVersion={hostProtocolVersion}
                        version={hostVersion}
                        busy={hostBusy}
                        lastCheckedAt={hostLastCheckedAt}
                        checkSuccess={hostCheckSuccess}
                        error={hostStatus}
                        onCheck={() => checkHost(true)}
                      />
                    </PageSection>
                  )}
                </main>
              )}
            </div>
          </SheetContent>
        </Sheet>
        {basePage === "custom" && customFavoriteReader && (
          <main
            className="flex min-h-0 flex-1 flex-col"
            aria-label={customFavoriteReader.document.title}
          >
            <DeferredView
              locale={uiLocale}
              onBack={backToLibrary}
              backLabel={favoritesCopy(uiLocale).back}
            >
              <CustomViewer
                key={"favorite:" + customFavoriteReader.document.id}
                mode="favorite"
                document={customFavoriteReaderDocument(customFavoriteReader)}
                locale={uiLocale}
                busy={false}
                backLabel={favoritesCopy(uiLocale).back}
                onBack={() => {
                  setLibraryView("favorites");
                  backToLibrary();
                }}
              />
            </DeferredView>
          </main>
        )}
        {basePage === "custom" && customDocument && !customFavoriteReader && (
          <main className="flex min-h-0 flex-1 flex-col" aria-label={customDocument.title}>
            <DeferredView locale={uiLocale} onBack={backToLibrary} backLabel={flow.backLibrary}>
              <CustomViewer
                key={customDocument.id}
                document={customDocument}
                locale={uiLocale}
                busy={storageBusy || generating}
                backLabel={flow.backLibrary}
                onBack={backToLibrary}
                menuActions={[
                  { label: layout.activity, onSelect: openActivity },
                  {
                    label: t("settings"),
                    onSelect: () => {
                      setReturnPage("custom");
                      setSettingsSection(null);
                      setPage("settings");
                    },
                  },
                ]}
                onRename={title => customMutation("renameCustomDocument", title)}
                onDelete={() => customMutation("deleteCustomDocument")}
                onReuse={() => {
                  createFlow.edit({
                    contentMode: "custom",
                    customPrompt: customDocument.request.prompt,
                    customContext: customDocument.request.context,
                    createStep: 0,
                  });
                  setPage("create");
                }}
                onRegenerate={() => {
                  const snapshot = CustomGenerationRequestSchema.parse({
                    ...customDocument.request,
                    id: crypto.randomUUID(),
                    previousDocumentId: customDocument.id,
                    agent: {
                      ...customDocument.request.agent,
                      provider: customDocument.execution.provider,
                      modelId: customDocument.execution.modelId,
                    },
                  });
                  generationSession.start(snapshot, true);
                }}
              />
            </DeferredView>
          </main>
        )}
        <Dialog
          open={!!draftState.pendingCaption}
          onOpenChange={open => {
            if (!open) subtitleDraft.resolveCaption(false);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader className="text-left">
              <DialogTitleBar closeLabel={ux.cancel}>{ux.conflict}</DialogTitleBar>
              <DialogDescription className="text-ui-body">
                {ux.keepEdits} / {ux.useNew}
              </DialogDescription>
            </DialogHeader>
            <Button variant="outline" onClick={() => subtitleDraft.resolveCaption(false)}>
              {ux.keepEdits}
            </Button>
            <Button onClick={() => subtitleDraft.resolveCaption(true)}>{ux.useNew}</Button>
            <Button variant="ghost" onClick={() => subtitleDraft.resolveCaption(false)}>
              {ux.cancel}
            </Button>
          </DialogContent>
        </Dialog>
        {basePage === "lesson" && (
          <main
            className="flex min-h-0 flex-1 flex-col"
            id="page-panel-lessons"
            aria-label={
              favoriteReader?.document.source.title ?? document?.source.title ?? t("lessonLibrary")
            }
          >
            {favoriteReader ? (
              <ContextualSceneReader
                key={favoriteReader.document.id}
                mode="favorite"
                fullscreen
                favoriteOrigin={favoriteReader.origin}
                backLabel={favoritesCopy(uiLocale).back}
                onBack={() => {
                  setLibraryView("favorites");
                  backToLibrary();
                }}
                document={favoriteReader.document}
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
                onError={() =>
                  toast.error(favoritesCopy(uiLocale).error, {
                    id: "favorites-reader",
                    position: "bottom-center",
                    duration: 2500,
                    closeButton: true,
                  })
                }
                onNotice={message =>
                  toast.info(message, {
                    id: "favorites-reader",
                    position: "bottom-center",
                    duration: 2500,
                    closeButton: true,
                  })
                }
              />
            ) : document ? (
              <>
                {previewInfo && (
                  <div
                    data-ui="generationPreview"
                    role="status"
                    aria-live="polite"
                    className="border-b bg-card px-3 py-2 text-ui-body"
                  >
                    <div className="mx-auto flex max-w-[720px] flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium tabular-nums">
                          {generationPreviewCopy[uiLocale].ready(
                            previewInfo.readySceneIds.length,
                            previewInfo.selectedSceneCount,
                          )}
                        </span>{" "}
                        {["running", "queued"].includes(previewInfo.status)
                          ? generationPreviewCopy[uiLocale].working
                          : generationPreviewCopy[uiLocale].unfinished}
                        <p className="m-0">{generationPreviewCopy[uiLocale].readOnly}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={openActivity}>
                        {generationPreviewCopy[uiLocale].activity}
                      </Button>
                    </div>
                  </div>
                )}
                <ContextualSceneReader
                  key={document.id}
                  fullscreen
                  backLabel={flow.backLibrary}
                  onBack={backToLibrary}
                  menuActions={[
                    { label: layout.activity, onSelect: openActivity },
                    {
                      label: t("settings"),
                      onSelect: () => {
                        setReturnPage("lesson");
                        setSettingsSection(null);
                        setPage("settings");
                      },
                    },
                  ]}
                  document={document}
                  favoriteControl={previewInfo ? () => null : undefined}
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
                  onSaveRange={
                    previewInfo
                      ? undefined
                      : (cueId, range) => saveDocumentPlaybackRange(document.id, cueId, range)
                  }
                  onSaveSceneRange={
                    previewInfo
                      ? undefined
                      : (sceneId, range) =>
                          saveDocumentScenePlaybackRange(document.id, sceneId, range)
                  }
                />
              </>
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
