import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureCredentialStore } from "./credentials";
import { createPiRuntime, piModels, piProviders } from "./pi";

test("opening AI settings batches SDK credential fan-out instead of reading the vault per provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-ai-loading-"));
  let reads = 0;
  try {
    const credentials = createSecureCredentialStore(root, {
      vault: {
        read: async () => {
          reads++;
          return JSON.stringify({ openai: { type: "api_key", key: "synthetic-key" } });
        },
        write: async () => {
          assert.fail("opening settings must not write credentials");
        },
      },
      legacyPaths: [],
    });
    const runtime = await createPiRuntime(root, credentials);
    const [providers, models] = await Promise.all([
      piProviders(runtime),
      piModels({ provider: "openai", modelId: "" }, runtime),
    ]);
    assert.equal(providers.find(provider => provider.id === "openai")?.connected, true);
    assert.ok(models.models.length);
    assert.ok(
      reads < 20,
      `opening AI settings read the credential vault ${reads} times (expected fewer than 20)`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
