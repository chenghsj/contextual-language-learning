import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  HOST_PROTOCOL_VERSION,
  HostMessageSchema,
  isCompatibleHostHealth,
} from "./native-messaging";

test("provider messages preserve the saved authentication method and accept older Hosts", () => {
  const provider = {
    id: "openai",
    label: "OpenAI",
    connected: false,
    methods: ["oauth", "api_key"],
  };
  for (const extra of [
    {},
    { methodLabels: { oauth: "OpenAI (ChatGPT subscription)", api_key: "OpenAI API key" } },
    { connected: true, credentialMethod: "oauth" },
    { connected: true, credentialMethod: "api_key" },
  ]) {
    const message = {
      id: randomUUID(),
      type: "piProviders",
      providers: [{ ...provider, ...extra }],
    };
    assert.deepEqual(HostMessageSchema.parse(message), message);
  }
});

test("V5 Extension accepts only matching Host protocol and Pi SDK mode", () => {
  const health = {
    id: randomUUID(),
    type: "health" as const,
    installed: {},
    agents: [],
    version: "0.1.0",
    agentMode: "pi-sdk" as const,
    protocolVersion: HOST_PROTOCOL_VERSION,
  };
  assert.equal(isCompatibleHostHealth(HostMessageSchema.parse(health)), true);
  assert.equal(
    isCompatibleHostHealth(HostMessageSchema.parse({ ...health, protocolVersion: 1 })),
    false,
  );
  assert.equal(
    isCompatibleHostHealth(HostMessageSchema.parse({ ...health, protocolVersion: undefined })),
    false,
  );
});

test("Native Messaging rejects malformed results before they enter UI state", () => {
  const id = randomUUID();
  assert.equal(
    HostMessageSchema.safeParse({ id, type: "result", document: { schemaVersion: 3 } }).success,
    false,
  );
  assert.equal(
    HostMessageSchema.safeParse({ id, type: "progress", jobId: id, completed: 5, total: -1 })
      .success,
    false,
  );
  assert.equal(
    HostMessageSchema.safeParse({
      id,
      type: "documentChunk",
      documentId: id,
      index: -1,
      total: 2,
      dataBase64: "abc",
    }).success,
    false,
  );
  assert.equal(HostMessageSchema.safeParse({ id, type: "unexpected" }).success, false);
});

test("history deletion messages validate IDs and partial failure results", async () => {
  const { HostRequestSchema } = await import("./protocol-schema");
  const id = randomUUID();
  assert.equal(
    HostRequestSchema.safeParse({ id, type: "deleteJobHistory", jobIds: [] }).success,
    false,
  );
  assert.equal(
    HostRequestSchema.safeParse({ id, type: "deleteJobHistory", jobIds: ["../../file"] }).success,
    false,
  );
  assert.equal(
    HostRequestSchema.safeParse({ id, type: "deleteJobHistory", jobIds: [id] }).success,
    true,
  );
  assert.equal(HostRequestSchema.safeParse({ id, type: "listEndedJobs" }).success, true);
  assert.equal(
    HostMessageSchema.safeParse({ id, type: "jobHistoryDeleted", deleted: [id], failed: [] })
      .success,
    true,
  );
  assert.equal(
    HostMessageSchema.safeParse({
      id,
      type: "jobHistoryDeleted",
      deleted: [],
      failed: [{ jobId: id, message: "Busy" }],
    }).success,
    true,
  );
  assert.equal(
    HostMessageSchema.safeParse({ id, type: "jobHistoryDeleted", deleted: ["invalid"], failed: [] })
      .success,
    false,
  );
});

test("model capabilities survive the Native Messaging boundary", () => {
  const message = {
    id: randomUUID(),
    type: "agentModels",
    source: "sdk",
    models: [
      {
        id: "model",
        label: "Model",
        thinkingLevels: ["low", "high"],
        disabled: true,
        availability: "unknown",
      },
    ],
    warning: "Model catalog refresh failed; existing candidates remain usable",
  };
  const parsed = HostMessageSchema.parse(message);
  assert.equal(parsed.type, "agentModels");
  if (parsed.type === "agentModels") {
    assert.deepEqual(parsed.models[0].thinkingLevels, ["low", "high"]);
    assert.equal(parsed.models[0].disabled, true);
    assert.equal(parsed.models[0].availability, "unknown");
    assert.equal(parsed.warning, message.warning);
  }
  assert.equal(
    HostMessageSchema.safeParse({
      ...message,
      models: [{ id: "model", label: "Model", thinkingLevels: ["invalid"] }],
    }).success,
    false,
  );
});
