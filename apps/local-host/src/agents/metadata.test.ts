import assert from "node:assert/strict";
import test from "node:test";
import { parseAgyModels, parseCatalogModels } from "./metadata";

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
