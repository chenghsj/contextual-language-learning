import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomGenerationRequestSchema, type HostMessage } from "@immersive/core";
import { FileCustomRepository } from "./custom";
import { createCustomPublication } from "./custom-backup";
import { CustomJobManager } from "../jobs/custom-manager";
import { DriveContentConflict, propertyMatch } from "../drive/api";

test("Drive filters accept both document versions and reject query injection", () => {
  for (const value of ["5", "custom-v1", "a".repeat(64)])
    assert.ok(propertyMatch("immersiveSchemaVersion", value).includes(value));
  assert.throws(() => propertyMatch("immersiveSchemaVersion", "5' or trashed = true"));
});

test("custom publication retries durable content, preserves conflicting copies and resumes backups after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "custom-backup-"));
  try {
    const repository = new FileCustomRepository(join(root, "repo"));
    const request = CustomGenerationRequestSchema.parse({
      id: randomUUID(),
      kind: "custom",
      source: { platform: "import", title: "Notes" },
      agent: { provider: "openai", modelId: "pinned" },
      prompt: "Summarize",
      context: { title: true, subtitles: true },
      cues: [{ id: "original", originalText: "source", startMs: 0, endMs: 1000 }],
      destination: { kind: "local", directory: root },
      backup: { enabled: true, accountId: "account" },
    });
    let modelCalls = 0;
    const manager = new CustomJobManager(
      {
        repository,
        resolveModel: async () => ({
          agent: request.agent,
          contextWindow: 16384,
          maxOutputTokens: 4096,
        }),
        generate: async (_agent, _prompt, _signal, options) => {
          modelCalls++;
          return {
            text: "# Notes\n\nResult.",
            call: {
              step: options.step,
              provider: "openai",
              modelId: "pinned",
              at: new Date().toISOString(),
            },
          };
        },
      },
      () => {},
    );
    const document = await manager.start(request.id, request);
    const messages: HostMessage[] = [];
    const failed = createCustomPublication(
      repository,
      message => messages.push(message),
      async () => {
        throw new Error("Offline");
      },
      async directory => directory!,
    );
    await failed.afterSave(document, randomUUID());
    assert.equal((await repository.getJob(request.id))?.summary.status, "completed");
    assert.equal((await repository.getJob(request.id))?.summary.backup?.status, "failed");
    const folder = join(root, "Custom-" + request.id);
    assert.equal(await readFile(join(folder, "content.md"), "utf8"), document.markdown);
    await writeFile(join(folder, "content.md"), "User edited copy");
    await failed.localCopy(document, randomUUID());
    assert.equal((await repository.getJob(request.id))?.summary.publication?.status, "failed");
    assert.equal(await readFile(join(folder, "content.md"), "utf8"), "User edited copy");
    const conflict = createCustomPublication(
      repository,
      () => {},
      async () => {
        throw new DriveContentConflict("changed remotely");
      },
    );
    await assert.rejects(conflict.backup(request.id, randomUUID()), /changed remotely/);
    assert.equal((await repository.getJob(request.id))?.summary.backup?.status, "conflict");
    await repository.updateJob(request.id, job => ({
      ...job,
      summary: { ...job.summary, backup: { ...job.summary.backup!, status: "uploading" } },
      historyHidden: true,
    }));
    let uploads = 0;
    const restarted = createCustomPublication(
      new FileCustomRepository(join(root, "repo")),
      message => messages.push(message),
      async (account, doc) => {
        assert.equal(account, "account");
        assert.equal(doc.markdown, document.markdown);
        uploads++;
        return "https://drive.google.com/file/d/test/view";
      },
    );
    await restarted.resume(randomUUID());
    assert.equal(uploads, 1);
    assert.equal(
      await restarted.schedule("account"),
      0,
      "unchanged completed backups are not scheduled again",
    );
    let publishStarted!: () => void, releasePublish!: () => void;
    const entered = new Promise<void>(resolve => {
      publishStarted = resolve;
    });
    const gate = new Promise<void>(resolve => {
      releasePublish = resolve;
    });
    const concurrent = createCustomPublication(
      repository,
      () => {},
      async account => {
        assert.equal(account, "account");
        publishStarted();
        await gate;
        return "https://drive.google.com/file/d/test/view";
      },
    );
    const uploading = concurrent.backup(request.id, randomUUID());
    await entered;
    const switching = concurrent.schedule("other-account");
    assert.equal(
      (await repository.getJob(request.id))?.summary.backup?.accountId,
      "account",
      "account does not change underneath an active upload",
    );
    releasePublish();
    await uploading;
    assert.equal(await switching, 1);
    assert.equal((await repository.getJob(request.id))?.summary.backup?.accountId, "other-account");
    assert.equal(
      (await repository.getJob(request.id))?.summary.backup?.status,
      "pending",
      "old upload is never marked as backed up to the newly selected account",
    );
    // Return the recorded completed backup before checking local deletion retention.
    await repository.updateJob(request.id, job => ({
      ...job,
      summary: {
        ...job.summary,
        backup: { ...job.summary.backup!, accountId: "account", status: "backed-up" },
      },
    }));
    assert.equal((await repository.getJob(request.id))?.summary.backup?.status, "backed-up");
    assert.equal(modelCalls, 1, "copy and backup retries never regenerate content");
    await repository.deleteDocument(request.id);
    assert.equal(await repository.getDocument(request.id), null);
    assert.equal((await repository.getJob(request.id))?.summary.backup?.status, "backed-up");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
