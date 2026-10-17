import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSiriResourceFolder } from "./siri-resource-folder";

test("resource folders must be complete direct asset children and cannot escape through symlinks", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cll-siri-folder-test-"));
  const root = join(temporary, "purpose_auto");
  const asset = join(root, "valid.asset");
  try {
    await mkdir(join(asset, "AssetData"), { recursive: true });
    await writeFile(join(asset, "Info.plist"), "fixture");
    assert.equal(await validateSiriResourceFolder(asset, root), await realpath(asset));
    await assert.rejects(validateSiriResourceFolder(root, root));
    const incomplete = join(root, "incomplete.asset");
    await mkdir(incomplete);
    await assert.rejects(validateSiriResourceFolder(incomplete, root));
    const external = join(temporary, "external.asset");
    await mkdir(external);
    const link = join(root, "escape.asset");
    await symlink(external, link);
    await assert.rejects(validateSiriResourceFolder(link, root), /Invalid/);
    await rm(join(asset, "AssetData"), { recursive: true });
    await symlink(external, join(asset, "AssetData"));
    await assert.rejects(validateSiriResourceFolder(asset, root), /Invalid/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
