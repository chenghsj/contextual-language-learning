import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { agentDisplayName, modelDisplayName } from "./agent-display";
import { messages, type UiLocale } from "./messages";

test("Agent labels come only from imported registry or historical provider IDs", () => {
  assert.equal(agentDisplayName("custom-" + "a".repeat(24), "My CLI"), "My CLI");
  assert.equal(agentDisplayName("legacy-provider", "  "), "legacy-provider");
  assert.equal(agentDisplayName("legacy-provider"), "legacy-provider");
});

test("generation summary displays the selected model label or the honest CLI default", () => {
  const models = [{ id: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" }];
  assert.equal(modelDisplayName("gemini-3.6-flash-high", models, "CLI default"), "Gemini 3.6 Flash (High)");
  assert.equal(modelDisplayName("custom-model-id", models, "CLI default"), "custom-model-id");
  assert.equal(modelDisplayName("", models, "CLI default"), "CLI default");
  assert.equal(modelDisplayName(" ", models, "CLI default"), "CLI default");
});

test("generation screen shows a compact service summary before submitting and links to settings", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const section = app.slice(app.indexOf('<h2>{flow.generate}</h2>'), app.indexOf('<TaskHistory jobs={jobs}'));
  assert.match(section, /<GenerationService locale=\{uiLocale\}/);
  assert.ok(section.includes('setSettingsSection("ai")'));
  assert.ok(section.indexOf('<GenerationService') < section.indexOf('onClick={startGeneration}'));
  // New users select imported Agents; legacy built-in provider IDs are not a picker.
  const imported = await readFile(new URL("../components/pi-settings.tsx", import.meta.url), "utf8");
  assert.match(imported, /onSelect\(provider\.id\)/);
  assert.doesNotMatch(app, /options=\{agentCatalog\.map\(entry =>/);
  const history = await readFile(new URL("../components/task-history.tsx", import.meta.url), "utf8");
  assert.ok(history.includes('agentDisplayName(job.provider, agentCatalog.find(item => item.id === job.provider)?.label)'));
  assert.match(app, /id="agent-settings-heading" tabIndex=\{-1\}/);
});

test("new generation-summary controls are localized in all interface languages", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = messages[locale];
    for (const key of ["generationSummary", "generationAgentLabel", "generationModelLabel", "editAgentModel"] as const) {
      assert.ok(copy[key].trim(), locale + ": " + key);
    }
  }
});

test("SDK settings replace CLI import and profile controls", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /<PiSettings/);
  assert.doesNotMatch(app, /<CustomAgentSettings|useOtherCliAccount/);
});

test("Drive connection verifies actual API access before enabling backup", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const connect = app.slice(app.indexOf("async function connectDrive()"), app.indexOf("async function disconnectDrive"));
  assert.ok(connect.indexOf('type: "driveValidate"') > connect.indexOf('type: "driveConnect"'));
  assert.ok(connect.indexOf('type: "driveValidate"') < connect.indexOf("setBackup({ enabled: true"));
});
