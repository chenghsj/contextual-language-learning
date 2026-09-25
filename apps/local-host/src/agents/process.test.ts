import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { cliInvocation, findExecutable } from "./process";

test("Windows npm shim is resolved to Node entry without a command shell", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-cli-shim-"));
  const originalPath = process.env.PATH;
  try {
    const script = join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    await mkdir(join(root, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    await writeFile(script, "process.stdout.write('safe');\n");
    await writeFile(join(root, "codex.cmd"),
      '@IF EXIST "%~dp0\\node.exe" ( "%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %* ) ELSE ( node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %* )\n');
    process.env.PATH = root + delimiter + (originalPath ?? "");
    const discovered = await findExecutable("codex");
    assert.equal(discovered, script);
    const invocation = cliInvocation(discovered!, ["exec", "a & whoami > exploit.txt"]);
    assert.equal(invocation.executable, process.execPath);
    assert.deepEqual(invocation.argv, [script, "exec", "a & whoami > exploit.txt"]);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});
