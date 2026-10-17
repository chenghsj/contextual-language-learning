import assert from "node:assert/strict";
import test from "node:test";
import { pickFolder } from "./folder-picker";

for (const platform of ["darwin", "win32", "linux"] as const) {
  test(`${platform} empty folder selection is cancellation, not a storage path or system error`, async () => {
    await assert.rejects(
      pickFolder(platform, async () => ({ stdout: "\n" })),
      /^Error: Folder selection cancelled\.$/,
    );
  });
  test(`${platform} explicit cancel stays distinguishable from picker failures`, async () => {
    const cancellation = Object.assign(
      new Error("command failed"),
      platform === "darwin"
        ? { stderr: "User canceled. (-128)" }
        : { code: platform === "win32" ? 2 : 1 },
    );
    await assert.rejects(
      pickFolder(platform, async () => {
        throw cancellation;
      }),
      /^Error: Folder selection cancelled\.$/,
    );
    await assert.rejects(
      pickFolder(platform, async () => {
        throw new Error("timed out");
      }),
      /Could not open/,
    );
  });
  test(`${platform} successful selection returns its path`, async () => {
    assert.equal(
      await pickFolder(platform, async () => ({ stdout: " /chosen-folder\n" })),
      "/chosen-folder",
    );
  });
}

test("Linux falls back only for missing picker tools", async () => {
  const commands: string[] = [];
  assert.equal(
    await pickFolder("linux", async command => {
      commands.push(command);
      if (command === "zenity") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { stdout: "/chosen-folder" };
    }),
    "/chosen-folder",
  );
  assert.deepEqual(commands, ["zenity", "kdialog"]);
});
