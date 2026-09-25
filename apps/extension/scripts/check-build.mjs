import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const dist = resolve(import.meta.dirname, "../dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
for (const file of ["background.js", "youtube.js", "netflix-page.js", "netflix.js", "sidepanel.html"]) {
  await access(resolve(dist, file));
}
for (const script of manifest.content_scripts) {
  for (const path of script.js) {
    const source = await readFile(resolve(dist, path), "utf8");
    assert.ok(!/^\s*import\s+.*from\s+["']/m.test(source), path + " has an unbundled import");
  }
}
assert.ok(manifest.content_scripts.some(script => script.world === "MAIN" && script.js.includes("netflix-page.js")));
process.stdout.write("Extension manifest and content-script assets OK\n");
