import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CustomGenerationRequestSchema,
  GenerationRequestSchema,
  type HostMessage,
} from "@immersive/core";
import { createHostDispatcher } from "./host/dispatcher";
import { JobManager } from "./jobs/manager";
import { CustomJobManager } from "./jobs/custom-manager";
import { FileCustomRepository } from "./storage/custom";
import { localStoragePorts } from "./storage/file";

test("dispatcher durably queues both content kinds, rejects duplicate resume without altering work, then continues after failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-host-queue-"));
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(done => {
      release = done;
    }),
    running = new Promise<void>(done => {
      started = done;
    });
  try {
    const storage = localStoragePorts(root),
      repository = new FileCustomRepository(join(root, "custom"));
    const messages: HostMessage[] = [],
      reply = (message: HostMessage) => {
        messages.push(message);
      };
    const manager = new JobManager(
      {
        storage,
        generateCandidates: async () => {
          started();
          await held;
          throw new Error("provider failed");
        },
      },
      (id, job) => reply({ type: "job", id, job }),
    );
    let calls = 0;
    const custom = new CustomJobManager(
      {
        repository,
        resolveModel: async agent => ({
          agent: { ...agent, modelId: "pinned" },
          contextWindow: 16384,
          maxOutputTokens: 4096,
        }),
        generate: async (_a, _p, _s, options) => {
          calls++;
          return {
            text: "# Saved",
            call: {
              step: options.step,
              provider: "openai",
              modelId: "pinned",
              at: new Date().toISOString(),
            },
          };
        },
      },
      (id, job) => reply({ type: "job", id, job }),
      () => manager.isRunning(),
    );
    const handle = createHostDispatcher({
      storage,
      manager,
      customManager: custom,
      reply,
      hostVersion: "0.1.0",
    });
    const standard = GenerationRequestSchema.parse({
      id: randomUUID(),
      source: { platform: "import", title: "Standard" },
      profile: {
        targetLanguage: "en",
        instructionLanguage: "zh-TW",
        level: "B1",
        sceneCount: 2,
        contextualExampleCount: 1,
      },
      agent: { provider: "openai", modelId: "" },
      cues: [{ id: "a", startMs: 0, endMs: 1000, originalText: "Hello" }],
    });
    const payload = CustomGenerationRequestSchema.parse({
      id: randomUUID(),
      kind: "custom",
      source: { platform: "import", title: "Custom" },
      agent: { provider: "openai", modelId: "" },
      cues: standard.cues,
      prompt: "Summarize",
      context: { title: true, subtitles: true },
    });
    const check = async (data: typeof standard | typeof payload) => {
      await handle({
        type: "kind" in data ? "checkCustomDuplicates" : "checkDuplicates",
        id: randomUUID(),
        payload: data,
      });
      const message = messages.at(-1)!;
      assert.equal(message.type, "duplicates");
      return message.type === "duplicates" ? message.token : "";
    };
    const first = handle({
      type: "generate",
      id: standard.id,
      payload: standard,
      checkToken: await check(standard),
      confirmRegeneration: false,
    });
    await running;
    const second = handle({
      type: "generateCustom",
      id: payload.id,
      payload,
      checkToken: await check(payload),
      confirmRegeneration: false,
    });
    for (let attempt = 0; attempt < 100 && !(await repository.getJob(payload.id)); attempt++)
      await new Promise(done => setTimeout(done, 5));
    assert.equal((await repository.getJob(payload.id))?.summary.status, "queued");
    assert.equal(calls, 0);
    await handle({ type: "resumeCustom", id: randomUUID(), jobId: payload.id });
    assert.equal(
      (await repository.getJob(payload.id))?.summary.status,
      "queued",
      "rejected duplicate must not corrupt admitted work",
    );
    payload.prompt = "Edited frontend draft";
    release();
    await Promise.all([first, second]);
    assert.equal((await storage.jobs.get(standard.id))?.summary.status, "failed");
    assert.equal((await repository.getJob(payload.id))?.summary.status, "completed");
    assert.equal((await repository.getDocument(payload.id))?.request.prompt, "Summarize");
    assert.equal(calls, 1);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});
