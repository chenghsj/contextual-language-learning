import { z } from "zod";
import {
  AgentSettingsSchema,
  BackupSettingsSchema,
  LearningProfileSchema,
  ThinkingLevelSchema,
} from "./schema";
import { isPiProviderId } from "./pi-providers";
const locales = z.enum(["auto", "en", "zh-TW", "zh-CN", "ja", "ko"]);
const repeat = z.enum(["2", "3", "5", "infinite"]);
const providers = z
  .record(z.object({ modelId: z.string().max(120), thinkingLevel: ThinkingLevelSchema.optional() }))
  .refine(value => Object.keys(value).every(isPiProviderId));
export const PreferencesSchema = z
  .object({
    schemaVersion: z.literal(2),
    agent: AgentSettingsSchema.nullable(),
    providerSettings: providers,
    agentModelPreferences: z
      .record(z.string().max(120))
      .refine(value => Object.keys(value).every(isPiProviderId)),
    pronunciationModes: z.record(z.enum(["off", "native", "roman", "ipa"])).optional(),
    profile: LearningProfileSchema,
    explanationLanguageMode: z.enum(["auto", "custom"]),
    destination: z.object({ kind: z.literal("local"), directory: z.string().max(2048).optional() }),
    backup: BackupSettingsSchema,
    attentionNotificationsEnabled: z.boolean(),
    analysisNotificationsEnabled: z.boolean(),
    uiLocalePreference: locales,
    themePreference: z.enum(["system", "light", "dark"]),
    repeat,
    delay: z.number().int().min(0).max(3),
    sceneRepeat: repeat,
    sceneDelay: z.number().int().min(0).max(3),
    playbackRate: z
      .number()
      .refine(value => [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].includes(value)),
  })
  .strict();
export type Preferences = z.infer<typeof PreferencesSchema>;
