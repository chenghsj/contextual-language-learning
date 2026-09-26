import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { agentDisplayName, modelDisplayName } from "./agent-display";
import { messages, type UiLocale } from "./messages";

test("UI uses product names, not internal provider IDs, without changing CLI selection", () => {
  assert.equal(agentDisplayName("claude", "Claude Code"), "Claude Code");
  assert.equal(agentDisplayName("codex", "Codex"), "Codex CLI");
  assert.equal(agentDisplayName("agy", "AGY"), "Antigravity CLI (agy)");
  assert.equal(agentDisplayName("other", "Another CLI"), "Another CLI");
  assert.equal(agentDisplayName("other"), "other");
});

test("generation summary displays the selected model label or the honest CLI default", () => {
  const models = [{ id: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" }];
  assert.equal(modelDisplayName("gemini-3.6-flash-high", models, "CLI default"), "Gemini 3.6 Flash (High)");
  assert.equal(modelDisplayName("custom-model-id", models, "CLI default"), "custom-model-id");
  assert.equal(modelDisplayName("", models, "CLI default"), "CLI default");
  assert.equal(modelDisplayName(" ", models, "CLI default"), "CLI default");
});

test("generation card shows Agent and model before submitting and links directly to Agent settings", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const section = app.slice(app.indexOf('<h2>{t("generationHeading")}</h2>'), app.indexOf('<h2>{t("jobHistory")}</h2>'));
  assert.ok(section.includes('className="generationSummary"'));
  assert.ok(section.includes('agentDisplayName(agent.provider, selectedAgentInfo?.label)'));
  assert.ok(section.includes('modelDisplayName(agent.modelId, modelOptions, t("cliDefault"))'));
  assert.ok(section.includes('onClick={() => {') && section.includes('setPage("settings")'));
  assert.ok(section.includes('getElementById("agent-settings-heading")'));
  assert.ok(section.indexOf('className="generationSummary"') < section.indexOf('onClick={startGeneration}'));
  assert.ok(app.includes('agentDisplayName(entry.id, entry.label)'));
  assert.ok(app.includes('agentDisplayName(job.provider, agentCatalog.find(item => item.id === job.provider)?.label)'));
  assert.match(app, /id="agent-settings-heading" tabIndex=\{-1\}/);
});

test("new generation-summary controls are localized in all interface languages", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = messages[locale];
    for (const key of ["generationSummary", "generationAgentLabel", "generationModelLabel", "editAgentModel"] as const) {
      assert.ok(copy[key].trim(), locale + ": " + key);
    }
    assert.ok(copy.agentProfileUnsupported.includes("Antigravity CLI (agy)"), locale);
  }
});

test("Agent and optional CLI Profile share one persisted model setting", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /agentModelPreferences/);
  assert.match(app, /savedAgentModel\(agent.provider, entry\?\.directory, agentModelPreferences\)/);
  assert.match(app, /<SettingInfo label=\{t\("useOtherCliAccount"\)\}/);
  assert.match(app, /<details className="agentProfileAdvanced">/);
  assert.match(app, /agent.accountConfigDir && <div><dt>\{t\("agentAccount"\)\}/);
});

test("Drive connection verifies actual API access before enabling backup", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const connect = app.slice(app.indexOf("async function connectDrive()"), app.indexOf("async function disconnectDrive"));
  assert.ok(connect.indexOf('type: "driveValidate"') > connect.indexOf('type: "driveConnect"'));
  assert.ok(connect.indexOf('type: "driveValidate"') < connect.indexOf("setBackup({ enabled: true"));
});
