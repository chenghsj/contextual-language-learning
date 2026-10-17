import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultLevelForTargetLanguage,
  isPiProviderId,
  selectAnalysisCues,
  subtitleDuration,
  timedCues,
  type AgentSettings,
  type BackupSettings,
  type Destination,
  type JobSummary,
  type LearningProfile,
  type RangeSelection,
  type SubtitleCue,
} from "@contextual/core";
import { draftRevision, type CreateDraft } from "../lib/create-draft";
import { draftStorage, type DraftStorage } from "../lib/draft-db";
import { buildCreationRequest } from "../lib/generation-request";
import { contextualGenerationProfile } from "../lib/contextual-profile";
import { videoSourceKey } from "../video/caption-provenance";
import { getVideoAdapter } from "../video";
import { builtinPrompt } from "../i18n/builtin-prompts";
import { analysisRangeCopy } from "../i18n/analysis-range";
import type { UiLocale } from "../i18n/messages";
import type { GenerationSession } from "../native/generation-session";
import { useCreateDraft } from "./use-create-draft";

type LocalDestination = Extract<Destination, { kind: "local" }>;
type CreateState = {
  createStep: number;
  completedStep: number;
  subtitlePreview: boolean;
  contentMode: "standard" | "custom";
  customPrompt: string;
  customContext: { title: boolean; subtitles: boolean };
  analysisSelection: RangeSelection;
  requestAgent: AgentSettings | null;
  requestDestination: LocalDestination | null;
  requestBackup: BackupSettings | null;
};

export type CreateFlowOptions = {
  source: {
    url: string;
    title: string;
    raw: string;
    originalRaw: string;
    activeVideoUrl?: string;
    cues: SubtitleCue[];
    captionsReady: boolean;
    subtitleBusy: boolean;
    loaded: boolean;
    videoDurationMs?: number;
  };
  profile: LearningProfile;
  defaults: { agent: AgentSettings; destination: LocalDestination; backup: BackupSettings };
  hydrated: boolean;
  locale: UiLocale;
  initialLocale: UiLocale;
  session: Pick<GenerationSession, "start" | "dismissDuplicate" | "invalidatePreflight">;
  onProfile: (profile: LearningProfile) => void;
  onTitle: (title: string) => void;
  onError: (message: string) => void;
};

type SubmissionAvailability = {
  checking: boolean;
  submitting: boolean;
  hostReady: boolean;
  installed: Record<string, boolean> | null;
  driveAccessVerified: boolean;
};
type SubmissionResult =
  | { status: "started" }
  | { status: "busy" }
  | {
      status: "blocked";
      reason: "range" | "host" | "provider" | "subtitles" | "backup" | "draft";
    }
  | { status: "error"; message: string };

/** Owns Create state and persistence; the caller keeps the session's lifetime. */
export function useCreateFlow(options: CreateFlowOptions, storage: DraftStorage = draftStorage) {
  const { source, profile, defaults, session, locale } = options;
  const [state, setState] = useState<CreateState>(() => ({
    createStep: 0,
    completedStep: 0,
    subtitlePreview: false,
    contentMode: "standard",
    customPrompt: builtinPrompt("summary", options.initialLocale),
    customContext: { title: true, subtitles: true },
    analysisSelection: { mode: "full", startMs: 0, endMs: 0 },
    requestAgent: null,
    requestDestination: null,
    requestBackup: null,
  }));
  const edit = useCallback(
    (patch: Partial<CreateState> | ((current: CreateState) => Partial<CreateState>)) =>
      setState(current => ({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      })),
    [],
  );
  const latest = useRef({ options, storage });
  latest.current = { options, storage };
  const accepted = useRef<{ requestId: string; draft: CreateDraft } | null>(null);
  const [lastSettings, setLastSettings] = useState<CreateDraft | null>(null);
  const restoredRange = useRef<{ url: string; language: string; range: RangeSelection } | null>(
    null,
  );
  const analysisDurationMs = source.videoDurationMs ?? subtitleDuration(source.cues);
  useEffect(() => {
    const restored = restoredRange.current;
    edit({
      subtitlePreview: false,
      analysisSelection:
        restored && restored.url === source.url && restored.language === profile.targetLanguage
          ? restored.range
          : { mode: "full", startMs: 0, endMs: analysisDurationMs },
    });
  }, [source.url, profile.targetLanguage, source.activeVideoUrl]);
  useEffect(() => {
    setState(current =>
      current.analysisSelection.mode === "full"
        ? {
            ...current,
            analysisSelection: { ...current.analysisSelection, endMs: analysisDurationMs },
          }
        : current,
    );
  }, [analysisDurationMs]);
  const analysisValid =
    state.analysisSelection.mode === "full" ||
    (Number.isFinite(state.analysisSelection.startMs) &&
      state.analysisSelection.startMs >= 0 &&
      state.analysisSelection.startMs < state.analysisSelection.endMs &&
      state.analysisSelection.endMs <= analysisDurationMs &&
      timedCues(source.cues) &&
      selectAnalysisCues(source.cues, state.analysisSelection).length > 0);
  const allowedStep =
    !source.cues.length || !source.title.trim() || !source.captionsReady || !analysisValid
      ? 0
      : state.contentMode === "custom" && !state.customPrompt.trim()
        ? 1
        : 2;
  const generationAgent = state.requestAgent ?? defaults.agent;
  const destination = state.requestDestination ?? defaults.destination;
  const backup = state.requestBackup ?? defaults.backup;
  const snapshot: CreateDraft = {
    version: 1,
    sourceKey:
      videoSourceKey(source.url) ??
      (source.originalRaw ? "manual:" + draftRevision(source.originalRaw) : "manual:empty"),
    title: source.title,
    language: profile.targetLanguage,
    subtitleRevision: draftRevision(source.raw),
    profile,
    mode: state.contentMode,
    prompt: state.customPrompt,
    context: state.customContext,
    range: state.analysisSelection,
    step: state.createStep,
    completedStep: state.completedStep,
    agent: state.requestAgent,
    destination: state.requestDestination,
    backup: state.requestBackup,
  };
  const draft = useCreateDraft(
    snapshot,
    options.hydrated && source.loaded,
    saved => {
      if (!saved) {
        edit({
          createStep: 0,
          completedStep: 0,
          subtitlePreview: false,
          analysisSelection: { mode: "full", startMs: 0, endMs: analysisDurationMs },
          requestAgent: null,
          requestDestination: null,
          requestBackup: null,
        });
        return;
      }
      restoredRange.current = {
        url: source.url,
        language: saved.profile.targetLanguage,
        range: saved.range,
      };
      options.onTitle(saved.title);
      options.onProfile(contextualGenerationProfile(saved.profile));
      const sameSubtitles = saved.subtitleRevision === draftRevision(source.raw);
      edit({
        subtitlePreview: false,
        contentMode: saved.mode,
        customPrompt: saved.prompt,
        customContext: saved.context,
        analysisSelection: saved.range,
        requestAgent: saved.agent,
        requestDestination: saved.destination,
        requestBackup: saved.backup,
        createStep: sameSubtitles ? saved.step : 0,
        completedStep: sameSubtitles ? saved.completedStep : 0,
      });
    },
    options.onError,
    storage,
  );
  useEffect(() => {
    let live = true;
    void storage
      .read<CreateDraft>("last-create-settings")
      .then(saved => {
        if (live && saved) setLastSettings(saved);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [storage]);

  const prepareRequest = useCallback(
    () =>
      buildCreationRequest(
        {
          source: {
            platform: getVideoAdapter(source.url).id,
            title: source.title.trim(),
            ...(source.url.trim() ? { url: source.url.trim() } : {}),
          },
          profile,
          agent: generationAgent,
          destination,
          backup,
          cues: source.cues,
          ...(timedCues(source.cues) && analysisDurationMs > 0
            ? {
                analysisRange: {
                  ...state.analysisSelection,
                  durationMs: analysisDurationMs,
                  durationSource:
                    source.videoDurationMs === undefined
                      ? ("subtitles" as const)
                      : ("video" as const),
                },
              }
            : {}),
        },
        state.contentMode === "custom"
          ? { prompt: state.customPrompt, context: state.customContext }
          : undefined,
      ),
    [
      source.url,
      source.title,
      source.cues,
      source.videoDurationMs,
      profile,
      generationAgent,
      destination,
      backup,
      analysisDurationMs,
      state.analysisSelection,
      state.contentMode,
      state.customPrompt,
      state.customContext,
    ],
  );
  const estimatePayload = useMemo(() => {
    if (state.createStep !== 2 || !source.captionsReady || !analysisValid) return null;
    try {
      return prepareRequest();
    } catch {
      return null;
    }
  }, [state.createStep, source.captionsReady, analysisValid, prepareRequest]);
  useEffect(() => {
    session.invalidatePreflight();
  }, [
    session,
    source.raw,
    source.title,
    source.url,
    profile,
    generationAgent,
    defaults.destination,
    defaults.backup,
    state.requestDestination,
    state.requestBackup,
    state.analysisSelection,
    state.contentMode,
    state.customPrompt,
    state.customContext,
  ]);

  function quickCreate() {
    if (!draft.ready || !lastSettings || !source.captionsReady || !analysisValid) return;
    if (!draft.hasSaved) {
      const range = lastSettings.range;
      if (
        (range.mode === "first" || range.mode === "second") &&
        source.videoDurationMs === undefined
      ) {
        options.onError(analysisRangeCopy(locale).estimated);
        return;
      }
      if (
        range.mode === "custom" &&
        (range.endMs > analysisDurationMs || !timedCues(source.cues))
      ) {
        options.onError(analysisRangeCopy(locale).invalid);
        return;
      }
      const half = Math.floor(analysisDurationMs / 2);
      const analysisSelection =
        range.mode === "full"
          ? { mode: "full" as const, startMs: 0, endMs: analysisDurationMs }
          : range.mode === "first" || range.mode === "second"
            ? {
                mode: range.mode,
                startMs: range.mode === "second" ? half : 0,
                endMs: range.mode === "first" ? half : analysisDurationMs,
              }
            : range;
      options.onProfile({
        ...lastSettings.profile,
        targetLanguage: profile.targetLanguage,
        level:
          lastSettings.profile.targetLanguage === profile.targetLanguage
            ? lastSettings.profile.level
            : defaultLevelForTargetLanguage(profile.targetLanguage),
      });
      edit({
        contentMode: lastSettings.mode,
        customPrompt: lastSettings.prompt,
        customContext: lastSettings.context,
        requestAgent: lastSettings.agent,
        requestDestination: lastSettings.destination,
        requestBackup: lastSettings.backup,
        analysisSelection,
      });
    }
    edit({ completedStep: 2, createStep: 2 });
  }

  const admitted = useCallback((job: JobSummary) => {
    if (accepted.current?.requestId !== job.id) return;
    const saved = accepted.current.draft;
    accepted.current = null;
    setLastSettings(saved);
    void latest.current.storage
      .write("last-create-settings", saved)
      .catch(error => latest.current.options.onError(String(error)));
  }, []);
  function dismissDuplicate() {
    accepted.current = null;
    session.dismissDuplicate();
  }
  function submit(availability: SubmissionAvailability): SubmissionResult {
    if (availability.checking || availability.submitting) return { status: "busy" };
    if (!draft.ready) return { status: "blocked", reason: "draft" };
    if (!analysisValid) return { status: "blocked", reason: "range" };
    if (!availability.hostReady) return { status: "blocked", reason: "host" };
    if (
      !isPiProviderId(generationAgent.provider) ||
      availability.installed?.[generationAgent.provider] !== true
    )
      return { status: "blocked", reason: "provider" };
    if (source.subtitleBusy || !source.captionsReady)
      return { status: "blocked", reason: "subtitles" };
    if (backup.enabled && !availability.driveAccessVerified)
      return { status: "blocked", reason: "backup" };
    dismissDuplicate();
    try {
      const payload = prepareRequest();
      accepted.current = {
        requestId: payload.id,
        draft: structuredClone({ ...snapshot, agent: generationAgent, destination, backup }),
      };
      session.start(payload);
      return { status: "started" };
    } catch (error) {
      accepted.current = null;
      return { status: "error", message: error instanceof Error ? error.message : "" };
    }
  }

  function canSubmit(availability: SubmissionAvailability & { modelReady: boolean }): boolean {
    return (
      draft.ready &&
      analysisValid &&
      source.captionsReady &&
      !source.subtitleBusy &&
      source.cues.length > 0 &&
      !!source.title.trim() &&
      (state.contentMode !== "custom" || !!state.customPrompt.trim()) &&
      availability.hostReady &&
      availability.modelReady &&
      !availability.checking &&
      !availability.submitting &&
      isPiProviderId(generationAgent.provider) &&
      availability.installed?.[generationAgent.provider] === true
    );
  }

  return {
    state,
    edit,
    draft,
    lastSettings,
    allowedStep,
    analysisValid,
    analysisDurationMs,
    generationAgent,
    destination,
    backup,
    estimatePayload,
    quickCreate,
    admitted,
    submit,
    canSubmit,
    dismissDuplicate,
    canQuickCreate: draft.ready && source.captionsReady && analysisValid,
    goTo: (step: number) => edit({ createStep: Math.max(0, Math.min(step, 2)) }),
    next: () => {
      if (draft.ready && state.createStep < allowedStep)
        edit({
          completedStep: Math.max(state.completedStep, state.createStep + 1),
          createStep: state.createStep + 1,
        });
    },
  };
}

export type CreateFlow = ReturnType<typeof useCreateFlow>;
