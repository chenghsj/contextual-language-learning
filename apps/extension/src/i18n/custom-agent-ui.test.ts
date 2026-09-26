import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { messages } from "./messages";

test("custom Agent settings are localized and use argv instead of shell command text", async () => {
  for (const [locale, catalog] of Object.entries(messages)) {
    for (const key of ["customAgents", "customAgentExecutable", "customAgentArgs", "customAgentSecurity"] as const) {
      assert.ok(catalog[key].length > 4, locale + " " + key);
    }
  }
  const source = await readFile(new URL("../components/custom-agent-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /argsText\.split/);
  assert.doesNotMatch(source, /shell|bash -c|cmd \/c/i);
  assert.match(source, /customAgentTest/);
  assert.match(source, /customAgentSave/);
  assert.match(source, /customAgentRemove/);
});
