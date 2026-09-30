import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { messages } from "./messages";

test("custom Agent UI has the same complete 37-message catalog in five languages", () => {
  const keys = Object.keys(messages.en).filter(key => key.startsWith("customAgent"));
  assert.equal(keys.length, 37);
  for (const locale of ["zh-TW", "zh-CN", "ja", "ko"] as const) {
    for (const key of keys) {
      const copy = messages[locale] as Record<string, string>;
      assert.ok(copy[key]?.length, locale + " missing " + key);
    }
  }
});
test("custom Agent UI requires explicit verification and uses Native Host protocol", async () => {
  const source = await readFile(new URL("../components/custom-agent-settings.tsx", import.meta.url), "utf8");
  for (const name of ["customAgentProbe", "customAgentSave", "customAgentTest", "customAgentRemove"]) {
    assert.ok(source.includes(name), name + " must have a real Host request");
  }
  assert.match(source, /CustomAgentConfigSchema\.safeParse\(config\(\)\)/);
  assert.match(source, /disabled=\{!available \|\| busy\}/);
});
