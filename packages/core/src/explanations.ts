import { z } from "zod";

export const EXPLANATION_TYPES = [
  "vocabulary",
  "grammar",
  "chunks",
  "usage",
  "pronunciation",
  "culture",
] as const;
export const ExplanationTypeSchema = z.enum(EXPLANATION_TYPES);
export type ExplanationType = z.infer<typeof ExplanationTypeSchema>;

export function explanationPreferences(profile: {
  enabledExplanations?: ExplanationType[];
  emphasizedExplanations?: ExplanationType[];
}) {
  const enabled = EXPLANATION_TYPES.filter(
    type => profile.enabledExplanations?.includes(type) ?? true,
  );
  const emphasized = enabled.filter(type => profile.emphasizedExplanations?.includes(type));
  return { enabled, emphasized };
}

export const SourceSpanSchema = z.object({
  cueId: z.string().min(1).max(80),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
export const SentenceChunkSchema = z.object({
  id: z.string().min(1).max(80),
  spans: z.array(SourceSpanSchema).min(1).max(10),
  meaning: z.string().min(1).max(400),
  role: z.string().max(700).optional(),
  reusablePattern: z.string().max(200).optional(),
});
export type SentenceChunk = z.infer<typeof SentenceChunkSchema>;
