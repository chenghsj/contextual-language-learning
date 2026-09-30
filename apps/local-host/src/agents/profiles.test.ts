import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appConfigRoot } from "../platform/paths";
import { listAgentProfiles, removeAgentProfile, removeAgentProfilesByProvider, saveAgentProfile } from "./profiles";
import { saveCustomAgent } from "./custom";

test("named CLI account profiles save paths only, enforce home containment and never delete login data", async () => {
  const home = await mkdtemp(join(tmpdir(), "immersive-profiles-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  if (process.platform === "win32") {
    process.env.USERPROFILE = home;
    process.env.APPDATA = join(home, "AppData", "Roaming");
  }
  if (process.platform === "linux") process.env.XDG_CONFIG_HOME = join(home, ".config");
  try {
    const profile = join(home, ".codex-work");
    await mkdir(profile);
    const provider = "custom-" + "a".repeat(24);
    await saveCustomAgent({ id: provider, label: "My CLI", executable: "my-cli",
      args: ["{prompt}"], promptMode: "argument", outputMode: "stdout-json",
      profileEnvVar: "MY_CLI_CONFIG_DIR" });
    const saved = await saveAgentProfile(provider, "Work", profile);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].directory, await realpath(profile));
    assert.equal(saved[0].label, "Work");
    assert.deepEqual(await listAgentProfiles(), saved);
    await assert.rejects(saveAgentProfile("agy", "Unsupported", profile), /no isolated/);
    await assert.rejects(saveAgentProfile(provider, "Outside", tmpdir()), /home folder/);
    const registry = join(appConfigRoot(), "agent-profiles.json");
    const content = await readFile(registry, "utf8");
    assert.ok(!content.includes("auth.json"));
    if (process.platform !== "win32") assert.equal((await stat(registry)).mode & 0o777, 0o600);
    await writeFile(registry, JSON.stringify([
      ...saved, { id: "83a3cf3b-477c-4efd-bc64-056e3f66c53e", provider: "codex",
        label: "Historical profile", directory: profile },
    ]));
    assert.deepEqual(await listAgentProfiles(), saved, "old built-in profiles must not reappear");
    assert.deepEqual(await removeAgentProfilesByProvider(provider), []);
    assert.deepEqual(await removeAgentProfile(saved[0].id), []);
    assert.equal((await stat(profile)).isDirectory(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
});
