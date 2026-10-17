import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateBrandingData, migrateBrandingDirectory } from "./branding-migration";
import { appConfigRoot, defaultDocumentsFolder } from "./paths";

for (const platform of ["darwin", "win32", "linux"] as const) {
  test(`${platform} branding migration keeps credentials and custom documents; leaves retired lessons untouched and does not resurrect deleted content`, () => {
    const home = mkdtempSync(join(tmpdir(), "cll-migration-"));
    try {
      const config = appConfigRoot(platform, {}, home);
      const oldConfig = join(
        config,
        "..",
        platform === "linux" ? "immersive-language-learning" : "Immersive Learning",
      );
      const oldDocuments = join(home, "Documents", "Immersive Learning");
      mkdirSync(join(oldConfig, "pi"), { recursive: true });
      mkdirSync(join(oldConfig, "native-host"));
      mkdirSync(join(oldDocuments, "custom-v1", "documents"), { recursive: true });
      writeFileSync(join(oldConfig, "pi", "auth.json"), "credential fixture", { mode: 0o600 });
      writeFileSync(join(oldDocuments, "custom-v1", "documents", "lesson.json"), "saved lesson");
      writeFileSync(join(oldDocuments, "retired.json"), "retired standard lesson");
      migrateBrandingData(platform, {}, home);
      const document = join(defaultDocumentsFolder(home), "custom-v1", "documents", "lesson.json");
      assert.equal(readFileSync(document, "utf8"), "saved lesson");
      assert.equal(
        readFileSync(join(oldDocuments, "retired.json"), "utf8"),
        "retired standard lesson",
      );
      assert.equal(existsSync(join(defaultDocumentsFolder(home), "retired.json")), false);
      assert.equal(readFileSync(join(config, "pi", "auth.json"), "utf8"), "credential fixture");
      assert.equal(existsSync(join(config, "native-host")), false);
      assert.equal(existsSync(join(oldDocuments, "custom-v1", "documents", "lesson.json")), true);
      rmSync(document);
      migrateBrandingData(platform, {}, home);
      assert.equal(existsSync(document), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test("migration preserves differing files and can retry after a conflict is resolved", () => {
  const home = mkdtempSync(join(tmpdir(), "cll-conflict-"));
  try {
    const old = join(home, "old"),
      current = join(home, "current");
    mkdirSync(old);
    mkdirSync(current);
    writeFileSync(join(old, "auth.json"), "old credentials");
    writeFileSync(join(current, "auth.json"), "new credentials");
    assert.throws(() => migrateBrandingDirectory(old, current), /different files/);
    assert.equal(readFileSync(join(current, "auth.json"), "utf8"), "new credentials");
    assert.equal(readFileSync(join(old, "auth.json"), "utf8"), "old credentials");
    rmSync(join(current, "auth.json"));
    migrateBrandingDirectory(old, current);
    assert.equal(readFileSync(join(current, "auth.json"), "utf8"), "old credentials");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
