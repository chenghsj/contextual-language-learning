import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PI_PROVIDER_REGISTRY,
  PI_PROVIDER_IDS,
  piProviderDefinition,
  isPiProviderId,
} from "@contextual/core";
import { createTestPiRuntime as createPiRuntime } from "./credentials-test-support";
import { antigravityChatModels } from "./antigravity";
import { withAntigravityAccountDirectory, listAccounts } from "pi-antigravity/src/auth/accounts.js";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { piProviders, piModels, resolvePiModel } from "./pi";

test("supported provider IDs, registrations and catalog policy come from one registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-registry-"));
  try {
    const original = process.env.PI_CODING_AGENT_DIR;
    const runtime = await createPiRuntime(root);
    const builtin = builtinProviders();
    assert.deepEqual(
      PI_PROVIDER_REGISTRY.filter(provider => provider.adapter === "builtin")
        .map(provider => provider.id)
        .sort(),
      builtin.map(provider => provider.id).sort(),
      "every service bundled by the pinned SDK must be advertised",
    );
    const advertised = await piProviders(runtime);
    assert.deepEqual(
      advertised.map(provider => provider.id),
      [...PI_PROVIDER_IDS],
    );
    for (const provider of builtin) {
      const info = advertised.find(item => item.id === provider.id)!;
      assert.equal(info.label, provider.name);
      assert.deepEqual(info.methodLabels, {
        ...(provider.auth.oauth ? { oauth: provider.auth.oauth.name } : {}),
        ...(provider.auth.apiKey?.login ? { api_key: provider.auth.apiKey.name } : {}),
      });
      assert.deepEqual(info.methods, [
        ...(provider.auth.oauth ? ["oauth"] : []),
        ...(provider.auth.apiKey?.login ? ["api_key"] : []),
      ]);
      assert.equal(
        piProviderDefinition(provider.id)?.modelCatalog,
        provider.refreshModels ? "dynamic" : "static",
      );
    }
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("classifier-only services do not offer classifier models for lesson generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-classifier-"));
  try {
    const runtime = await createPiRuntime(root);
    await runtime.setRuntimeApiKey("typesafe", "synthetic-only");
    assert.ok(runtime.getAllModels("typesafe").some(model => model.type === "classifier"));
    assert.deepEqual((await piModels({ provider: "typesafe", modelId: "" }, runtime)).models, []);
    await assert.rejects(
      resolvePiModel({ provider: "typesafe", modelId: "" }, runtime),
      /selected model is unavailable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("connected service labels follow the saved SDK authentication method", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-provider-labels-"));
  try {
    for (const [credential, label] of [
      [undefined, "OpenAI"],
      [
        { type: "oauth", access: "synthetic", refresh: "synthetic", expires: Date.now() + 60000 },
        "OpenAI (ChatGPT subscription)",
      ],
      [{ type: "api_key", key: "synthetic" }, "OpenAI API key"],
    ] as const) {
      const caseRoot = join(root, label);
      await mkdir(caseRoot);
      await writeFile(
        join(caseRoot, "auth.json"),
        JSON.stringify(credential ? { openai: credential } : {}),
      );
      const runtime = await createPiRuntime(caseRoot);
      const provider = (await piProviders(runtime)).find(item => item.id === "openai")!;
      assert.equal(provider.label, label);
      assert.equal(provider.connected, !!credential);
      assert.equal(provider.credentialMethod, credential?.type);
      if (credential) assert.equal(provider.label, provider.methodLabels?.[credential.type]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("overlapping Antigravity account lookups use their own directory across async callbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-account-scopes-"));
  try {
    const directories = [join(root, "one"), join(root, "two")];
    for (const [index, directory] of directories.entries()) {
      await mkdir(directory);
      await writeFile(
        join(directory, "antigravity-accounts.json"),
        JSON.stringify({
          version: 1,
          activeAccountId: String(index),
          accounts: {
            [String(index)]: {
              accountId: String(index),
              email: `synthetic-${index}@example.test`,
              refresh: "synthetic-only",
              addedAt: 0,
              lastUsedAt: 0,
            },
          },
        }),
        { mode: 0o600 },
      );
    }
    const results = await Promise.all(
      directories.map(directory =>
        withAntigravityAccountDirectory(directory, async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return listAccounts().map(account => account.accountId);
        }),
      ),
    );
    assert.deepEqual(results, [["0"], ["1"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
