import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LearningProfile } from "@contextual/core";
import { UNRESTRICTED_LEVEL } from "@contextual/core";
import { useCreateFlow, type CreateFlow, type CreateFlowOptions } from "../hooks/use-create-flow";
import type { DraftStorage } from "./draft-db";
import { draftRevision, type CreateDraft } from "./create-draft";
import { contextualGenerationProfile } from "./contextual-profile";
import type { GenerationInput } from "../native/generation-session";
import { CreateFrame } from "../components/create-frame";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const key of ["window", "document", "navigator", "HTMLElement"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollTo = () => {};
const profile = contextualGenerationProfile({
  targetLanguage: "en",
  instructionLanguage: "zh-TW",
  level: "B1",
  sceneCount: 4,
  contextualExampleCount: 1,
});
const source: CreateFlowOptions["source"] = {
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  title: "Video A",
  raw: "Hello",
  originalRaw: "Hello",
  loaded: true,
  captionsReady: true,
  subtitleBusy: false,
  cues: [{ id: "cue-1", startMs: 0, endMs: 10000, originalText: "Hello" }],
};
function saved(overrides: Partial<CreateDraft> = {}): CreateDraft {
  return {
    version: 1,
    sourceKey: "youtube:abcdefghijk",
    title: "Saved video",
    language: "en",
    subtitleRevision: draftRevision(source.raw),
    profile,
    mode: "custom",
    prompt: "Saved prompt",
    context: { subtitles: true, title: false },
    range: { mode: "custom", startMs: 1000, endMs: 5000 },
    step: 2,
    completedStep: 2,
    agent: { provider: "openai", modelId: "saved-model" },
    destination: { kind: "local", directory: "/tmp/lesson-copy" },
    backup: { enabled: false },
    ...overrides,
  };
}
class MemoryDrafts implements DraftStorage {
  values = new Map<string, unknown>();
  pending = new Map<string, Promise<unknown>>();
  writes: { key: string; value: unknown }[] = [];
  async read<T>(key: string) {
    return structuredClone(await (this.pending.get(key) ?? this.values.get(key))) as T | undefined;
  }
  async write<T>(key: string, value: T) {
    const copy = structuredClone(value);
    this.values.set(key, copy);
    this.writes.push({ key, value: copy });
  }
}
async function render(storage = new MemoryDrafts()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let currentSource = { ...source };
  let current!: CreateFlow;
  let changeProfile!: (value: LearningProfile) => void;
  let actualProfile!: LearningProfile;
  const requests: GenerationInput[] = [];
  const errors: string[] = [];
  let failure: Error | undefined;
  let invalidations = 0;
  const session = {
    start(input: GenerationInput) {
      if (failure) throw failure;
      requests.push(input);
    },
    dismissDuplicate() {},
    invalidatePreflight() {
      invalidations++;
    },
  };
  function Harness() {
    const [value, setValue] = useState(profile);
    changeProfile = setValue;
    actualProfile = value;
    current = useCreateFlow(
      {
        source: currentSource,
        profile: value,
        defaults: {
          agent: { provider: "openai", modelId: "default-model" },
          destination: { kind: "local" },
          backup: { enabled: false },
        },
        hydrated: true,
        locale: "zh-TW",
        initialLocale: "zh-TW",
        session,
        onProfile: setValue,
        onTitle: title => {
          currentSource = { ...currentSource, title };
        },
        onError: message => errors.push(message),
      },
      storage,
    );
    return React.createElement(CreateFrame, {
      create: current,
      locale: "zh-TW",
      active: true,
      preview: null,
      canSubmit: current.canSubmit({ ...available, modelReady: true }),
      checking: false,
      submitting: false,
      activeJobCount: 0,
      onSubmit: () => current.submit(available),
      children: React.createElement(
        "output",
        null,
        `${current.state.createStep}:${current.state.customPrompt}`,
      ),
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  return {
    storage,
    container,
    requests,
    errors,
    get flow() {
      return current;
    },
    get profile() {
      return actualProfile;
    },
    get invalidations() {
      return invalidations;
    },
    fail(error?: Error) {
      failure = error;
    },
    async source(patch: Partial<CreateFlowOptions["source"]>) {
      currentSource = { ...currentSource, ...patch };
      await act(async () => root.render(React.createElement(Harness)));
    },
    async profileTo(value: LearningProfile) {
      await act(async () => changeProfile(value));
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
const available = {
  checking: false,
  submitting: false,
  hostReady: true,
  installed: { openai: true },
  driveAccessVerified: true,
};

test("Create navigation allows only completed steps and blocks an empty custom prompt", async () => {
  const view = await render();
  const button = (label: string) =>
    [...view.container.querySelectorAll("button")].find(
      element => element.textContent?.trim() === label,
    )!;
  try {
    const steps = () => [
      ...view.container.querySelectorAll<HTMLButtonElement>('[data-ui="create-steps"] button'),
    ];
    assert.equal(steps()[1].disabled, true);
    await act(async () => button("下一步").click());
    assert.equal(view.flow.state.createStep, 1);
    await act(async () => view.flow.edit({ contentMode: "custom", customPrompt: "" }));
    assert.equal(button("下一步").disabled, true);
    await act(async () => view.flow.edit({ customPrompt: "Explain this source" }));
    await act(async () => button("下一步").click());
    assert.equal(view.flow.state.createStep, 2);
    const submit = view.container.querySelector('[data-ui="create-footer"] button:last-child')!;
    for (const token of ["text-xs", "font-semibold", "whitespace-normal", "wrap-anywhere"])
      assert.ok(submit.classList.contains(token), "Create action must retain " + token);
    assert.doesNotMatch(submit.className, /\bbg-(?:red|green)/);

    await act(async () => steps()[0].click());
    assert.equal(view.flow.state.createStep, 0);
    await act(async () => steps()[2].click());
    assert.equal(view.flow.state.createStep, 2);
    assert.equal(view.requests.length, 0);
  } finally {
    await view.close();
  }
});

test("Create restores mode, range, overrides and steps; subtitle edits reset only progression", async () => {
  const storage = new MemoryDrafts();
  storage.values.set("create:youtube:abcdefghijk", saved());
  const view = await render(storage);
  try {
    assert.equal(view.flow.draft.ready, true);
    assert.equal(view.flow.state.customPrompt, "Saved prompt");
    assert.equal(view.flow.state.createStep, 2);
    assert.equal(view.flow.generationAgent.modelId, "saved-model");
    assert.equal(view.flow.destination.directory, "/tmp/lesson-copy");
    assert.equal(view.flow.estimatePayload?.analysisRange?.startMs, 1000);
  } finally {
    await view.close();
  }
  const editedStorage = new MemoryDrafts();
  editedStorage.values.set("create:youtube:abcdefghijk", saved({ subtitleRevision: "different" }));
  const edited = await render(editedStorage);
  try {
    assert.equal(edited.flow.state.createStep, 0);
    assert.equal(edited.flow.state.completedStep, 0);
    assert.equal(edited.flow.state.contentMode, "custom");
    assert.equal(edited.flow.state.analysisSelection.endMs, 5000);
  } finally {
    await edited.close();
  }
});

test("a late draft read cannot replace the selected video's prompt, profile or persisted source", async () => {
  const storage = new MemoryDrafts();
  let finish!: (value: unknown) => void;
  storage.pending.set(
    "create:youtube:abcdefghijk",
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const view = await render(storage);
  try {
    assert.equal(view.flow.draft.ready, false);
    await view.source({ url: "https://www.youtube.com/watch?v=lmnopqrstuv", title: "Video B" });
    await act(async () => view.flow.edit({ contentMode: "custom", customPrompt: "B prompt" }));
    await act(async () =>
      finish(saved({ profile: { ...profile, targetLanguage: "ja", level: "N3" } })),
    );
    assert.equal(view.profile.targetLanguage, "en");
    assert.equal(view.flow.state.customPrompt, "B prompt");
    assert.equal(view.flow.draft.ready, true);
    await act(async () => window.dispatchEvent(new dom.window.Event("pagehide")));
    const persisted = storage.values.get("create:youtube:lmnopqrstuv") as CreateDraft;
    assert.equal(persisted.sourceKey, "youtube:lmnopqrstuv");
    assert.equal(persisted.title, "Video B");
    assert.equal(persisted.prompt, "B prompt");
  } finally {
    await view.close();
  }
});

test("Quick Create preserves a video's own draft and adapts last settings for a new language", async () => {
  const storage = new MemoryDrafts();
  storage.values.set("create:youtube:abcdefghijk", saved({ prompt: "Video-specific" }));
  storage.values.set("last-create-settings", saved({ prompt: "Last-run" }));
  const view = await render(storage);
  try {
    await act(async () => view.flow.quickCreate());
    assert.equal(view.flow.state.customPrompt, "Video-specific");
    await view.source({ url: "https://www.youtube.com/watch?v=lmnopqrstuv", title: "Other" });
    await view.profileTo({ ...profile, targetLanguage: "ja", level: "N4" });
    await act(async () => view.flow.quickCreate());
    assert.equal(view.flow.state.createStep, 2);
    assert.equal(view.flow.state.customPrompt, "Last-run");
    assert.equal(view.profile.targetLanguage, "ja");
    assert.notEqual(view.profile.level, "B1");
    assert.equal(view.flow.state.analysisSelection.startMs, 1000);
  } finally {
    await view.close();
  }
});

test("Quick Create carries unrestricted last settings into another learning language", async () => {
  const storage = new MemoryDrafts();
  storage.values.set(
    "last-create-settings",
    saved({
      mode: "standard",
      profile: { ...profile, level: UNRESTRICTED_LEVEL },
    }),
  );
  const view = await render(storage);
  try {
    await view.profileTo({ ...profile, targetLanguage: "ja", level: "N4" });
    await act(async () => view.flow.quickCreate());
    assert.equal(view.profile.targetLanguage, "ja");
    assert.equal(view.profile.level, UNRESTRICTED_LEVEL);
    await act(async () => assert.deepEqual(view.flow.submit(available), { status: "started" }));
    const request = view.requests[0];
    assert.ok("profile" in request);
    assert.equal(request.profile.level, UNRESTRICTED_LEVEL);
  } finally {
    await view.close();
  }
});

test("Quick Create rejects unsupported saved timing without partially applying last settings", async () => {
  const storage = new MemoryDrafts();
  storage.values.set(
    "last-create-settings",
    saved({ range: { mode: "first", startMs: 0, endMs: 5000 } }),
  );
  const view = await render(storage);
  try {
    await act(async () => view.flow.quickCreate());
    assert.equal(view.errors.length, 1);
    assert.equal(view.flow.state.createStep, 0);
    assert.equal(view.flow.state.contentMode, "standard");
    await view.source({ videoDurationMs: 20000 });
    await act(async () => view.flow.quickCreate());
    assert.equal(view.flow.state.createStep, 2);
    assert.deepEqual(view.flow.state.analysisSelection, {
      mode: "first",
      startMs: 0,
      endMs: 10000,
    });
  } finally {
    await view.close();
  }
});

test("Create builds standard and custom requests using overrides and records last settings only on admission", async () => {
  const view = await render();
  try {
    assert.equal(view.flow.generationAgent.modelId, "default-model");
    await act(async () =>
      view.flow.edit({
        requestAgent: { provider: "openai", modelId: "chosen" },
        requestDestination: { kind: "local", directory: "/tmp/chosen" },
        requestBackup: { enabled: false },
        analysisSelection: { mode: "custom", startMs: 1000, endMs: 5000 },
      }),
    );
    await act(async () => assert.deepEqual(view.flow.submit(available), { status: "started" }));
    const first = view.requests[0];
    assert.equal(first.agent.modelId, "chosen");
    assert.equal(first.destination?.kind, "local");
    assert.equal(first.destination?.kind === "local" && first.destination.directory, "/tmp/chosen");
    assert.equal(first.analysisRange?.startMs, 1000);
    assert.equal("outputSchemaVersion" in first && first.outputSchemaVersion, 7);
    assert.equal(view.storage.values.has("last-create-settings"), false);
    await act(async () => view.flow.edit({ customPrompt: "Edited after submission" }));
    await act(async () =>
      view.flow.admitted({ id: first.id } as Parameters<CreateFlow["admitted"]>[0]),
    );
    const accepted = view.storage.values.get("last-create-settings") as CreateDraft;
    assert.notEqual(accepted.prompt, "Edited after submission");
    assert.equal(accepted.agent?.modelId, "chosen");
    await act(async () => view.flow.edit({ contentMode: "custom", customPrompt: "Summarize" }));
    await act(async () => assert.deepEqual(view.flow.submit(available), { status: "started" }));
    const second = view.requests[1];
    assert.equal("kind" in second && second.kind, "custom");
    assert.equal("prompt" in second && second.prompt, "Summarize");
    assert.equal(second.analysisRange?.durationSource, "subtitles");
  } finally {
    await view.close();
  }
});

test("Create gates submission, invalidates edited preflight and permits retry after a transport failure", async () => {
  const view = await render();
  try {
    assert.equal(view.flow.canSubmit({ ...available, modelReady: true }), true);
    assert.equal(view.flow.canSubmit({ ...available, modelReady: false }), false);
    assert.equal(view.flow.canSubmit({ ...available, modelReady: true, submitting: true }), false);
    assert.deepEqual(view.flow.submit({ ...available, checking: true }), { status: "busy" });
    assert.deepEqual(view.flow.submit({ ...available, hostReady: false }), {
      status: "blocked",
      reason: "host",
    });
    assert.deepEqual(view.flow.submit({ ...available, installed: {} }), {
      status: "blocked",
      reason: "provider",
    });
    await act(async () => view.flow.edit({ requestBackup: { enabled: true } }));
    assert.deepEqual(view.flow.submit({ ...available, driveAccessVerified: false }), {
      status: "blocked",
      reason: "backup",
    });
    const count = view.invalidations;
    await act(async () =>
      view.flow.edit({ customPrompt: "New prompt", requestBackup: { enabled: false } }),
    );
    assert.ok(view.invalidations > count);
    view.fail(new Error("Disconnected"));
    assert.deepEqual(view.flow.submit(available), { status: "error", message: "Disconnected" });
    assert.equal(view.storage.values.has("last-create-settings"), false);
    view.fail();
    await act(async () => assert.deepEqual(view.flow.submit(available), { status: "started" }));
    assert.equal(view.requests.length, 1);
    await view.source({ captionsReady: false });
    assert.deepEqual(view.flow.submit(available), { status: "blocked", reason: "subtitles" });
  } finally {
    await view.close();
  }
});
