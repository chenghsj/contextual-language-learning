import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("build injects the package version into the Native Host health response", async () => {
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  const index = await readFile(new URL("index.ts", import.meta.url), "utf8");
  const dispatcher = await readFile(new URL("host/agents.ts", import.meta.url), "utf8");
  const version = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ).version;
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.match(build, /__IMMERSIVE_HOST_VERSION__: JSON\.stringify\(hostVersion\)/);
  assert.match(
    index.replace(/\s+/g, " "),
    /createHostDispatcher\(\{ storage, manager, customManager, reply, hostVersion,? \}\)/,
  );
  assert.match(dispatcher.replace(/\s+/g, " "), /type: "health", agents, version: hostVersion/);
});
