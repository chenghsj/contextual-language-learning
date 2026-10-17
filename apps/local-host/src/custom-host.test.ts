import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CustomGenerationRequestSchema,
  type HostMessage,
  type DuplicateMatch,
} from "@contextual/core";
import { createCustomHandler } from "./host/custom";
import { CustomJobManager } from "./jobs/custom-manager";
import { FileCustomRepository } from "./storage/custom";
import { sourceKey } from "./duplicates";

test("custom duplicate authorization freezes storage settings, rejects new remote matches and fails closed on cloud errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "custom-ticket-"));
  try {
    const repository = new FileCustomRepository(root),
      messages: HostMessage[] = [];
    const payload = CustomGenerationRequestSchema.parse({
      id: randomUUID(),
      kind: "custom",
      source: { platform: "import", title: "Source" },
      agent: { provider: "openai", modelId: "pinned" },
      prompt: "Summarize",
      context: { title: true, subtitles: true },
      cues: [{ id: "original", startMs: 0, endMs: 1000, originalText: "Dialogue" }],
      backup: { enabled: true, accountId: "account" },
      destination: { kind: "local" },
    });
    let calls = 0,
      remote: DuplicateMatch[] = [],
      offline = false;
    const manager = new CustomJobManager(
      {
        repository,
        resolveModel: async () => ({
          agent: payload.agent,
          contextWindow: 16384,
          maxOutputTokens: 4096,
        }),
        generate: async (_agent, _prompt, _signal, options) => {
          calls++;
          return {
            text: "# Notes\n\nSaved source-grounded content.",
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
    const handle = createCustomHandler(
      repository,
      manager,
      message => messages.push(message),
      undefined,
      async account => {
        assert.equal(account, "account");
        if (offline) throw new Error("Drive unavailable");
        return remote;
      },
    );
    const check = async () => {
      await handle({ type: "checkCustomDuplicates", id: randomUUID(), payload });
      const message = messages.at(-1)!;
      assert.equal(message.type, "duplicates");
      return message.type === "duplicates" ? message.token : "";
    };
    const token = await check();
    await assert.rejects(
      handle({
        type: "generateCustom",
        id: payload.id,
        payload: { ...payload, destination: { kind: "local", directory: root } },
        checkToken: token,
        confirmRegeneration: true,
      }),
      /settings/,
    );
    assert.equal(calls, 0);
    remote = [
      {
        documentId: randomUUID(),
        title: "Remote notes",
        createdAt: new Date().toISOString(),
        destination: "drive",
        exactSettings: true,
        local: false,
      },
    ];
    await assert.rejects(
      handle({
        type: "generateCustom",
        id: payload.id,
        payload,
        checkToken: token,
        confirmRegeneration: true,
      }),
      /New duplicate/,
    );
    offline = true;
    await assert.rejects(check(), /Drive unavailable/);
    assert.equal(calls, 0);
    offline = false;
    const confirmed = await check();
    await assert.rejects(
      handle({
        type: "generateCustom",
        id: payload.id,
        payload,
        checkToken: confirmed,
        confirmRegeneration: false,
      }),
      /Confirm/,
    );
    await handle({
      type: "generateCustom",
      id: payload.id,
      payload,
      checkToken: confirmed,
      confirmRegeneration: true,
    });
    assert.equal(calls, 1);
    assert.equal((await repository.getDocument(payload.id))?.request.prompt, payload.prompt);
    assert.equal(messages.at(-1)?.type, "generationSettled");
    await handle({ type: "listCustomDocuments", id: randomUUID() });
    const listing = messages.at(-1)!;
    assert.equal(listing.type, "customDocuments");
    if (listing.type === "customDocuments")
      assert.equal(listing.documents[0].sourceKey, sourceKey(payload.source, payload.cues));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
