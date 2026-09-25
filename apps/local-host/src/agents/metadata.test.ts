import assert from "node:assert/strict";
import test from "node:test";
import { parseAgyModels, parseCatalogModels, probeCli } from "./metadata";

test("AGY command output becomes a bounded, ID-preserving model picker", () => {
  const output = "slug                        name\n" +
    "gemini-3.5-flash-medium      Gemini 3.5 Flash (Medium)\n" +
    "claude-sonnet-4-6            Claude Sonnet 4.6\n" +
    "\u001b[32mclaude-sonnet-4-6            Duplicate\u001b[0m\n";
  assert.deepEqual(parseAgyModels(output), [
    { id: "gemini-3.5-flash-medium", label: "Gemini 3.5 Flash (Medium)" },
    { id: "claude-sonnet-4-6", label: "Duplicate" },
  ]);
});

test("Codex CLI catalog filters hidden/untrusted entries and never exposes raw instructions", () => {
  const catalog = { models: [
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", visibility: "list", model_messages: { instructions_template: "private" } },
    { slug: "test-hidden", display_name: "Hidden", visibility: "hide" },
    { slug: "--flag", display_name: "Invalid" },
  ] };
  assert.deepEqual(parseCatalogModels(catalog), [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }]);
  assert.deepEqual(parseCatalogModels({ models: "not an array" }), []);
});

test("AGY JSON catalog accepts normal model IDs and rejects executable-like text", () => {
  assert.deepEqual(parseAgyModels(JSON.stringify({ models: [
    { id: "gemini-3.5-pro", name: "Gemini" },
    { id: "../../bin/sh", name: "Invalid" },
  ] })), [{ id: "gemini-3.5-pro", label: "Gemini" }]);
});

test("AGY 1.2.11 models supports nonbreaking spaces and all available model IDs", () => {
  const rows = [
    "gemini-3.8-flash-high     Gemini 3.8 Flash (High)",
    "gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)",
    "gemini-3.8-flash-low      Gemini 3.8 Flash (Low)",
    "gemini-3.7-flash-high     Gemini 3.7 Flash (High)",
    "gemini-3.7-flash-medium   Gemini 3.7 Flash (Medium)",
    "gemini-3.7-flash-low      Gemini 3.7 Flash (Low)",
    "gemini-3.6-flash-high     Gemini 3.6 Flash (High)",
    "gemini-3.6-flash-medium   Gemini 3.6 Flash (Medium)",
    "gemini-3.6-flash-low      Gemini 3.6 Flash (Low)",
    "gemini-3.1-pro-high       Gemini 3.1 Pro (High)",
    "gemini-3.1-pro-low        Gemini 3.1 Pro (Low)",
    "claude-sonnet-4-6        Claude Sonnet 4.6 (Thinking)",
    "claude-opus-4-6-thinking  Claude Opus 4.6 (Thinking)",
    "gpt-oss-120b-medium       GPT-OSS 120B (Medium)"
];
  const terminalOutput = rows.map(row => row.replace(/ {2,}/g, " \u00a0 \u00a0 ")).join("\n\n");
  const models = parseAgyModels(terminalOutput);
  assert.equal(models.length, 14);
  assert.deepEqual(models[0], { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" });
  assert.deepEqual(models[12], { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" });
  assert.deepEqual(models[13], { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" });
});

test("CLI probe captures a model table on stderr", async () => {
  const output = await probeCli(process.execPath, ["-e", "process.stderr.write(\"gemini-3.8-flash-high    Gemini 3.8 Flash (High)\\n\")"], { ...process.env });
  assert.equal(output.stdout, "");
  assert.deepEqual(parseAgyModels(output.stderr), [{
    id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)",
  }]);
});
