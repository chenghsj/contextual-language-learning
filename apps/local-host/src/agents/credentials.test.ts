import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSecureCredentialStore } from "./credentials";
import type { CredentialVault } from "../platform/credential-vault";
import { spawn } from "node:child_process";

const oauth = {
  type: "oauth" as const,
  access: "fixture-access",
  refresh: "fixture-refresh",
  expires: 123456789,
  projectId: "fixture-project",
};
const key = { type: "api_key" as const, key: "fixture-key" };
async function fixture(run: (root: string, vault: CredentialVault) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "cll-secure-credentials-"));
  let value: string | undefined;
  try {
    await run(root, {
      read: async () => value,
      write: async next => {
        value = next;
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("migrates API keys, OAuth extras and branding copies only after durable verification", () =>
  fixture(async (root, vault) => {
    const current = join(root, "auth.json"),
      old = join(root, "old-auth.json");
    await writeFile(current, JSON.stringify({ openai: key, antigravity: oauth }));
    await writeFile(old, JSON.stringify({ openai: { ...key, key: "older" }, anthropic: key }));
    const store = createSecureCredentialStore(root, { vault, legacyPaths: [current, old] });
    assert.deepEqual(await store.read("antigravity"), oauth);
    assert.deepEqual(await store.read("openai"), key);
    assert.deepEqual((await store.list()).map(item => item.providerId).sort(), [
      "anthropic",
      "antigravity",
      "openai",
    ]);
    await assert.rejects(readFile(current), { code: "ENOENT" });
    await assert.rejects(readFile(old), { code: "ENOENT" });
    for (const file of await readdir(root))
      assert.doesNotMatch(await readFile(join(root, file), "utf8"), /fixture-(key|access|refresh)/);
    const restarted = createSecureCredentialStore(root, { vault, legacyPaths: [current, old] });
    assert.deepEqual(await restarted.read("antigravity"), oauth);
    await restarted.delete("openai");
    assert.equal(await createSecureCredentialStore(root, { vault }).read("openai"), undefined);
    await writeFile(current, JSON.stringify({ openai: key }));
    await assert.rejects(restarted.list(), /reappeared/);
  }));

test("denied access, failed writes and failed readback preserve the complete legacy file", async () => {
  for (const phase of ["read", "write", "verify"])
    await fixture(async (root, vault) => {
      const path = join(root, "auth.json"),
        text = JSON.stringify({ openai: key });
      await writeFile(path, text);
      let reads = 0;
      const failing = {
        read: async () => {
          if (phase === "read") throw new Error("denied");
          if (phase === "verify" && ++reads > 1) return "{}";
          return vault.read();
        },
        write: async (value: string) => {
          if (phase === "write") throw new Error("denied");
          await vault.write(value);
        },
      };
      await assert.rejects(createSecureCredentialStore(root, { vault: failing }).list());
      assert.equal(await readFile(path, "utf8"), text);
    });
});

test("interrupted migration keeps the newer secure credential and resumes cleanup", () =>
  fixture(async (root, vault) => {
    await vault.write(JSON.stringify({ openai: { ...key, key: "newer" } }));
    await writeFile(join(root, "auth.json"), JSON.stringify({ openai: key, antigravity: oauth }));
    const store = createSecureCredentialStore(root, { vault });
    assert.equal(((await store.read("openai")) as typeof key).key, "newer");
    assert.deepEqual(await store.read("antigravity"), oauth);
  }));

test("serialized refresh across independent stores observes the latest rotated token", () =>
  fixture(async (root, vault) => {
    const one = createSecureCredentialStore(root, { vault }),
      two = createSecureCredentialStore(root, { vault });
    await one.modify("openai", async () => oauth);
    let refreshes = 0;
    const refresh = async (current: any) => {
      if (current.refresh === "rotated") return undefined;
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return { ...current, refresh: "rotated" };
    };
    await Promise.all([one.modify("openai", refresh), two.modify("openai", refresh)]);
    assert.equal(refreshes, 1);
    assert.equal(((await two.read("openai")) as typeof oauth).refresh, "rotated");
    await one.delete("openai");
    assert.deepEqual(await two.list(), []);
  }));

test("missing previously initialized system entry fails closed", () =>
  fixture(async (root, vault) => {
    const store = createSecureCredentialStore(root, { vault });
    await store.modify("openai", async () => key);
    const missing = createSecureCredentialStore(root, {
      vault: {
        read: async () => undefined,
        write: async () => {
          assert.fail("must not replace missing secure credentials");
        },
      },
    });
    await assert.rejects(
      missing.modify("openai", async () => key),
      /missing or locked/,
    );
  }));

test("invalid legacy JSON and credential commands never execute or delete the source", async () => {
  for (const text of [
    "not JSON",
    JSON.stringify({ openai: { type: "api_key", key: "!echo unsafe" } }),
  ])
    await fixture(async (root, vault) => {
      const path = join(root, "auth.json");
      await writeFile(path, text);
      await assert.rejects(createSecureCredentialStore(root, { vault }).list(), /invalid/);
      assert.equal(await readFile(path, "utf8"), text);
    });
});

test("aborted operation and failed refresh callback cannot mutate saved credentials", () =>
  fixture(async (root, vault) => {
    const store = createSecureCredentialStore(root, { vault });
    await store.modify("openai", async () => key);
    await assert.rejects(
      store.modify("openai", async () => {
        throw new Error("fixture refresh failed");
      }),
      /fixture refresh/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(store.delete("openai", { signal: controller.signal }));
    assert.deepEqual(await store.read("openai"), key);
  }));

test("cross-process refresh transactions cannot overwrite another process's update", () =>
  fixture(async root => {
    const path = join(root, "fixture-vault");
    await writeFile(path, JSON.stringify({ openai: { ...oauth, expires: 0 } }));
    const script = `
    import {readFile,writeFile} from 'node:fs/promises';
    import {createSecureCredentialStore} from ${JSON.stringify(new URL("./credentials.ts", import.meta.url).href)};
    const store=createSecureCredentialStore(${JSON.stringify(root)}, {vault:{
      read:()=>readFile(${JSON.stringify(path)},'utf8'),
      write:value=>writeFile(${JSON.stringify(path)},value)
    }});
    await store.modify('openai',async current=>{
      await new Promise(resolve=>setTimeout(resolve,100));
      return {...current,expires:current.expires+1};
    });
  `;
    const child = () =>
      new Promise<void>((resolveChild, reject) => {
        const processChild = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", script],
          { stdio: "ignore" },
        );
        processChild.on("error", reject);
        processChild.on("exit", code =>
          code === 0 ? resolveChild() : reject(new Error("Fixture process failed")),
        );
      });
    await Promise.all([child(), child()]);
    assert.equal(JSON.parse(await readFile(path, "utf8")).openai.expires, 2);
  }));
