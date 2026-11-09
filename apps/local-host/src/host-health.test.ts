import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { HOST_PROTOCOL_VERSION, HostRequestSchema, type HostMessage } from "@contextual/core";
import { handleAgentRequest } from "./host/agents";

test("connection handshake does not read AI credentials; diagnostic health still does", async () => {
  const messages: HostMessage[] = [];
  const deps = { reply: (message: HostMessage) => messages.push(message), hostVersion: "0.1.0" };
  let lookups = 0;
  const catalog = async () => {
    lookups++;
    return [{ id: "openai", label: "OpenAI", installed: true }];
  };
  const id = randomUUID();
  await handleAgentRequest(
    HostRequestSchema.parse({ type: "health", id, includeAgents: false }),
    deps,
    catalog,
  );
  assert.equal(lookups, 0, "library handshakes must not wait for the credential store");
  assert.deepEqual(messages[0], {
    id,
    type: "health",
    agents: [],
    installed: {},
    version: "0.1.0",
    agentMode: "pi-sdk",
    protocolVersion: HOST_PROTOCOL_VERSION,
  });
  await handleAgentRequest(HostRequestSchema.parse({ type: "health", id }), deps, catalog);
  assert.equal(lookups, 1);
  assert.equal(messages[1].type === "health" && messages[1].installed.openai, true);
});
