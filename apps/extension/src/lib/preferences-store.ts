import { contextualGenerationProfile } from "./contextual-profile";
import { PreferencesSchema, type Preferences } from "@contextual/core";
export { PreferencesSchema, type Preferences } from "@contextual/core";
export const PREFERENCES_KEY = "preferencesV2";
export function defaultPreferences(
  locale: Exclude<Preferences["uiLocalePreference"], "auto"> = "en",
): Preferences {
  return {
    schemaVersion: 2,
    agent: null,
    providerSettings: {},
    agentModelPreferences: {},
    profile: contextualGenerationProfile({
      targetLanguage: "en",
      instructionLanguage: locale,
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 1,
    }),
    explanationLanguageMode: "auto",
    destination: { kind: "local" },
    backup: { enabled: false },
    attentionNotificationsEnabled: true,
    analysisNotificationsEnabled: true,
    uiLocalePreference: "auto",
    themePreference: "system",
    motionPreference: "full",
    repeat: "3",
    delay: 1,
    sceneRepeat: "3",
    sceneDelay: 1,
    playbackRate: 1,
  };
}
export type PreferencesStorage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};
/** Hydration and writes are ordered. Old storage keys are neither read nor removed. */
export class PreferencesStore {
  private value: Preferences;
  private committed: Preferences;
  private revision = 0;
  private loaded = false;
  private loading?: Promise<Preferences>;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<(value: Preferences) => void>();
  constructor(
    private storage: PreferencesStorage,
    locale?: Exclude<Preferences["uiLocalePreference"], "auto">,
  ) {
    this.value = defaultPreferences(locale);
    this.committed = this.value;
  }
  load(): Promise<Preferences> {
    return (this.loading ??= this.storage
      .get([PREFERENCES_KEY])
      .then(saved => {
        const parsed = PreferencesSchema.safeParse(saved[PREFERENCES_KEY]);
        if (parsed.success)
          this.value = {
            ...parsed.data,
            profile: contextualGenerationProfile(parsed.data.profile),
          };
        this.committed = this.value;
        this.loaded = true;
        this.emit();
        return this.value;
      })
      .catch(() => {
        this.loaded = true;
        this.emit();
        return this.value;
      }));
  }
  subscribe(listener: (value: Preferences) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  save(value: Preferences): Promise<void> {
    if (!this.loaded) return Promise.reject(new Error("Preferences must be loaded before saving"));
    const snapshot = PreferencesSchema.parse({
      ...this.value,
      ...value,
      profile: contextualGenerationProfile(value.profile),
      pronunciationModes: value.pronunciationModes ?? this.value.pronunciationModes,
    });
    const revision = ++this.revision;
    this.value = snapshot;
    this.emit();
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        try {
          await this.storage.set({ [PREFERENCES_KEY]: snapshot });
          this.committed = snapshot;
        } catch (error) {
          if (revision === this.revision) {
            this.value = this.committed;
            this.emit();
          }
          throw error;
        }
      });
    this.writes = write;
    return write;
  }
  current(): Preferences {
    return this.value;
  }
  async savePronunciation(
    language: string,
    mode: "off" | "native" | "roman" | "ipa",
  ): Promise<void> {
    await this.load();
    return this.save({
      ...this.value,
      pronunciationModes: { ...this.value.pronunciationModes, [language]: mode },
    });
  }
  async saveSpeech(speech: NonNullable<Preferences["speech"]>): Promise<void> {
    await this.load();
    return this.save({ ...this.value, speech });
  }
  private emit() {
    for (const listener of this.listeners) listener(this.value);
  }
}

const stores = new WeakMap<PreferencesStorage, PreferencesStore>();
export function getPreferencesStore(
  storage: PreferencesStorage,
  locale?: Exclude<Preferences["uiLocalePreference"], "auto">,
) {
  let store = stores.get(storage);
  if (!store) {
    store = new PreferencesStore(storage, locale);
    stores.set(storage, store);
  }
  return store;
}
