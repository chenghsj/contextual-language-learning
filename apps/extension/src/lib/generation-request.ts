import {
  GenerationRequestSchema, type AgentSettings, type BackupSettings, type Destination,
  type GenerationRequest, type LearningProfile, type SubtitleCue, type VideoSource,
} from "@immersive/core";
import { contextualGenerationProfile } from "./contextual-profile";

/** One immutable V4 request is reused for duplicate preflight and generation. */
export function buildGenerationRequest(input: {
  source: VideoSource; profile: LearningProfile; agent: AgentSettings;
  destination: Destination; backup: BackupSettings; cues: SubtitleCue[];
}, id: string = crypto.randomUUID()): GenerationRequest {
  return GenerationRequestSchema.parse({
    id, source: input.source, profile: contextualGenerationProfile(input.profile),
    agent: input.agent, destination: input.destination, backup: input.backup, cues: input.cues,
  });
}
