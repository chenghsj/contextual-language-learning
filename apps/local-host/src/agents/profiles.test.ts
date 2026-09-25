import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentProfiles, removeAgentProfile, saveAgentProfile } from "./profiles";

test("named CLI account profiles save paths only, enforce home containment and never delete login data", async () => {
  const home = await mkdtemp(join(tmpdir(), "immersive-profiles-"));
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const profile = join(home, ".codex-work");
    await mkdir(profile);
    const saved = await saveAgentProfile("codex", "Work", profile);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].directory, profile);
    assert.equal(saved[0].label, "Work");
    assert.deepEqual(await listAgentProfiles(), saved);
    await assert.rejects(saveAgentProfile("agy", "Unsupported", profile), /no isolated/);
    await assert.rejects(saveAgentProfile("codex", "Outside", "/tmp"), /home folder/);
    const registry = join(home, "Library/Application Support/Immersive Learning/agent-profiles.json");
    const content = await readFile(registry, "utf8");
    assert.ok(!content.includes("auth.json"));
    assert.equal((await stat(registry)).mode & 0o777, 0o600);
    assert.deepEqual(await removeAgentProfile(saved[0].id), []);
    assert.equal((await stat(profile)).isDirectory(), true);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
