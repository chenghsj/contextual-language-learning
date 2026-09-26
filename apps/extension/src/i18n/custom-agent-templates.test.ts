import assert from "node:assert/strict";
import test from "node:test";
import { CustomAgentDefinitionSchema } from "@immersive/core";
import { CUSTOM_AGENT_TEMPLATES } from "../custom-agent-templates";

test("starter Agent templates are valid saved definitions and never contain shell commands", () => {
  assert.ok(CUSTOM_AGENT_TEMPLATES.length >= 1);
  for (const template of CUSTOM_AGENT_TEMPLATES) {
    assert.equal(CustomAgentDefinitionSchema.safeParse(template.definition).success, true);
    assert.ok(template.definition.id.startsWith("custom-"));
    assert.ok(!template.definition.args.some(arg => /bash\s+-c|cmd\s+\/c|powershell\s+-command/i.test(arg)));
  }
  const gemini = CUSTOM_AGENT_TEMPLATES.find(item => item.id === "gemini")!.definition;
  assert.deepEqual(gemini.args, ["-p", "{prompt}", "--output-format", "json"]);
  assert.equal(gemini.responsePath, "response");
  assert.equal(gemini.modelArgument, "--model");
});
