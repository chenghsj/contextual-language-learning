"use strict";
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const test = require("node:test");

const script = join(__dirname, "enforce-pnpm.cjs");

function runWith(agent) {
  const env = { ...process.env };
  if (agent === undefined) delete env.npm_config_user_agent;
  else env.npm_config_user_agent = agent;
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
}

test("pnpm install is allowed", () => {
  const result = runWith("pnpm/9.15.4 npm/? node/v22.20.0 darwin arm64");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});
for (const agent of [
  "npm/10.9.0 node/v22.20.0 darwin arm64",
  "yarn/1.22.22 npm/? node/v22.20.0 darwin arm64",
  "",
  undefined,
]) {
  test("reject non-pnpm install: " + String(agent), () => {
    const result = runWith(agent);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /uses pnpm@9\.15\.4/);
    assert.match(result.stderr, /pnpm install/);
  });
}
