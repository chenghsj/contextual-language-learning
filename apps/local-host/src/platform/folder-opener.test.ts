import assert from "node:assert/strict";
import test from "node:test";
import { openLocalFolder } from "./folder-opener";

for (const [platform, command] of [
  ["darwin", "/usr/bin/open"],
  ["win32", "explorer.exe"],
  ["linux", "xdg-open"],
] as const) {
  test(`${platform} opens the resolved default or selected destination as one literal argument`, async () => {
    const folder =
      platform === "win32" ? "C:\\Lessons\\中文 & notes" : "/Lessons/中文 $(touch nope)";
    for (const directory of [undefined, folder]) {
      let called = false;
      assert.equal(
        await openLocalFolder(
          directory,
          platform,
          async (executable, args) => {
            called = true;
            assert.equal(executable, command);
            assert.deepEqual(args, [folder]);
          },
          async input => {
            assert.equal(input, directory);
            assert.equal(called, false);
            return folder;
          },
        ),
        folder,
      );
      assert.equal(called, true);
    }
  });
}

test("unauthorized folders never launch the file manager; launcher errors reach the caller", async () => {
  await assert.rejects(
    openLocalFolder(
      "/unapproved",
      "darwin",
      async () => assert.fail("must validate before launching"),
      async () => {
        throw new Error("This directory has not been selected using the folder picker");
      },
    ),
    /has not been selected/,
  );
  await assert.rejects(
    openLocalFolder(
      undefined,
      "linux",
      async () => {
        throw new Error("xdg-open unavailable");
      },
      async () => "/default",
    ),
    /xdg-open unavailable/,
  );
});
