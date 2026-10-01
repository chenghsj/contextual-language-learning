import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PI_PROVIDER_REGISTRY, PI_PROVIDER_IDS, piProviderDefinition, isPiProviderId } from "@immersive/core";
import { createPiRuntime } from "./pi";
import { antigravityChatModels } from "./antigravity";
import { withAntigravityAccountDirectory, listAccounts } from "pi-antigravity/src/auth/accounts.js";

test("supported provider IDs, registrations and catalog policy come from one registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-registry-"));
  try {
    const original = process.env.PI_CODING_AGENT_DIR;
    const runtime = await createPiRuntime(root);
    assert.equal(new Set(PI_PROVIDER_IDS).size, PI_PROVIDER_IDS.length);
    for (const definition of PI_PROVIDER_REGISTRY) {
      assert.ok(isPiProviderId(definition.id));
      assert.equal(runtime.getProvider(definition.id)?.id, definition.id);
      assert.equal(piProviderDefinition(definition.id), definition);
    }
    assert.equal(process.env.PI_CODING_AGENT_DIR, original);
    const models = runtime.getModels("antigravity");
    assert.ok(models.length);
    assert.throws(() => antigravityChatModels([{ ...models[0], maxTokens: NaN }]), /Incompatible/);
    assert.equal(isPiProviderId("custom-old-cli"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("overlapping Antigravity account lookups use their own directory across async callbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-account-scopes-"));
  try {
    const directories = [join(root, "one"), join(root, "two")];
    for (const [index, directory] of directories.entries()) {
      await mkdir(directory);
      await writeFile(join(directory, "antigravity-accounts.json"), JSON.stringify({
        version: 1, activeAccountId: String(index), accounts: {
          [String(index)]: { accountId: String(index), email: `synthetic-${index}@example.test`,
            refresh: "synthetic-only", addedAt: 0, lastUsedAt: 0 },
        },
      }), { mode: 0o600 });
    }
    const results = await Promise.all(directories.map(directory =>
      withAntigravityAccountDirectory(directory, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return listAccounts().map(account => account.accountId);
      })));
    assert.deepEqual(results, [["0"], ["1"]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
