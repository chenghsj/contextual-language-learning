import { z } from "zod";

export const SystemVoiceSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  language: z.string().min(2).max(40),
  quality: z.enum(["default", "enhanced", "premium"]).optional(),
  neural: z.boolean().optional(),
  engine: z.enum(["siri", "av", "narrator"]).optional(),
  technology: z.string().min(1).max(40).optional(),
  installed: z.boolean().optional(),
  downloadSize: z.number().int().nonnegative().optional(),
  removable: z.boolean().optional(),
  resourceAvailable: z.boolean().optional(),
  resourceId: z.string().min(1).max(256).optional(),
  aliases: z.array(z.string().min(1).max(256)).max(1000).optional(),
});
export type SystemVoice = z.infer<typeof SystemVoiceSchema>;
export const SpeechVoiceCatalogSchema = z.object({
  available: z.boolean(),
  voices: z.array(SystemVoiceSchema).max(1000),
});
export type SpeechVoiceCatalog = z.infer<typeof SpeechVoiceCatalogSchema>;
export const SpeechVoiceInstallationSchema = z.object({
  voiceId: z.string().min(1).max(256),
  status: z.enum(["requested", "installed", "not-installed"]),
});
export type SpeechVoiceInstallation = z.infer<typeof SpeechVoiceInstallationSchema>;
export const SpeechSettingsSchema = z.object({
  rate: z.number().min(0.5).max(2).default(1),
  voices: z.record(z.string().min(1).max(256)).default({}),
});
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>;
export const SpeechInputSchema = z.object({
  text: z.string().trim().min(1).max(6000),
  language: z
    .string()
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
    .max(40),
  voiceId: z.string().min(1).max(256),
  rate: z.number().min(0.5).max(2),
});
export type SpeechInput = z.infer<typeof SpeechInputSchema>;

/** Merge only identities that the native backend proves share a physical Siri resource. */
export function normalizeSystemVoices(voices: SystemVoice[]): SystemVoice[] {
  const groups = new Map<string, SystemVoice[]>();
  for (const voice of voices) {
    const key =
      voice.engine === "siri" && voice.resourceId
        ? JSON.stringify([voice.engine, voice.language.toLowerCase(), voice.resourceId])
        : JSON.stringify([voice.engine, voice.id]);
    const group = groups.get(key) ?? [];
    group.push(voice);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    if (group.length === 1) return group[0];
    const physical = (voice: SystemVoice) =>
      Number(
        Boolean(
          voice.technology && voice.resourceId?.endsWith("." + voice.technology + ".premium"),
        ),
      );
    const representative = [...group].sort(
      (a, b) =>
        physical(b) - physical(a) ||
        speechVoicePriority(b) - speechVoicePriority(a) ||
        a.id.localeCompare(b.id),
    )[0];
    const aliases = [...new Set(group.flatMap(voice => [voice.id, ...(voice.aliases ?? [])]))]
      .filter(id => id !== representative.id)
      .sort();
    return {
      ...representative,
      aliases,
      installed: group.some(voice => voice.installed === true) ? true : representative.installed,
      resourceAvailable: group.some(voice => voice.resourceAvailable === true)
        ? true
        : representative.resourceAvailable,
      removable: group.some(voice => voice.removable === false) ? false : representative.removable,
    };
  });
}

/** Keep saved and in-flight legacy IDs working after their resource gets a canonical row. */
export function findSystemVoice(voices: SystemVoice[], id?: string): SystemVoice | undefined {
  if (!id) return undefined;
  return voices.find(voice => voice.id === id) ?? voices.find(voice => voice.aliases?.includes(id));
}

/** A missing saved voice never falls back to another language. */
export function speechVoicesForLanguage(voices: SystemVoice[], language: string): SystemVoice[] {
  const requested = language.toLowerCase();
  const base = requested.split("-")[0];
  return normalizeSystemVoices(voices)
    .filter(voice =>
      requested.includes("-")
        ? voice.language.toLowerCase() === requested
        : voice.language.toLowerCase().split("-")[0] === base,
    )
    .sort((a, b) => speechVoicePriority(b) - speechVoicePriority(a));
}

/** Playback discovery must never offer an existing physical resource for download. */
export function downloadableSpeechVoicesForLanguage(
  voices: SystemVoice[],
  language: string,
): SystemVoice[] {
  return speechVoicesForLanguage(voices, language).filter(
    voice => voice.installed === false && voice.resourceAvailable !== true,
  );
}

function speechVoicePriority(voice: SystemVoice): number {
  const quality = voice.quality === "premium" ? 30 : voice.quality === "enhanced" ? 20 : 0;
  // Apple reports quality separately from the neural family in its voice identifier.
  const family = voice.id.startsWith("com.apple.voice.") ? 5 : 0;
  return (voice.neural ? 100 : 0) + (voice.engine === "siri" ? 50 : 0) + quality + family;
}

/** This Apple identifier carries the resource identity; display names never establish aliases. */
function publicSiriResourceId(voice: SystemVoice): string | undefined {
  if (voice.engine === "siri") return undefined;
  const match =
    /^com\.apple\.ttsbundle\.gryphon-neural_([^_]+)_([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})+)_premium$/.exec(
      voice.id,
    );
  if (!match || match[2].toLowerCase() !== voice.language.toLowerCase()) return undefined;
  return `com.apple.siri.tts.voice.${match[2].replaceAll("-", "_")}.${match[1].toLowerCase()}.neural.premium`;
}

/** Siri is preferred per spoken language; eligible public voices are a fallback. */
export function readAloudVoicesForLanguage(voices: SystemVoice[], language: string): SystemVoice[] {
  const eligible = speechVoicesForLanguage(voices, language).filter(
    voice =>
      voice.installed !== false &&
      (voice.neural === true || voice.quality === "enhanced" || voice.quality === "premium"),
  );
  const siri = eligible.filter(voice => voice.engine === "siri");
  if (!siri.length) return eligible;
  return siri.map(voice => {
    const publicAliases = voice.resourceId
      ? eligible
          .filter(other => publicSiriResourceId(other) === voice.resourceId)
          .map(other => other.id)
      : [];
    if (!publicAliases.length) return voice;
    return { ...voice, aliases: [...new Set([...(voice.aliases ?? []), ...publicAliases])].sort() };
  });
}

/** Paragraph boundaries mark original cues for native 300ms breaks; cue-internal wraps stay intact. */
export function subtitleSpeechText(cues: readonly string[]): string {
  return cues.filter(text => text.trim()).join("\u2029");
}
