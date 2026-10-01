import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AiModelSelection } from "../components/ai-model-selection";
import { restorePiAgentSelection } from "../agent-selection";
import { AgentSettingsSchema, type ThinkingLevel } from "@immersive/core";

const noop = () => undefined;
function picker(levels: ThinkingLevel[], modelId = "model", busy = false) {
  return renderToStaticMarkup(
    <AiModelSelection
      locale="zh-TW"
      id="settings"
      provider="openai"
      modelId={modelId}
      providers={[{ id: "openai", label: "OpenAI", installed: true }]}
      models={[{ id: "model", label: "Model", thinkingLevels: levels }]}
      available
      busy={busy}
      notice=""
      thinkingLevel="high"
      onThinking={noop}
      onProvider={noop}
      onModel={noop}
      onRefresh={noop}
    />,
  );
}
test("reasoning picker uses selected or first available model capabilities", () => {
  assert.match(picker(["low", "high"]), /推理強度/);
  const loading = picker(["low", "high"], "model", true);
  assert.match(loading, /<button(?=[^>]*id="settings-thinking")(?=[^>]*disabled)[^>]*>/);
  assert.match(loading, />高</);
  assert.match(picker(["low", "high"]), />高</);
  assert.match(picker(["low", "high"], ""), /推理強度/);
  assert.doesNotMatch(picker(["off"]), /推理強度/);
  assert.doesNotMatch(picker(["high"], "missing"), /推理強度/);
});
test("reasoning survives storage restoration and request parsing; invalid values are rejected", () => {
  const saved = { provider: "openai", modelId: "model", thinkingLevel: "high" };
  assert.deepEqual(AgentSettingsSchema.parse(restorePiAgentSelection(saved)), saved);
  assert.equal(
    restorePiAgentSelection({ ...saved, thinkingLevel: "invalid" }).thinkingLevel,
    undefined,
  );
  assert.equal(
    AgentSettingsSchema.safeParse({ ...saved, thinkingLevel: "invalid" }).success,
    false,
  );
  assert.equal(
    AgentSettingsSchema.parse({ provider: "openai", modelId: "model" }).thinkingLevel,
    undefined,
  );
});
