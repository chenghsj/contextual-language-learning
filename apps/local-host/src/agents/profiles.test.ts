import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appConfigRoot } from "../platform/paths";
import { listAgentProfiles, removeAgentProfile, saveAgentProfile } from "./profiles";

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
    const saved = await saveAgentProfile("codex", "Work", profile);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].directory, await realpath(profile));
    assert.equal(saved[0].label, "Work");
    assert.deepEqual(await listAgentProfiles(), saved);
    await assert.rejects(saveAgentProfile("agy", "Unsupported", profile), /no isolated/);
    await assert.rejects(saveAgentProfile("codex", "Outside", tmpdir()), /home folder/);
    const registry = join(appConfigRoot(), "agent-profiles.json");
    const content = await readFile(registry, "utf8");
    assert.ok(!content.includes("auth.json"));
    if (process.platform !== "win32") assert.equal((await stat(registry)).mode & 0o777, 0o600);
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
