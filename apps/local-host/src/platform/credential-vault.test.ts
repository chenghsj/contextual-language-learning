import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createSystemCredentialVault,
  windowsProtectionScript,
  type VaultRunner,
} from "./credential-vault";

const secret = '{"openai":{"type":"api_key","key":"fixture-secret-中文-\\\"-$()"}}';
test("macOS uses stdin and distinguishes missing items from denied access without leaking helper output", async () => {
  let saved: string | undefined,
    denied = false;
  const run: VaultRunner = async (command, args, input) => {
    assert.equal(command, "/fixture/macos-credentials");
    assert.deepEqual(args, []);
    const request = JSON.parse(input);
    assert.match(request.account, /^[a-f0-9]{64}$/);
    if (denied) return { code: 1, stdout: secret, stderr: secret };
    if (request.action === "write") saved = request.value;
    return {
      code: 0,
      stdout: JSON.stringify(
        request.action === "write"
          ? { value: "" }
          : saved === undefined
            ? { missing: true }
            : { value: saved },
      ),
      stderr: "",
    };
  };
  const vault = createSystemCredentialVault("/fixture/root", {
    platform: "darwin",
    run,
    helperPath: "/fixture/macos-credentials",
  });
  assert.equal(await vault.read(), undefined);
  await vault.write(secret);
  assert.equal(await vault.read(), secret);
  denied = true;
  await assert.rejects(vault.read(), error => {
    assert.doesNotMatch(String(error), /fixture-secret/);
    return /Keychain/.test(String(error));
  });
});

test("Linux uses Secret Service and never passes a secret on the command line", async () => {
  let saved: string | undefined;
  const run: VaultRunner = async (command, args, input) => {
    assert.equal(command, "/usr/bin/secret-tool");
    assert.ok(!args.join(" ").includes("fixture-secret"));
    if (args[0] === "store") {
      saved = input;
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: saved === undefined ? 1 : 0, stdout: saved ?? "", stderr: "" };
  };
  const vault = createSystemCredentialVault("/fixture/root", { platform: "linux", run });
  assert.equal(await vault.read(), undefined);
  await vault.write(secret);
  assert.equal(await vault.read(), secret);
  for (const outcome of [
    async () => ({ code: 1, stdout: "", stderr: secret }),
    async () => {
      throw new Error(secret);
    },
  ]) {
    const denied = createSystemCredentialVault("/fixture/root", {
      platform: "linux",
      run: outcome,
    });
    await assert.rejects(
      denied.read(),
      error => /Secret Service/.test(String(error)) && !String(error).includes("fixture-secret"),
    );
    await assert.rejects(denied.write(secret), /Secret Service/);
  }
});

test("Windows persists only DPAPI ciphertext and round-trips Unicode through stdin", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-dpapi-contract-"));
  try {
    const ciphertext = Buffer.from("fixture encrypted data").toString("base64");
    const run: VaultRunner = async (command, args, input) => {
      assert.match(command, /powershell.exe$/);
      assert.ok(!args.join(" ").includes("fixture-secret"));
      assert.match(windowsProtectionScript, /DataProtectionScope\]::CurrentUser/);
      const request = JSON.parse(input);
      assert.equal(request.value, request.action === "protect" ? secret : ciphertext);
      return { code: 0, stdout: request.action === "protect" ? ciphertext : secret, stderr: "" };
    };
    const vault = createSystemCredentialVault(root, { platform: "win32", run });
    assert.equal(await vault.read(), undefined);
    await vault.write(secret);
    assert.equal(await readFile(join(root, "credentials.dpapi"), "utf8"), ciphertext);
    assert.equal(await vault.read(), secret);
    const denied = createSystemCredentialVault(root, {
      platform: "win32",
      run: async () => ({ code: 1, stdout: secret, stderr: secret }),
    });
    await assert.rejects(
      denied.read(),
      error => /DPAPI/.test(String(error)) && !String(error).includes("fixture-secret"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "native macOS Keychain round-trip with an isolated disposable item",
  {
    skip: process.platform !== "darwin" || process.env.CLL_TEST_KEYCHAIN !== "1",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cll-keychain-native-"));
    const account = createHash("sha256").update(root).digest("hex");
    const vault = createSystemCredentialVault(root);
    try {
      assert.equal(await vault.read(), undefined);
      await vault.write(secret);
      assert.equal(await vault.read(), secret);
      await vault.write("{}");
      assert.equal(await vault.read(), "{}");
    } finally {
      try {
        await promisify(execFile)("/usr/bin/security", [
          "delete-generic-password",
          "-s",
          "dev.contextual.language-learning.ai.v1",
          "-a",
          account,
        ]).catch(error => {
          if (error.code !== 44) throw new Error("Unable to remove disposable Keychain fixture");
        });
        assert.equal(await vault.read(), undefined);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);

test("native Windows DPAPI round-trip", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-dpapi-native-"));
  try {
    const vault = createSystemCredentialVault(root);
    await vault.write(secret);
    assert.equal(await vault.read(), secret);
    assert.doesNotMatch(await readFile(join(root, "credentials.dpapi"), "utf8"), /fixture-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
