import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const host = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/native-host.mjs");
const child = spawn(process.execPath, [host], { stdio: ["pipe", "pipe", "pipe"] });
const id = randomUUID();
const body = Buffer.from(JSON.stringify({ type: "health", id }));
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length);
let output = Buffer.alloc(0);
let stderr = "";

child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
const timeout = setTimeout(() => {
  child.kill();
  process.stderr.write("Native Host smoke test timed out: " + stderr + "\n");
  process.exitCode = 1;
}, 10_000);

child.stdout.on("data", chunk => {
  output = Buffer.concat([output, chunk]);
  if (output.length < 4) return;
  const length = output.readUInt32LE(0);
  if (output.length < length + 4) return;
  clearTimeout(timeout);
  try {
    const response = JSON.parse(output.subarray(4, length + 4).toString("utf8"));
    assert.equal(response.id, id);
    assert.equal(response.type, "health");
    for (const agent of ["claude", "codex", "agy"]) assert.equal(typeof response.installed[agent], "boolean");
    process.stdout.write("Native Host health response OK\n");
  } catch (error) {
    process.stderr.write(String(error) + "\n" + stderr + "\n");
    process.exitCode = 1;
  } finally {
    child.kill();
  }
});
child.stdin.end(Buffer.concat([header, body]));
child.on("error", error => {
  clearTimeout(timeout);
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
