import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { HostRequestSchema } from "./protocol-schema";
import { HostMessageSchema } from "./native-messaging";
import { SpeechDownloadTaskSchema, speechDownloadMatchesVoice } from "./speech-downloads";

test("download IPC rejects malformed operation identities and oversized batches", () => {
  const operation = { operationId: randomUUID(), voiceId: "siri:axel" };
  assert.equal(
    HostRequestSchema.safeParse({ id: randomUUID(), type: "cancelSpeechDownload", ...operation })
      .success,
    true,
  );
  assert.equal(
    HostRequestSchema.safeParse({
      id: randomUUID(),
      type: "cancelSpeechDownload",
      ...operation,
      operationId: "../shared-client",
    }).success,
    false,
  );
  assert.equal(
    HostRequestSchema.safeParse({
      id: randomUUID(),
      type: "inspectSpeechDownloads",
      operations: Array.from({ length: 33 }, () => operation),
    }).success,
    false,
  );
  assert.equal(
    HostMessageSchema.safeParse({
      id: randomUUID(),
      type: "speechDownloadObservations",
      observations: [
        {
          ...operation,
          resource: "absent",
          subscription: "absent",
          cancelFenced: true,
          shared: false,
        },
      ],
    }).success,
    false,
  );
});

test("download matching uses native identity evidence and never the displayed voice name", () => {
  const now = new Date().toISOString();
  const voice = {
    id: "siri:axel",
    name: "Axel",
    language: "sv-SE",
    resourceId: "resource.axel",
    aliases: ["siri:legacy-axel"],
  };
  const task = SpeechDownloadTaskSchema.parse({
    id: randomUUID(),
    voice,
    createdAt: now,
    updatedAt: now,
    progress: { status: "waiting-system" },
    observation: { kind: "reconciling" },
  });
  assert.equal(
    speechDownloadMatchesVoice(task, {
      ...voice,
      id: "siri:legacy-axel",
      resourceId: undefined,
      aliases: undefined,
    }),
    true,
  );
  assert.equal(
    speechDownloadMatchesVoice(task, { ...voice, id: "siri:other", aliases: undefined }),
    true,
  );
  assert.equal(
    speechDownloadMatchesVoice(task, {
      ...voice,
      id: "siri:other",
      resourceId: undefined,
      aliases: undefined,
    }),
    false,
  );
  assert.equal(
    speechDownloadMatchesVoice(task, {
      ...voice,
      id: "siri:other",
      language: "en-US",
      aliases: undefined,
    }),
    false,
  );
});
