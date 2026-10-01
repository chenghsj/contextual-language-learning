import assert from "node:assert/strict";
import test from "node:test";
import { PreferencesStore, defaultPreferences } from "./preferences-store";

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
});
