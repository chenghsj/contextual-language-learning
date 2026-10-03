import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserManifestLocation,
  HOST_NAME,
} from "../apps/local-host/scripts/native-host-platform.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const extensionId = "jomemfmpgjbfcdajpkcgicannlehmijm";
const bundle = "// isolated Host bundle fixture\n";

async function fixture(withBundle = true) {
  const directory = await mkdtemp(join(tmpdir(), "cll-host-entrypoints-"));
  const project = join(directory, "project with spaces");
  const home = join(directory, "isolated home");
  const host = join(project, "apps/local-host");
  for (const folder of [join(project, "scripts"), join(host, "scripts"), join(host, "dist"), home])
    await mkdir(folder, { recursive: true });
  for (const file of ["install-host.mjs", "uninstall-host.mjs"]) {
    await copyFile(join(root, "scripts", file), join(project, "scripts", file));
    await copyFile(join(root, "apps/local-host/scripts", file), join(host, "scripts", file));
  }
  await copyFile(
    join(root, "apps/local-host/scripts/native-host-platform.mjs"),
    join(host, "scripts/native-host-platform.mjs"),
  );
  if (withBundle) await writeFile(join(host, "dist/native-host.mjs"), bundle);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
  };
  return { directory, project, home, env };
}

// Windows installation changes HKCU even with a temporary HOME, so never exercise
// its real registration in a test that is intended to remain isolated.
for (const browser of ["chrome", "edge"]) {
  test(
    `the displayed root command installs for ${browser} and can uninstall without touching other browser registrations`,
    { skip: process.platform === "win32" },
    async () => {
      const f = await fixture();
      const selected = browserManifestLocation(process.platform, browser, f.home, f.env).path;
      const other = browserManifestLocation(
        process.platform,
        browser === "edge" ? "chrome" : "edge",
        f.home,
        f.env,
      ).path;
      const lesson = join(f.home, "Documents/Immersive Learning/data-v5/keep.json");
      try {
        await mkdir(join(other, ".."), { recursive: true });
        await writeFile(other, "keep other browser");
        await mkdir(join(lesson, ".."), { recursive: true });
        await writeFile(lesson, "keep lesson");
        const browserArgs = browser === "chrome" ? [] : ["--browser", "edge"];
        const result = await execute(
          process.execPath,
          ["scripts/install-host.mjs", extensionId, ...browserArgs],
          { cwd: f.project, env: f.env },
        );
        assert.match(result.stdout, new RegExp("Native Host for " + browser));
        const manifest = JSON.parse(await readFile(selected, "utf8"));
        assert.equal(manifest.name, HOST_NAME);
        assert.deepEqual(manifest.allowed_origins, ["chrome-extension://" + extensionId + "/"]);
        await access(manifest.path);
        const program = join(manifest.path, "..", "native-host.mjs");
        assert.equal(await readFile(program, "utf8"), bundle);
        assert.equal(await readFile(other, "utf8"), "keep other browser");
        const uninstall = await execute(
          process.execPath,
          ["scripts/uninstall-host.mjs", ...browserArgs],
          { cwd: f.project, env: f.env },
        );
        assert.match(uninstall.stdout, new RegExp("registration for " + browser));
        await assert.rejects(access(selected), { code: "ENOENT" });
        assert.equal(await readFile(other, "utf8"), "keep other browser");
        assert.equal(await readFile(lesson, "utf8"), "keep lesson");
        await access(program);
      } finally {
        await rm(f.directory, { recursive: true, force: true });
      }
    },
  );
}

test(
  "the root entry point explains a missing Host build before writing a registration",
  { skip: process.platform === "win32" },
  async () => {
    const f = await fixture(false);
    try {
      await assert.rejects(
        execute(process.execPath, ["scripts/install-host.mjs", extensionId], {
          cwd: f.project,
          env: f.env,
        }),
        error =>
          error.code === 1 &&
          /Host bundle not found/.test(error.stderr) &&
          /pnpm build/.test(error.stderr),
      );
      await assert.rejects(
        access(browserManifestLocation(process.platform, "chrome", f.home, f.env).path),
        { code: "ENOENT" },
      );
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);
