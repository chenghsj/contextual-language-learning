import { readFile, access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { Script } from "node:vm";

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
    // Content scripts, including MAIN-world page bridges, are loaded as classic
    // scripts by the Manifest. A shared Rollup chunk leaves `import{...}`
    // in minified entrypoints; the former regex missed this exact failure.
    // Parse the actual compiled bytes as a classic script, not as a module.
    assert.doesNotThrow(() => new Script(source, { filename: path }),
      path + " must be standalone classic JavaScript; check for ESM imports/exports");
    assert.ok(!/\bimport\s*\(/.test(source),
      path + " must not load dynamic modules in a content script");

  }
}
assert.ok(manifest.content_scripts.some(script => script.world === "MAIN" && script.js.includes("netflix-page.js")));
assert.ok(manifest.content_scripts.some(script => script.world === "MAIN" && script.js.includes("youtube-page.js")));
// Tailwind v4 must discover the static utility groups in utility-classes.ts.
const styles = (await readdir(resolve(dist, "assets"))).filter(name => name.endsWith(".css"));
assert.ok(styles.length > 0, "the packaged Side Panel must include compiled CSS");
const compiledCss = (await Promise.all(styles.map(name =>
  readFile(resolve(dist, "assets", name), "utf8")
))).join("\n");
for (const selector of [".grid-cols-4", ".sticky", ".bg-card", ".text-muted-foreground"]) {
  assert.ok(compiledCss.includes(selector), "missing packaged Tailwind utility " + selector);
}
assert.ok(compiledCss.includes("355px"), "narrow-width contextual reader utilities were not compiled");
assert.ok(compiledCss.includes("group-aria-checked"), "Drive backup switch state utility was not compiled");
process.stdout.write("Extension manifest and content-script assets OK\n");
