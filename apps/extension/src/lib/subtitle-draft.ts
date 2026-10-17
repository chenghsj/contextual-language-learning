import {
  parseSubtitles,
  serializeSubtitleMarkup,
  parsePlainText,
  formatRangeTime,
  LEARNING_LANGUAGES,
  type LearningLanguage,
  type SubtitleCue,
} from "@contextual/core";
import { getVideoAdapter } from "../video";
import { shouldFollowSelectedVideo } from "../video/draft-navigation";
import {
  captionCacheKey,
  videoSourceKey,
  isCurrentCaption,
  subtitleLanguageMatches,
  type CaptionProvenance,
} from "../video/caption-provenance";
import { detectCurrentVideoMetadata, metadataSourceSafety } from "../video/metadata-resolver";
import { titleForVideoTab } from "../video/metadata";
import {
  getActiveWindowTab,
  findVideoTab,
  assertVideoReaderReady,
  reloadExistingVideoTab,
  VideoCommandError,
} from "../video/tab";
import { needsVideoReaderReload } from "../video/reader-health";
import {
  subtitleAcquisition,
  subtitleMessage,
  type SubtitleFailure,
} from "../i18n/subtitle-acquisition";
import { videoMetadataMessages } from "../i18n/video-metadata";
import { learningLanguageName } from "../i18n/preferences";
import { translate, type UiLocale } from "../i18n/messages";
import { playbackCueMap as derivePlaybackCues } from "../video/reader-playback";
import type { LoopWindow } from "../video/loop-window";
function sourceCues(raw: string) {
  return raw.includes("-->") ? parseSubtitles(raw) : parsePlainText(raw);
}
function inferredTimingOverrides(cues: SubtitleCue[], original: SubtitleCue[]) {
  const byId = new Map(original.map(cue => [cue.id, cue]));
  return Object.fromEntries(
    cues.flatMap(cue => {
      const source = byId.get(cue.id);
      return source &&
        cue.startMs !== null &&
        cue.endMs !== null &&
        (cue.startMs !== source.startMs || cue.endMs !== source.endMs)
        ? [[cue.id, { startMs: cue.startMs, endMs: cue.endMs }]]
        : [];
    }),
  ) as Record<string, LoopWindow>;
}
export type SelectedVideo = { tabId: number; windowId: number; url: string; title: string };
export type SubtitleDraftState = {
  raw: string;
  originalRaw: string;
  edited: boolean;
  pendingCaption: {
    raw: string;
    source: CaptionProvenance;
    url: string;
    title: string;
    fileName: string;
  } | null;
  fileName: string;
  sourceUrl: string;
  title: string;
  captionSource: CaptionProvenance | null;
  subtitleBusy: boolean;
  subtitleStatus: string | SubtitleFailure;
  subtitleTone: "neutral" | "loading" | "success" | "missing" | "error";
  videoRecoveryUrl: string;
  reloadingVideoTab: boolean;
  metadataBusy: boolean;
  metadataStatus: string;
  activeVideo: SelectedVideo | null;
  trackBusy: boolean;
  trackInfo: {
    sourceKey: string;
    status: "available" | "unknown";
    tracks: { language: string; kind: "manual" | "auto" | "translated" }[];
  } | null;
  error: string;
  pasteDrafts: Record<string, string>;
  ready: boolean;
  cues: SubtitleCue[];
  timingOverrides: Record<string, LoopWindow>;
};
export const browserSubtitleAdapters = {
  getAdapter: getVideoAdapter,
  detectMetadata: detectCurrentVideoMetadata,
  selectedTab: getActiveWindowTab,
  findTab: findVideoTab,
  assertReady: assertVideoReaderReady,
  titleForTab: titleForVideoTab,
  reloadTab: reloadExistingVideoTab,
  confirm: (message: string) => window.confirm(message),
  readFile: (file: { text(): Promise<string> }) => file.text(),
};
/** Draft provenance, cache and all async request versions live together. */
export class SubtitleDraft {
  private state: SubtitleDraftState = {
    raw: "",
    originalRaw: "",
    edited: false,
    pendingCaption: null,
    fileName: "",
    sourceUrl: "",
    title: "",
    captionSource: null,
    subtitleBusy: false,
    subtitleStatus: "",
    subtitleTone: "neutral",
    videoRecoveryUrl: "",
    reloadingVideoTab: false,
    metadataBusy: false,
    metadataStatus: "",
    activeVideo: null,
    trackBusy: false,
    trackInfo: null,
    error: "",
    pasteDrafts: {},
    ready: false,
    cues: [],
    timingOverrides: {},
  };
  private listeners = new Set<(state: SubtitleDraftState) => void>();
  private cache = new Map<
    string,
    {
      raw: string;
      originalRaw?: string;
      cues?: SubtitleCue[];
      timingOverrides?: Record<string, LoopWindow>;
      fileName: string;
      source: CaptionProvenance;
    }
  >();
  private revisions: {
    key: string;
    raw: string;
    originalRaw: string;
    cues: SubtitleCue[];
    timingOverrides?: Record<string, LoopWindow>;
  }[] = [];
  private metadataVersion = 0;
  private captionVersion = 0;
  private trackVersion = 0;
  private selectionVersion = 0;
  private manualTitle = false;
  private blocked = false;
  private readerBlocked = false;
  constructor(
    private language: LearningLanguage,
    private locale: UiLocale,
    private adapters = browserSubtitleAdapters,
  ) {}
  configure(locale: UiLocale, blocked: boolean, readerBlocked: boolean) {
    this.locale = locale;
    this.blocked = blocked;
    this.readerBlocked = readerBlocked;
  }
  get snapshot() {
    return this.state;
  }
  /** Effective UI/preview times use source starts and independent saved manual ranges. */
  playbackCueMap(resetCueId?: string) {
    const originals = new Map(sourceCues(this.state.originalRaw).map(cue => [cue.id, cue]));
    const cues = this.state.cues.map(cue => {
      const source = originals.get(cue.id);
      return source ? { ...cue, startMs: source.startMs, endMs: source.endMs } : cue;
    });
    const overrides = { ...this.state.timingOverrides };
    if (resetCueId) delete overrides[resetCueId];
    return derivePlaybackCues(cues, this.adapters.getAdapter(this.state.sourceUrl).id, overrides);
  }
  subscribe(listener: (state: SubtitleDraftState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private get subtitleUi() {
    return subtitleAcquisition[this.locale];
  }
  private get metadataUi() {
    return videoMetadataMessages[this.locale];
  }
  private set<K extends keyof SubtitleDraftState>(
    key: K,
    value: SubtitleDraftState[K] | ((previous: SubtitleDraftState[K]) => SubtitleDraftState[K]),
  ) {
    this.update({ [key]: typeof value === "function" ? value(this.state[key]) : value });
  }
  private update(next: Partial<SubtitleDraftState>) {
    const state = { ...this.state, ...next };
    if (next.raw !== undefined) {
      state.cues =
        next.cues ??
        (state.raw.includes("-->") ? parseSubtitles(state.raw) : parsePlainText(state.raw));
      state.originalRaw = next.originalRaw ?? (next.cues ? state.originalRaw : state.raw);
      const original = sourceCues(state.originalRaw);
      state.timingOverrides = next.timingOverrides ?? inferredTimingOverrides(state.cues, original);
      state.edited =
        JSON.stringify(state.cues) !== JSON.stringify(original) ||
        Object.keys(state.timingOverrides).length > 0;
    }
    state.ready =
      state.cues.length > 0 &&
      state.cues.length <= 3000 &&
      state.cues.every(cue => cue.originalText.length <= 1500) &&
      state.cues.reduce((count, cue) => count + cue.originalText.length, 0) <= 220000 &&
      isCurrentCaption(state.captionSource, this.language, state.sourceUrl);
    this.state = state;
    if (state.ready && !state.subtitleBusy && state.captionSource)
      this.cache.set(captionCacheKey(state.sourceUrl, this.language), {
        raw: state.raw,
        originalRaw: state.originalRaw,
        cues: state.cues,
        timingOverrides: state.timingOverrides,
        fileName: state.fileName,
        source: state.captionSource,
      });
    for (const listener of this.listeners) listener(state);
  }
  editCue(
    id: string,
    changes: Pick<SubtitleCue, "originalText" | "startMs" | "endMs">,
    duration?: number,
    timingMode: "preserve" | "manual" | "reset" = "manual",
  ) {
    if (!this.state.ready || !this.state.cues.some(cue => cue.id === id))
      throw new Error(this.subtitleUi.unavailable);
    const current = this.state.cues.find(cue => cue.id === id)!;
    const original = sourceCues(this.state.originalRaw).find(cue => cue.id === id) ?? current;
    const { startMs, endMs } =
      timingMode === "reset" ? original : timingMode === "preserve" ? current : changes;
    const { originalText } = changes;
    const timingOverrides = { ...this.state.timingOverrides };
    if (timingMode === "reset") delete timingOverrides[id];
    else if (timingMode === "manual" && startMs !== null && endMs !== null)
      timingOverrides[id] = { startMs, endMs };
    if (
      !originalText.trim() ||
      originalText.length > 1500 ||
      (startMs === null) !== (endMs === null) ||
      (startMs !== null &&
        endMs !== null &&
        (!Number.isInteger(startMs) ||
          !Number.isInteger(endMs) ||
          startMs < 0 ||
          startMs >= endMs ||
          (duration !== undefined && endMs > duration)))
    )
      throw new Error("Invalid subtitle text or timing");
    const cues = this.state.cues.map(cue => {
      if (cue.id !== id) return cue;
      const updated = { ...cue, originalText, startMs, endMs };
      // A user rewrite invalidates source offsets and the associated source reading.
      if (cue.originalText !== changes.originalText) delete updated.ruby;
      return updated;
    });
    if (cues.reduce((sum, cue) => sum + cue.originalText.length, 0) > 220000)
      throw new Error("Subtitle size limit exceeded");
    const clock = (ms: number) => {
      const value = formatRangeTime(ms);
      return value.includes(".") ? value : value + ".000";
    };
    const raw = cues
      .map((cue, index) =>
        cue.startMs === null
          ? cue.originalText
          : `${index + 1}\n${clock(cue.startMs)} --> ${clock(cue.endMs!)}\n${serializeSubtitleMarkup(cue)}`,
      )
      .join("\n\n");
    ++this.captionVersion;
    this.update({
      raw,
      cues,
      timingOverrides,
      originalRaw: this.state.originalRaw,
      subtitleBusy: false,
    });
  }
  restoreOriginal() {
    this.update({ raw: this.state.originalRaw, pendingCaption: null });
  }
  resolveCaption(useNew: boolean) {
    const next = this.state.pendingCaption;
    if (!next) return;
    ++this.captionVersion;
    if (useNew) {
      this.revisions.push({
        key: captionCacheKey(this.state.sourceUrl, this.language),
        raw: this.state.raw,
        originalRaw: this.state.originalRaw,
        cues: this.state.cues,
        timingOverrides: this.state.timingOverrides,
      });
      this.revisions = this.revisions.slice(-10);
    }
    if (useNew)
      this.update({
        raw: next.raw,
        captionSource: next.source,
        sourceUrl: next.url,
        title: next.title || this.state.title,
        fileName: next.fileName,
        pendingCaption: null,
        subtitleTone: "success",
        subtitleStatus: "",
      });
    else this.update({ pendingCaption: null });
  }
  exportSaved() {
    return {
      version: 1 as const,
      entries: [...this.cache.entries()],
      revisions: this.revisions,
      latest: { sourceUrl: this.state.sourceUrl, title: this.state.title, language: this.language },
    };
  }
  hydrateSaved(saved: ReturnType<SubtitleDraft["exportSaved"]>) {
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) return;
    this.revisions = saved.revisions ?? [];
    for (const [key, value] of saved.entries)
      if (typeof key === "string" && value && typeof value.raw === "string" && value.source)
        this.cache.set(key, value);
    // A manually owned source survives an unrelated selected browser tab.
    const latest = saved.latest;
    const manual = this.cache.get(captionCacheKey(latest.sourceUrl, latest.language));
    const restoreManual = manual?.source.origin === "manual";
    const sourceUrl = restoreManual ? latest.sourceUrl : this.state.sourceUrl || latest.sourceUrl;

    const cached = this.cache.get(captionCacheKey(sourceUrl, this.language));
    if (cached && !this.state.raw)
      this.update({
        raw: cached.raw,
        originalRaw: cached.originalRaw ?? cached.raw,
        cues: cached.cues,
        timingOverrides: cached.timingOverrides,
        captionSource: cached.source,
        fileName: cached.fileName,
        sourceUrl,
        title: sourceUrl === latest.sourceUrl ? latest.title : this.state.title,
        subtitleTone: "success",
      });
  }
  setTitle(title: string) {
    ++this.metadataVersion;
    this.manualTitle = !!title.trim();
    this.update({ title, metadataBusy: false, metadataStatus: "" });
  }
  setSource(sourceUrl: string) {
    ++this.metadataVersion;
    ++this.captionVersion;
    ++this.selectionVersion;
    this.update({
      sourceUrl,
      metadataBusy: false,
      metadataStatus: "",
      subtitleBusy: false,
      subtitleStatus: "",
    });
    void this.loadTracks();
  }
  clearRecovery() {
    this.update({ videoRecoveryUrl: "" });
  }
  setPasteDraft(text: string) {
    this.update({
      pasteDrafts: {
        ...this.state.pasteDrafts,
        [captionCacheKey(this.state.sourceUrl, this.language)]: text,
      },
    });
  }
  hydrateLanguage(language: LearningLanguage) {
    if (language !== this.language) this.setLanguage(language);
  }
  async selectVideo(activeVideo: SelectedVideo | null) {
    const changed =
      videoSourceKey(activeVideo?.url ?? "") !== videoSourceKey(this.state.activeVideo?.url ?? "");
    const version = ++this.selectionVersion;
    this.update({ activeVideo });
    if (changed) {
      ++this.captionVersion;
      ++this.metadataVersion;
      this.update({ subtitleBusy: false, metadataBusy: false, subtitleStatus: "", error: "" });
    }
    if (!activeVideo || this.blocked) return;
    const adapter = this.adapters.getAdapter(activeVideo.url);
    if (!adapter.getVideoId(activeVideo.url)) return;
    const sourceAdapter = this.adapters.getAdapter(this.state.sourceUrl);
    const same =
      sourceAdapter.id === adapter.id &&
      sourceAdapter.getVideoId(this.state.sourceUrl) === adapter.getVideoId(activeVideo.url);
    const follow = shouldFollowSelectedVideo(
      this.state.sourceUrl,
      activeVideo.url,
      this.state.raw,
      this.state.captionSource?.origin,
    );
    if (!same && !follow) return;
    if (follow) {
      const cached = this.cache.get(captionCacheKey(activeVideo.url, this.language));
      this.manualTitle = false;
      this.update({
        raw: cached?.raw ?? "",
        originalRaw: cached?.originalRaw ?? cached?.raw ?? "",
        cues: cached?.cues,
        timingOverrides: cached?.timingOverrides,
        pendingCaption: null,
        fileName: cached?.fileName ?? "",
        captionSource: cached?.source ?? null,
        sourceUrl: activeVideo.url,
        title: "",
        subtitleStatus: "",
        metadataStatus: "",
        videoRecoveryUrl: "",
      });
      void this.loadTracks();
    }
    if (this.state.fileName && this.state.raw.trim()) return;
    try {
      const title = await this.adapters.titleForTab(
        { id: activeVideo.tabId, url: activeVideo.url, title: activeVideo.title },
        adapter,
      );
      if (version === this.selectionVersion && title && !this.manualTitle) this.update({ title });
    } catch {
      /* A missing reader/title keeps manual acquisition available. */
    }
  }
  private async loadTracks() {
    const version = ++this.trackVersion;
    const sourceUrl = this.state.sourceUrl;
    const key = videoSourceKey(sourceUrl);
    const adapter = this.adapters.getAdapter(sourceUrl);
    this.update({ trackInfo: null, trackBusy: false });
    if (!key || adapter.id === "import") return;
    if (!adapter.availableSubtitleTracks) {
      this.update({ trackInfo: { sourceKey: key, status: "unknown", tracks: [] } });
      return;
    }
    this.update({ trackBusy: true });
    try {
      const tab = await this.adapters.findTab(adapter, sourceUrl);
      await this.adapters.assertReady(tab, adapter);
      const tracks = await adapter.availableSubtitleTracks(tab.url ?? sourceUrl);
      if (version === this.trackVersion) this.update({ trackInfo: { sourceKey: key, ...tracks } });
    } catch {
      if (version === this.trackVersion)
        this.update({ trackInfo: { sourceKey: key, status: "unknown", tracks: [] } });
    } finally {
      if (version === this.trackVersion) this.update({ trackBusy: false });
    }
  }
  dispose() {
    ++this.captionVersion;
    ++this.metadataVersion;
    ++this.trackVersion;
    ++this.selectionVersion;
    this.listeners.clear();
  }
  async fetchMetadata(): Promise<void> {
    if (this.state.metadataBusy || this.blocked || this.state.subtitleBusy) return;
    const request = ++this.metadataVersion;
    const originalSource = this.state.sourceUrl.trim();
    this.set("metadataBusy", true);
    this.set("metadataStatus", "");
    this.set("error", "");
    try {
      if (originalSource && this.adapters.getAdapter(originalSource).id === "import") {
        throw new Error(this.metadataUi.invalidSource);
      }
      const found = await this.adapters.detectMetadata("");
      if (request !== this.metadataVersion) return;
      if (!found) throw new Error(this.metadataUi.unavailable);

      const follow = shouldFollowSelectedVideo(
        originalSource,
        found.url,
        this.state.raw,
        this.state.captionSource?.origin,
      );
      const safety = metadataSourceSafety(originalSource, follow ? "" : this.state.raw, found.url);
      if (safety === "mismatch") throw new Error(this.metadataUi.mismatch);
      if (safety === "confirm" && !this.adapters.confirm(this.metadataUi.confirmUnlinked)) return;
      if (request !== this.metadataVersion) return;

      // Preserve manual transcripts; video captions are cached separately per source.
      if (follow) {
        ++this.captionVersion;
        const cached = this.cache.get(captionCacheKey(found.url, this.language));
        this.set("raw", cached?.raw ?? "");
        this.set("fileName", cached?.fileName ?? "");
        this.set("captionSource", cached?.source ?? null);
        this.set("subtitleStatus", "");
        this.manualTitle = false;
        this.set("title", "");
      }
      // An explicitly confirmed metadata link can bind an imported transcript to this video.
      // Editing a video URL directly never silently rebinds an unrelated subtitle file.
      if (
        !originalSource &&
        this.state.captionSource?.origin === "manual" &&
        this.state.raw.trim()
      ) {
        const source: CaptionProvenance = {
          ...this.state.captionSource,
          sourceKey: videoSourceKey(found.url),
        };
        this.set("captionSource", source);
        this.cache.set(captionCacheKey(found.url, this.language), {
          raw: this.state.raw,
          fileName: this.state.fileName,
          source,
        });
      }
      this.set("sourceUrl", found.url);
      void this.loadTracks();
      if (found.title && !this.manualTitle) {
        this.set("title", current =>
          current.trim() && this.manualTitle ? current : (found.title ?? current),
        );
      }
      this.set("metadataStatus", found.title ? this.metadataUi.success : this.metadataUi.partial);
      this.set("videoRecoveryUrl", found.title ? "" : found.url);
    } catch (cause) {
      if (request === this.metadataVersion) {
        this.set(
          "error",
          cause instanceof Error && cause.message === "VIDEO_CHANGED"
            ? this.metadataUi.changed
            : cause instanceof Error
              ? cause.message
              : this.metadataUi.unavailable,
        );
      }
    } finally {
      if (request === this.metadataVersion) this.set("metadataBusy", false);
    }
  }

  setLanguage(next: string): void {
    const language = LEARNING_LANGUAGES.find(value => value === next);
    if (!language || language === this.language || this.blocked) return;
    const previousOrigin = this.state.captionSource?.origin;
    ++this.metadataVersion;
    ++this.selectionVersion;
    ++this.captionVersion; // Supersede a previous language/video request immediately.
    this.set("subtitleBusy", false);
    this.language = language;
    this.update({});
    this.set("error", "");
    this.set("videoRecoveryUrl", "");
    const cached = this.cache.get(captionCacheKey(this.state.sourceUrl, language));
    if (cached) {
      this.update({
        raw: cached.raw,
        originalRaw: cached.originalRaw ?? cached.raw,
        cues: cached.cues,
        timingOverrides: cached.timingOverrides,
        pendingCaption: null,
        fileName: cached.fileName,
        captionSource: cached.source,
        metadataBusy: false,
        subtitleTone: cached.source.origin === "manual" ? "neutral" : "success",
        subtitleStatus: subtitleMessage(
          cached.source.origin === "manual"
            ? this.subtitleUi.manualLanguageReady
            : this.subtitleUi.success,
          {
            language: learningLanguageName(language, this.locale),
            count: cached.raw.includes("-->")
              ? parseSubtitles(cached.raw).length
              : parsePlainText(cached.raw).length,
          },
        ),
      });
      // Switching back must work even if the video reader or network is unavailable.
      // An explicit refresh remains available when the user wants new captions.
      return;
    } else {
      // Keep the old draft visible; its source-language identity prevents generation.
      this.set("captionSource", null);
    }
    if (!cached && previousOrigin === "manual" && this.state.raw.trim()) {
      this.set("subtitleTone", "missing");
      this.set(
        "subtitleStatus",
        subtitleMessage(this.subtitleUi.manualLanguageChanged, {
          language: learningLanguageName(language, this.locale),
        }),
      );
      return;
    }
    if (
      !this.adapters.getAdapter(this.state.activeVideo?.url ?? this.state.sourceUrl).fetchSubtitles
    ) {
      this.set("subtitleTone", "missing");
      this.set(
        "subtitleStatus",
        subtitleMessage(this.subtitleUi.languageNotReady, {
          language: learningLanguageName(language, this.locale),
        }),
      );
      return;
    }
    void this.fetchSubtitles(language, true);
  }

  async fetchSubtitles(
    language: LearningLanguage = this.language,
    replacing = false,
  ): Promise<void> {
    if (
      this.readerBlocked ||
      (!replacing && (this.state.subtitleBusy || this.state.metadataBusy)) ||
      this.blocked
    )
      return;
    const request = ++this.captionVersion;
    let attemptedUrl = "";
    const previousCaption = this.state.captionSource;
    // Keep the current transcript usable if a refresh fails before replacement.
    this.set("subtitleBusy", true);
    this.set("subtitleTone", "loading");
    this.set(
      "subtitleStatus",
      subtitleMessage(this.subtitleUi.loadingLanguage, {
        language: learningLanguageName(language, this.locale),
      }),
    );
    this.set("videoRecoveryUrl", "");
    this.set("error", "");
    try {
      const selected = await this.adapters.selectedTab();
      if (request !== this.captionVersion) return;
      const selectedUrl = selected?.url ?? "";
      const currentAdapter = this.adapters.getAdapter(selectedUrl);
      const formUrl = this.state.sourceUrl.trim();
      const formAdapter = this.adapters.getAdapter(formUrl);
      if (
        currentAdapter.fetchSubtitles &&
        formAdapter.fetchSubtitles &&
        (currentAdapter.id !== formAdapter.id ||
          currentAdapter.getVideoId(selectedUrl) !== formAdapter.getVideoId(formUrl))
      ) {
        throw new Error(this.subtitleUi.sourceMismatch);
      }
      const url = currentAdapter.fetchSubtitles ? selectedUrl : formUrl;
      const adapter = this.adapters.getAdapter(url);
      if (!adapter.fetchSubtitles) throw new Error(this.subtitleUi.unavailable);
      const tab = await this.adapters.findTab(adapter, url);
      if (request !== this.captionVersion) return;
      const actualUrl = tab.url ?? url;
      attemptedUrl = actualUrl;
      await this.adapters.assertReady(tab, adapter);
      if (request !== this.captionVersion) return;
      const fetched = await adapter.fetchSubtitles(actualUrl, language);
      if (request !== this.captionVersion) return;
      if (!subtitleLanguageMatches(language, fetched.language)) {
        throw new Error(
          subtitleMessage(this.subtitleUi.languageMismatch, {
            requested: learningLanguageName(language, this.locale),
            actual: fetched.language,
          }),
        );
      }
      const parsed = parseSubtitles(fetched.text);
      if (
        !parsed.length ||
        parsed.length > 3_000 ||
        parsed.reduce((sum, cue) => sum + cue.originalText.length, 0) > 220_000
      ) {
        throw new Error(
          "The current video did not return a usable transcript within the lesson size limit.",
        );
      }
      const sourceKey = videoSourceKey(actualUrl);
      if (!sourceKey) throw new Error(this.subtitleUi.sourceMismatch);
      const fromDifferentVideo =
        formAdapter.id !== adapter.id ||
        formAdapter.getVideoId(formUrl) !== adapter.getVideoId(actualUrl);
      const videoTitle = await this.adapters.titleForTab(tab, adapter);
      if (request !== this.captionVersion) return;
      const source: CaptionProvenance = {
        sourceKey,
        language,
        origin: "video",
        actualLanguage: fetched.language,
      };
      if (
        this.state.edited &&
        previousCaption?.language === language &&
        previousCaption.sourceKey === source.sourceKey
      ) {
        this.update({
          pendingCaption: {
            raw: fetched.text,
            source,
            url: actualUrl,
            title: videoTitle ?? "",
            fileName: "",
          },
          captionSource: previousCaption,
          subtitleTone: "success",
          subtitleStatus: "",
        });
        return;
      }
      this.cache.set(captionCacheKey(actualUrl, language), {
        raw: fetched.text,
        fileName: "",
        source,
      });
      if (fromDifferentVideo) this.manualTitle = false;
      this.set("raw", fetched.text);
      this.set("captionSource", source);
      this.set("fileName", "");
      this.set("sourceUrl", actualUrl);
      void this.loadTracks();
      if (videoTitle && !this.manualTitle) this.set("title", videoTitle);
      else if (fromDifferentVideo) this.set("title", "");
      this.set("subtitleTone", "success");
      this.set(
        "subtitleStatus",
        subtitleMessage(this.subtitleUi.success, {
          count: parsed.length,
          language: fetched.language,
        }),
      );
    } catch (cause) {
      if (request !== this.captionVersion) return;
      const trackMissing = cause instanceof VideoCommandError && cause.code === "TRACK_UNAVAILABLE";
      const diagnostic = cause instanceof Error ? cause.message : "";
      const readerUnavailable = needsVideoReaderReload(diagnostic);
      if (attemptedUrl && readerUnavailable) this.set("videoRecoveryUrl", attemptedUrl);
      this.set("subtitleTone", trackMissing ? "missing" : "error");
      this.set("subtitleStatus", {
        code: readerUnavailable
          ? "READER_UNAVAILABLE"
          : cause instanceof VideoCommandError && cause.code
            ? cause.code
            : "CAPTION_FAILED",
        language,
      });
    } finally {
      if (request === this.captionVersion) this.set("subtitleBusy", false);
    }
  }

  async reloadReader(): Promise<void> {
    if (
      !this.state.videoRecoveryUrl ||
      this.state.reloadingVideoTab ||
      this.state.subtitleBusy ||
      this.state.metadataBusy
    )
      return;
    const version = this.captionVersion;
    const url = this.state.videoRecoveryUrl;
    this.set("reloadingVideoTab", true);
    this.set("error", "");
    try {
      await this.adapters.reloadTab(this.adapters.getAdapter(url), url);
      if (version !== this.captionVersion) return;
      this.set("videoRecoveryUrl", "");
      this.set("metadataStatus", "");
      this.set("subtitleTone", "neutral");
      this.set("subtitleStatus", this.subtitleUi.reloadedTab);
    } catch (cause) {
      if (version === this.captionVersion)
        this.set("error", cause instanceof Error ? cause.message : this.subtitleUi.reloadFailed);
    } finally {
      this.set("reloadingVideoTab", false);
    }
  }

  importText(text: string): void {
    if (!text.trim()) return;
    ++this.metadataVersion;
    ++this.selectionVersion;
    this.set("metadataBusy", false);
    this.set("metadataStatus", "");
    ++this.captionVersion;
    this.set("subtitleBusy", false);
    const source: CaptionProvenance = {
      origin: "manual",
      sourceKey: videoSourceKey(this.state.sourceUrl),
      language: this.language,
    };
    if (this.state.edited) {
      this.update({
        pendingCaption: {
          raw: text,
          source,
          url: this.state.sourceUrl,
          title: this.state.title,
          fileName: "",
        },
      });
      return;
    }
    this.set("raw", text);
    this.set("captionSource", source);
    this.set("fileName", "");
    this.cache.set(captionCacheKey(this.state.sourceUrl, this.language), {
      raw: text,
      fileName: "",
      source,
    });
    this.set("subtitleTone", "neutral");
    this.set(
      "subtitleStatus",
      subtitleMessage(this.subtitleUi.manualLanguageReady, {
        language: learningLanguageName(this.language, this.locale),
      }),
    );
    this.set("error", "");
  }

  async importFile(
    file: { name: string; size: number; text(): Promise<string> } | undefined,
  ): Promise<void> {
    if (!file) return;
    if (file.size > 2_000_000) {
      this.set("error", translate(this.locale, "errorFileSize"));
      return;
    }
    ++this.metadataVersion;
    ++this.selectionVersion;
    this.set("metadataBusy", false);
    this.set("metadataStatus", "");
    const request = ++this.captionVersion;
    this.set("subtitleBusy", false);
    let text: string;
    try {
      text = await this.adapters.readFile(file);
    } catch (error) {
      if (request === this.captionVersion) this.set("error", String(error));
      return;
    }
    if (request !== this.captionVersion) return;
    if (/\.(srt|vtt)$/i.test(file.name) && !parseSubtitles(text).length) {
      this.set("error", this.subtitleUi.unavailable);
      return;
    }
    const source: CaptionProvenance = {
      origin: "manual",
      sourceKey: videoSourceKey(this.state.sourceUrl),
      language: this.language,
    };
    if (this.state.edited) {
      this.update({
        pendingCaption: {
          raw: text,
          source,
          url: this.state.sourceUrl,
          title: this.state.title,
          fileName: file.name,
        },
      });
      return;
    }
    this.cache.set(captionCacheKey(this.state.sourceUrl, this.language), {
      raw: text,
      fileName: file.name,
      source,
    });
    this.set("raw", text);
    this.set("captionSource", source);
    this.set("fileName", file.name);
    this.set("subtitleTone", "neutral");
    this.set(
      "subtitleStatus",
      subtitleMessage(this.subtitleUi.manualLanguageReady, {
        language: learningLanguageName(this.language, this.locale),
      }),
    );
    if (!this.state.title) {
      this.manualTitle = true;
      this.set("title", file.name.replace(/\.(srt|vtt|txt)$/i, ""));
    }
    this.set("error", "");
  }
}
