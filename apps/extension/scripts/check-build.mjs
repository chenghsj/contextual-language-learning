import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const dist = resolve(import.meta.dirname, "../dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.name, "__MSG_extensionName__");
assert.equal(manifest.description, "__MSG_extensionDescription__");
assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
for (const locale of ["en", "zh_TW", "zh_CN", "ja", "ko"]) {
  const path = resolve(dist, "_locales", locale, "messages.json");
  const catalog = JSON.parse(await readFile(path, "utf8"));
  for (const key of ["extensionName", "extensionDescription", "actionTitle"]) {
    assert.equal(typeof catalog[key]?.message, "string", locale + "/" + key);
    assert.ok(catalog[key].message.trim(), locale + "/" + key + " is empty");
  }
}
for (const file of ["background.js", "youtube.js", "youtube-page.js", "netflix-page.js", "netflix.js", "sidepanel.html"]) {
  await access(resolve(dist, file));
}
for (const script of manifest.content_scripts) {
  for (const path of script.js) {
    const source = await readFile(resolve(dist, path), "utf8");
    assert.ok(!/^\s*import\s+.*from\s+["']/m.test(source), path + " has an unbundled import");
  }
}
assert.ok(manifest.content_scripts.some(script => script.world === "MAIN" && script.js.includes("netflix-page.js")));
assert.ok(manifest.content_scripts.some(script => script.world === "MAIN" && script.js.includes("youtube-page.js")));
process.stdout.write("Extension manifest and content-script assets OK\n");
