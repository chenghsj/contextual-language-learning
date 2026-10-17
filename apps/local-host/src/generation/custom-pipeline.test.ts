import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomGenerationRequestSchema, type AgentSettings } from "@contextual/core";
import { FileCustomRepository } from "../storage/custom";
import { CustomJobManager } from "../jobs/custom-manager";
import { planCustomJob, validateMarkdown } from "./custom-pipeline";
const model = {
  agent: { provider: "openai", modelId: "pinned" },
  contextWindow: 16384,
  maxOutputTokens: 4096,
};
const request = (count = 1) =>
  CustomGenerationRequestSchema.parse({
    id: randomUUID(),
    kind: "custom",
    source: { platform: "import", title: "Custom notes" },
    agent: { provider: "openai", modelId: "" },
    prompt: "Explain the supplied dialogue.",
    context: { subtitles: true, title: true },
    cues: Array.from({ length: count }, (_, i) => ({
      id: `original-${i}`,
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      originalText: "Source dialogue. ".repeat(35),
    })),
    backup: { enabled: false },
  });
const resolveModel = async (agent: AgentSettings) => {
  assert.equal(agent.provider, "openai");
  return model;
};
const output = (step: string) => ({
  text: `# ${step}\n\nValidated Markdown.`,
  call: { step, provider: "openai", modelId: "pinned", at: new Date().toISOString() },
});
test("large custom inputs freeze a multi-level plan and resume only incomplete nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "custom-plan-"));
  try {
    const repository = new FileCustomRepository(root),
      payload = request(100);
    let calls = 0;
    const manager = new CustomJobManager(
      {
        repository,
        resolveModel,
        generate: async (_agent, _prompt, _signal, options) => {
          calls++;
          if (calls === 3) throw new Error("provider temporarily unavailable");
          return output(options.step);
        },
      },
      () => {},
    );
    await assert.rejects(manager.start(payload.id, payload), /temporarily unavailable/);
    const saved = await repository.getJob(payload.id);
    assert.ok(saved);
    assert.equal(saved.summary.completed, 2);
    assert.equal(saved.summary.status, "failed");
    assert.ok(saved.nodes.some(node => node.level >= 2));
    assert.equal(saved.execution.modelId, "pinned");
    assert.equal(
      saved.request.agent.modelId,
      "",
      "original requested model choice remains in snapshot",
    );
    const completed = saved.nodes.filter(node => node.output).map(node => node.id),
      resumed: string[] = [];
    const next = new CustomJobManager(
      {
        repository,
        resolveModel,
        generate: async (agent, prompt, signal, options) => {
          assert.equal(agent.modelId, "pinned");
          assert.ok(Buffer.byteLength(prompt) <= saved.inputBudget);
          signal.throwIfAborted();
          resumed.push(options.step);
          return output(options.step);
        },
      },
      () => {},
    );
    const doc = await next.resume(randomUUID(), payload.id);
    assert.ok(completed.every(id => !resumed.includes(id)));
    assert.equal(doc.execution.calls.length, saved.nodes.length);
    assert.equal((await repository.getJob(payload.id))?.summary.status, "completed");
    assert.equal((await repository.getDocument(doc.id))?.markdown, doc.markdown);
    assert.ok(
      (await readFile(join(root, "documents", doc.id, "metadata.json"), "utf8")).includes(
        "markdownHash",
      ),
    );
    await repository.renameDocument(doc.id, "Renamed");
    assert.equal((await repository.getDocument(doc.id))?.title, "Renamed");
    await repository.deleteDocument(doc.id);
    assert.equal(await repository.getDocument(doc.id), null);
    assert.ok(await repository.getJob(doc.id), "local deletion preserves task history");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("final output survives save failure; retry saving does not call the model again", async () => {
  const root = await mkdtemp(join(tmpdir(), "custom-save-"));
  try {
    class FailedSaveRepository extends FileCustomRepository {
      fail = true;
      override async saveDocument(doc: Parameters<FileCustomRepository["saveDocument"]>[0]) {
        if (this.fail) throw new Error("disk full");
        return super.saveDocument(doc);
      }
    }
    const repository = new FailedSaveRepository(root),
      payload = request();
    let calls = 0;
    const manager = new CustomJobManager(
      {
        repository,
        resolveModel,
        generate: async (_a, _p, _s, options) => {
          calls++;
          return output(options.step);
        },
      },
      () => {},
    );
    await assert.rejects(manager.start(payload.id, payload), /disk full/);
    const saved = await repository.getJob(payload.id);
    assert.ok(saved?.nodes.at(-1)?.output);
    assert.equal(saved.summary.phase, "saving");
    assert.equal(await repository.getDocument(payload.id), null);
    repository.fail = false;
    await manager.resume(randomUUID(), payload.id);
    assert.equal(calls, 1);
    await writeFile(join(root, "documents", payload.id, "content.md"), "tampered");
    await assert.rejects(repository.getDocument(payload.id), /metadata/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("explicit cancellation keeps checkpoint and rejects silent version or model changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "custom-cancel-"));
  try {
    const repository = new FileCustomRepository(root),
      payload = request();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const manager = new CustomJobManager(
      {
        repository,
        resolveModel,
        generate: async (_a, _p, signal) => {
          entered();
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
          );
          return output("unreachable");
        },
      },
      () => {},
    );
    const result = manager.start(payload.id, payload);
    const rejected = assert.rejects(result, /aborted/);
    await ready;
    assert.equal(await manager.cancel(payload.id), true);
    await rejected;
    assert.equal((await repository.getJob(payload.id))?.summary.status, "cancelled");
    assert.equal((await repository.getJob(payload.id))?.summary.completed, 0);
    await repository.updateJob(payload.id, job => ({
      ...job,
      execution: { ...job.execution, workflowVersion: "future-version" },
    }));
    await assert.rejects(manager.resume(randomUUID(), payload.id), /Unsupported saved execution/);
    await repository.updateJob(payload.id, job => ({
      ...job,
      execution: { ...job.execution, workflowVersion: "custom-markdown-1" },
    }));
    const changed = new CustomJobManager(
      {
        repository,
        resolveModel: async () => ({ ...model, agent: { ...model.agent, modelId: "changed" } }),
      },
      () => {},
    );
    await assert.rejects(changed.resume(randomUUID(), payload.id), /Pinned model/);
    assert.equal((await repository.getJob(payload.id))?.summary.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("budget and output validation reject oversize content without truncating input", () => {
  const payload = request();
  assert.throws(
    () => planCustomJob({ ...payload, prompt: "x".repeat(20000) }, model),
    /shorten the prompt/,
  );
  for (const text of ["", '{"wrong":"format"}', "```markdown\n# Wrapped\n```", "x".repeat(500)])
    assert.throws(() => validateMarkdown(text, 100));
  assert.equal(validateMarkdown("[Link](https://example.com)", 100), "[Link](https://example.com)");
});
