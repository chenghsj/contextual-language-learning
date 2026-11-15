import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(app, "../..");
const require = createRequire(path.join(root, "apps/extension/package.json"));
const esbuild = createRequire(require.resolve("vite"))("esbuild");
const temporary = await mkdtemp(path.join(os.tmpdir(), "cll-ios-contract-"));
try {
  const output = path.join(temporary, "contract.js");
  const result = await esbuild.build({
    entryPoints: [path.join(app, "contract/entry.ts")],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    globalName: "CLLContract",
    outfile: output,
    metafile: true,
    minify: true,
    legalComments: "none",
  });
  const inputs = Object.keys(result.metafile.inputs).sort();
  const fingerprint = createHash("sha256");
  for (const input of inputs) {
    const absolute = path.resolve(input);
    fingerprint.update(path.relative(root, absolute).split(path.sep).join("/") + "\0");
    fingerprint.update(await readFile(absolute));
  }
  const bytes = await readFile(output);
  const manifest =
    JSON.stringify(
      {
        contractVersion: 1,
        sourceHash: fingerprint.digest("hex"),
        bundleHash: createHash("sha256").update(bytes).digest("hex"),
        inputs: inputs.map(input =>
          path.relative(root, path.resolve(input)).split(path.sep).join("/"),
        ),
      },
      null,
      2,
    ) + "\n";
  const resource = path.join(app, "ContextualLearning/Resources");
  if (process.argv.includes("--check")) {
    const [stored, storedManifest] = await Promise.all([
      readFile(path.join(resource, "contract.js")),
      readFile(path.join(resource, "contract-manifest.json"), "utf8"),
    ]);
    if (!stored.equals(bytes) || storedManifest !== manifest)
      throw new Error("iOS contract is stale. Run node apps/ios/scripts/build-contract.mjs");
    process.stdout.write("iOS contract matches current authoritative sources.\n");
  } else {
    await mkdir(resource, { recursive: true });
    await writeFile(path.join(resource, "contract.js"), bytes);
    await writeFile(path.join(resource, "contract-manifest.json"), manifest);
    const coreRequire = createRequire(path.join(root, "packages/core/package.json"));
    const zodLicense = await readFile(
      path.join(path.dirname(coreRequire.resolve("zod/package.json")), "LICENSE"),
      "utf8",
    );
    const appRequire = createRequire(path.join(app, "package.json"));
    const urlLicense = await readFile(
      path.join(path.dirname(appRequire.resolve("core-js-pure/package.json")), "LICENSE"),
      "utf8",
    );
    await writeFile(
      path.join(resource, "ThirdPartyNotices.txt"),
      "Bundled lesson contract dependency: Zod\n\n" +
        zodLicense +
        "\n\nBundled lesson contract dependency: core-js-pure\n\n" +
        urlLicense,
    );
    process.stdout.write("Built bundled iOS contract.\n");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
