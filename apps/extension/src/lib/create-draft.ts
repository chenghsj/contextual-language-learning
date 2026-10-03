import {
  AgentSettingsSchema,
  LearningProfileSchema,
  DestinationSchema,
  BackupSettingsSchema,
  type AgentSettings,
  type LearningProfile,
  type Destination,
  type BackupSettings,
  type RangeSelection,
} from "@immersive/core";
export type CreateDraft = {
  version: 1;
  sourceKey: string;
  title: string;
  language: string;
  subtitleRevision: string;
  profile: LearningProfile;
  mode: "standard" | "custom";
  prompt: string;
  context: { title: boolean; subtitles: boolean };
  range: RangeSelection;
  step: number;
  completedStep: number;
  agent: AgentSettings | null;
  destination: Extract<Destination, { kind: "local" }> | null;
  backup: BackupSettings | null;
};
/** Non-cryptographic dirty/version detection only; Host duplicate fingerprints use SHA-256. */
export function draftRevision(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16) + ":" + value.length;
}
export function parseCreateDraft(value: unknown, sourceKey: string): CreateDraft | undefined {
  if (!value || typeof value !== "object") return;
  const d = value as CreateDraft;
  if (
    d.version !== 1 ||
    d.sourceKey !== sourceKey ||
    typeof d.title !== "string" ||
    typeof d.prompt !== "string" ||
    d.prompt.length > 20000 ||
    !["standard", "custom"].includes(d.mode) ||
    !LearningProfileSchema.safeParse(d.profile).success ||
    !d.context ||
    typeof d.context.title !== "boolean" ||
    typeof d.context.subtitles !== "boolean" ||
    !d.range ||
    !["full", "first", "second", "custom"].includes(d.range.mode) ||
    !Number.isInteger(d.step) ||
    d.step < 0 ||
    d.step > 2 ||
    !Number.isInteger(d.completedStep) ||
    d.completedStep < 0 ||
    d.completedStep > 2 ||
    !(d.agent === null || AgentSettingsSchema.safeParse(d.agent).success) ||
    !(
      d.destination === null ||
      (DestinationSchema.safeParse(d.destination).success && d.destination.kind === "local")
    ) ||
    !(d.backup === null || BackupSettingsSchema.safeParse(d.backup).success)
  )
    return;
  if (
    (d.range.startMs !== null && typeof d.range.startMs !== "number") ||
    (d.range.endMs !== null && typeof d.range.endMs !== "number")
  )
    return;
  return {
    ...d,
    range: { ...d.range, startMs: d.range.startMs ?? NaN, endMs: d.range.endMs ?? NaN },
  };
}
