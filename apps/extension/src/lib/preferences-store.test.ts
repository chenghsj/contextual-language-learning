import assert from "node:assert/strict";
import test from "node:test";
import { EXPLANATION_TYPES, UNRESTRICTED_LEVEL } from "@contextual/core";
import { PreferencesStore, defaultPreferences } from "./preferences-store";

test("unrestricted proficiency survives preference normalization, saving and reload", async () => {
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      saved = value;
    },
  };
  const store = new PreferencesStore(storage);
  const defaults = await store.load();
  await store.save({
    ...defaults,
    profile: { ...defaults.profile, targetLanguage: "ja", level: UNRESTRICTED_LEVEL },
  });
  const reloaded = await new PreferencesStore(storage).load();
  assert.equal(reloaded.profile.targetLanguage, "ja");
  assert.equal(reloaded.profile.level, UNRESTRICTED_LEVEL);
  assert.equal(reloaded.profile.sceneCount, defaults.profile.sceneCount);
});

test("motion defaults migrate old and malformed fields without discarding other saved settings", async () => {
  for (const motionPreference of [undefined, "system", "invalid", 7, null]) {
    const saved = { ...defaultPreferences(), themePreference: "dark", motionPreference };
    const store = new PreferencesStore({
      get: async () => ({ preferencesV2: saved }),
      set: async () => {},
    });
    const loaded = await store.load();
    assert.equal(loaded.motionPreference, "full");
    assert.equal(loaded.themePreference, "dark");
  }
});

test("motion overrides persist across reload and failed saves restore the committed choice", async () => {
  let saved: Record<string, unknown> = {},
    fail = false;
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      if (fail) throw new Error("write failed");
      saved = value;
    },
  };
  const store = new PreferencesStore(storage);
  const defaults = await store.load();
  await store.save({ ...defaults, motionPreference: "reduced" });
  assert.equal((await new PreferencesStore(storage).load()).motionPreference, "reduced");
  fail = true;
  await assert.rejects(
    store.save({ ...store.current(), motionPreference: "full" }),
    /write failed/,
  );
  assert.equal(store.current().motionPreference, "reduced");
});

test("speech settings survive unrelated app saves and a rejected change rolls back", async () => {
  let fail = false;
  const store = new PreferencesStore({
    get: async () => ({}),
    set: async () => {
      if (fail) throw new Error("write failed");
    },
  });
  const original = await store.load();
  assert.equal(original.speech, undefined);
  await store.saveSpeech({ rate: 0.75, voices: { ja: "Kyoko" } });
  await store.save({ ...original, themePreference: "dark" });
  assert.deepEqual(store.current().speech, { rate: 0.75, voices: { ja: "Kyoko" } });
  fail = true;
  await assert.rejects(store.saveSpeech({ rate: 2, voices: {} }), /write failed/);
  assert.deepEqual(store.current().speech, { rate: 0.75, voices: { ja: "Kyoko" } });
});

test("legacy explanation preferences normalize without losing language and level", async () => {
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      saved = value;
    },
  };
  const store = new PreferencesStore(storage);
  const defaults = await store.load();
  assert.deepEqual(
    defaults.profile.enabledExplanations,
    EXPLANATION_TYPES,
    "standard defaults enable automatic explanations",
  );
  await store.save({
    ...defaults,
    profile: {
      ...defaults.profile,
      targetLanguage: "ja",
      level: "N4",
      enabledExplanations: ["grammar", "chunks"],
      emphasizedExplanations: ["grammar", "chunks"],
    },
  });
  const reloaded = await new PreferencesStore(storage).load();
  assert.equal(reloaded.profile.level, "N4");
  assert.deepEqual(reloaded.profile.enabledExplanations, EXPLANATION_TYPES);
  assert.deepEqual(reloaded.profile.emphasizedExplanations, []);
  assert.equal(reloaded.profile.contextualExampleCount, 1);
});

test("only preferencesV2 is read; old values and invalid current versions are left untouched", async () => {
  const saved = {
    agent: { provider: "openai", modelId: "old" },
    preferencesV2: { schemaVersion: 1 },
  };
  const writes: unknown[] = [];
  const store = new PreferencesStore(
    {
      get: async keys => {
        assert.deepEqual(keys, ["preferencesV2"]);
        return saved;
      },
      set: async value => {
        writes.push(value);
      },
    },
    "zh-TW",
  );
  const observed: unknown[] = [];
  const unsubscribe = store.subscribe(value => observed.push(value));
  await assert.rejects(store.save(defaultPreferences()), /loaded/);
  const value = await store.load();
  assert.equal(value.agent, null);
  assert.equal(value.profile.instructionLanguage, "zh-TW");
  assert.equal(writes.length, 0);
  assert.equal(saved.agent.modelId, "old");
  await store.save({
    ...value,
    agent: { provider: "openai", modelId: "gpt", thinkingLevel: "high" },
  });
  assert.equal(observed.length, 2);
  assert.deepEqual(Object.keys(writes[0] as object), ["preferencesV2"]);
  unsubscribe();
});

test("rapid writes keep their order and a failed write does not block later preferences", async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  const values: string[] = [];
  const store = new PreferencesStore({
    get: async () => ({}),
    set: async saved => {
      values.push((saved.preferencesV2 as ReturnType<typeof defaultPreferences>).themePreference);
      if (values.length === 1) {
        await wait;
        throw new Error("temporary failure");
      }
    },
  });
  const defaults = await store.load();
  const first = store.save({ ...defaults, themePreference: "dark" });
  const failed = assert.rejects(first, /temporary/);
  const second = store.save({ ...defaults, themePreference: "light" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(values, ["dark"]);
  release();
  await failed;
  await second;
  assert.deepEqual(values, ["dark", "light"]);
  assert.equal(store.current().themePreference, "light");
});

test("a rejected write restores the last successfully persisted snapshot", async () => {
  let fail = false;
  const store = new PreferencesStore({
    get: async () => ({}),
    set: async () => {
      if (fail) throw new Error("storage full");
    },
  });
  const initial = await store.load();
  await store.save({ ...initial, themePreference: "dark" });
  fail = true;
  await assert.rejects(store.save({ ...initial, themePreference: "light" }), /storage full/);
  assert.equal(store.current().themePreference, "dark");
});
