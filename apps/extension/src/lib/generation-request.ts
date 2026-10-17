import {
  GenerationRequestSchema,
  CustomGenerationRequestSchema,
  AnalysisRangeSchema,
  selectAnalysisCues,
  type AnalysisRange,
  type AgentSettings,
  type BackupSettings,
  type Destination,
  type GenerationRequest,
  type LearningProfile,
  type SubtitleCue,
  type VideoSource,
} from "@contextual/core";
import { contextualGenerationProfile } from "./contextual-profile";

/** One immutable V7 request is reused for duplicate preflight and generation. */
export function buildGenerationRequest(
  input: {
    source: VideoSource;
    profile: LearningProfile;
    agent: AgentSettings;
    destination: Destination;
    backup: BackupSettings;
    cues: SubtitleCue[];
    analysisRange?: AnalysisRange;
  },
  id: string = crypto.randomUUID(),
): GenerationRequest {
  return GenerationRequestSchema.parse({
    id,
    outputSchemaVersion: 7,
    source: input.source,
    profile: contextualGenerationProfile(input.profile),
    agent: input.agent,
    destination: input.destination,
    backup: input.backup,
    cues: selectAnalysisCues(input.cues, input.analysisRange),
    ...(input.analysisRange
      ? { analysisRange: AnalysisRangeSchema.parse(input.analysisRange) }
      : {}),
  });
}

/** Preview and submission use the same source range, prompt and context switches. */
export function buildCreationRequest(
  input: Parameters<typeof buildGenerationRequest>[0],
  custom?: { prompt: string; context: { subtitles: boolean; title: boolean } },
) {
  const request = buildGenerationRequest(input);
  return custom
    ? CustomGenerationRequestSchema.parse({
        id: request.id,
        kind: "custom",
        source: request.source,
        agent: request.agent,
        cues: request.cues,
        analysisRange: request.analysisRange,
        destination: request.destination,
        backup: request.backup,
        ...custom,
      })
    : request;
}
