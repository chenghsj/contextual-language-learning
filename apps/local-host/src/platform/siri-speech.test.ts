import test from "node:test";
import assert from "node:assert/strict";
import { SiriSpeechBackend } from "./siri-speech";
import { SystemSpeechService, type SpeechRunner } from "./speech";
import { createSpeechHandler } from "../host/speech";
import { readAloudVoicesForLanguage, HostRequestSchema, HostMessageSchema } from "@contextual/core";

const voice = {
  id: "siri:com.apple.tts.en-US.Aaron",
  name: "Aaron",
  language: "en-US",
  engine: "siri",
  technology: "fmvoice",
  neural: true,
  quality: "premium",
  installed: false,
};
test("Siri catalog normalizes resources and accepts aliases for download checks and removal", async () => {
  const resourceId = "com.apple.siri.tts.voice.en_US.aaron.natural.premium";
  const actions: { action: string; voiceId?: string }[] = [];
  const backend = new SiriSpeechBackend(
    (_command, _args, stdin) => {
      const input = JSON.parse(stdin!);
      actions.push(input);
      return {
        stop() {},
        completion: Promise.resolve(
          JSON.stringify(
            input.action === "catalog"
              ? [
                  {
                    ...voice,
                    resourceId,
                    resourceAvailable: true,
                    installed: true,
                    removable: true,
                  },
                  {
                    ...voice,
                    id: "siri:natural-aaron",
                    technology: "natural",
                    resourceId,
                    resourceAvailable: true,
                    installed: true,
                    removable: true,
                  },
                ]
              : { voiceId: input.voiceId, status: "removed" },
          ),
        ),
      };
    },
    process.execPath,
    () => true,
  );
  const catalog = await backend.catalog();
  assert.equal(catalog.voices.length, 1);
  assert.equal(catalog.voices[0].id, "siri:natural-aaron");
  assert.deepEqual(catalog.voices[0].aliases, [voice.id]);
  assert.deepEqual(await backend.install(voice.id), { voiceId: voice.id, status: "installed" });
  assert.equal(
    actions.some(request => request.action === "install"),
    false,
  );
  await backend.removeResource(voice.id);
  assert.deepEqual(actions.at(-1), { action: "removeResource", voiceId: voice.id });
});
test("Host accepts a saved alias and sends the canonical Siri ID to synthesis", async () => {
  let spokenId = "";
  const canonical = {
    ...voice,
    id: "siri:natural-aaron",
    technology: "natural",
    installed: true,
    aliases: [voice.id],
  };
  const run: SpeechRunner = (command, _args, stdin) => {
    const input = JSON.parse(stdin!);
    if (input.action === "speak") spokenId = input.voiceId;
    return {
      stop() {},
      completion: Promise.resolve(
        input.action === "speak"
          ? ""
          : JSON.stringify(command === process.execPath ? [canonical] : []),
      ),
    };
  };
  const backend = new SiriSpeechBackend(run, process.execPath, () => true);
  const service = new SystemSpeechService(
    "darwin",
    run,
    "/bundle/public",
    async () => null,
    backend,
  );
  assert.equal(
    await service.speak("test", { voiceId: voice.id, language: "en", text: "Hello", rate: 1 }),
    "completed",
  );
  assert.equal(spokenId, canonical.id);
  service.close();
});
test("an existing resource never causes another download subscription", async () => {
  const actions: string[] = [];
  const backend = new SiriSpeechBackend(
    (_command, _args, stdin) => {
      const input = JSON.parse(stdin!);
      actions.push(input.action);
      return {
        stop() {},
        completion: Promise.resolve(
          JSON.stringify(
            input.action === "catalog"
              ? [{ ...voice, resourceAvailable: true }]
              : { status: "requested" },
          ),
        ),
      };
    },
    process.execPath,
    () => true,
  );
  await assert.rejects(backend.install(voice.id), /SIRI_RESOURCE_ALREADY_DOWNLOADED/);
  assert.deepEqual(actions, ["catalog"]);
});
test("resource folder lookup validates the path without opening Finder and opening verifies identity", async () => {
  let opened = "";
  let returnedId = voice.id;
  const directory = "/system-assets/aaron.asset";
  let valid = true;
  const backend = new SiriSpeechBackend(
    (_command, _args, stdin) => {
      assert.deepEqual(JSON.parse(stdin!), { action: "resourceFolder", voiceId: voice.id });
      return {
        stop() {},
        completion: Promise.resolve(JSON.stringify({ voiceId: returnedId, directory })),
      };
    },
    process.execPath,
    () => true,
    async path => {
      opened = path;
      return path;
    },
    async path => {
      assert.equal(path, directory);
      if (!valid) throw new Error("Invalid Siri resource folder.");
      return path;
    },
  );
  const service = new SystemSpeechService("darwin", undefined, undefined, undefined, backend);
  const messages: unknown[] = [];
  const handler = createSpeechHandler(
    message => messages.push(HostMessageSchema.parse(message)),
    service,
  );
  const id = crypto.randomUUID();
  assert.equal(
    await handler.handle(
      HostRequestSchema.parse({ id, type: "getSpeechVoiceFolder", voiceId: voice.id }),
    ),
    true,
  );
  assert.deepEqual(messages, [{ id, type: "speechVoiceFolder", voiceId: voice.id, directory }]);
  assert.equal(opened, "", "lookup must not launch Finder");
  valid = false;
  await assert.rejects(backend.resourceFolder(voice.id), /Invalid Siri resource/);
  await assert.rejects(backend.openResourceFolder(voice.id), /Invalid Siri resource/);
  assert.equal(opened, "", "invalid paths must not launch Finder");
  valid = true;
  assert.equal(await backend.openResourceFolder(voice.id), directory);
  opened = "";
  returnedId = "siri:another";
  await assert.rejects(backend.resourceFolder(voice.id), /Invalid Siri resource/);
  await assert.rejects(backend.openResourceFolder(voice.id), /Invalid Siri resource/);
  assert.equal(opened, "");
  handler.close();
});
test("removal refuses non-removable voices and never treats unconfirmed or mismatched removal as success", async () => {
  let removable = false;
  let returnedId = voice.id;
  let status = "not-removed";
  let requests = 0;
  const backend = new SiriSpeechBackend(
    (_command, _args, stdin) => {
      const input = JSON.parse(stdin!);
      if (input.action === "removeResource") requests++;
      return {
        stop() {},
        completion: Promise.resolve(
          JSON.stringify(
            input.action === "catalog"
              ? [{ ...voice, installed: false, resourceAvailable: true, removable }]
              : { voiceId: returnedId, status },
          ),
        ),
      };
    },
    process.execPath,
    () => true,
  );
  await assert.rejects(backend.removeResource(voice.id), /NOT_REMOVABLE/);
  assert.equal(requests, 0);
  removable = true;
  await assert.rejects(backend.removeResource(voice.id), /NOT_REMOVED/);
  status = "removed";
  returnedId = "siri:another";
  await assert.rejects(backend.removeResource(voice.id), /NOT_REMOVED/);
  returnedId = voice.id;
  await backend.removeResource(voice.id);
});
test("Siri catalog distinguishes downloadable voices from playable ones and rejects legacy premium technologies", async () => {
  const backend = new SiriSpeechBackend(
    () => ({
      completion: Promise.resolve(
        JSON.stringify([voice, { ...voice, id: "legacy", technology: "vocalizer" }]),
      ),
      stop() {},
    }),
    process.execPath,
    () => true,
  );
  const catalog = await backend.catalog();
  assert.equal(catalog.available, true);
  assert.equal(catalog.voices.length, 1);
  assert.deepEqual(readAloudVoicesForLanguage(catalog.voices, "en"), []);
  assert.deepEqual(await backend.installed(), []);
});
test("download acknowledgement is not installation; status checks preserve the selected identity", async () => {
  const actions: unknown[] = [];
  const backend = new SiriSpeechBackend(
    (_command, _args, stdin) => {
      const input = JSON.parse(stdin!);
      actions.push(input);
      return {
        stop() {},
        completion: Promise.resolve(
          JSON.stringify(
            input.action === "catalog"
              ? [voice]
              : input.action === "install"
                ? { status: "requested" }
                : { ...voice, installed: true },
          ),
        ),
      };
    },
    process.execPath,
    () => true,
  );
  assert.equal((await backend.install(voice.id)).status, "requested");
  assert.equal((await backend.status(voice.id)).status, "installed");
  assert.deepEqual(actions, [
    { action: "catalog" },
    { action: "install", voiceId: voice.id },
    { action: "status", voiceId: voice.id },
  ]);
  await assert.rejects(backend.install("unknown"), /unavailable/);
});
test("download rejection is never acknowledged as requested and preserves bounded diagnostic identifiers", async () => {
  for (const [reason, expected] of [
    ["missing-client-identity", "SIRI_DOWNLOAD_MISSING_CLIENT_IDENTITY"],
    ["request-timed-out", "SIRI_DOWNLOAD_REQUEST_TIMED_OUT"],
    ["download-rejected", "SIRI_DOWNLOAD_REJECTED"],
  ]) {
    const backend = new SiriSpeechBackend(
      (_command, _args, stdin) => ({
        stop() {},
        completion: Promise.resolve(
          JSON.stringify(
            JSON.parse(stdin!).action === "catalog"
              ? [voice]
              : { status: "rejected", reason, domain: "SiriTTSService.TTSError", code: 1 },
          ),
        ),
      }),
      process.execPath,
      () => true,
    );
    await assert.rejects(
      backend.install(voice.id),
      error =>
        error instanceof Error && error.message === expected + " (SiriTTSService.TTSError:1)",
    );
  }
});
test("private service or ABI failure leaves the public speech backend available", async () => {
  const backend = new SiriSpeechBackend(
    () => ({
      completion: Promise.reject(new Error("ABI incompatible")),
      stop() {},
    }),
    process.execPath,
    () => true,
  );
  assert.deepEqual(await backend.catalog(), { available: false, voices: [] });
  const run: SpeechRunner = () => ({
    completion: Promise.resolve(
      JSON.stringify([{ id: "av", name: "Voice", language: "en-US", quality: "enhanced" }]),
    ),
    stop() {},
  });
  const service = new SystemSpeechService(
    "darwin",
    run,
    "/bundle/macos-speech",
    async () => null,
    backend,
  );
  assert.equal((await service.listVoices())[0].id, "av");
  service.close();
});
test("installed Siri voice routes to its own helper; cancellation stops the correct process", async () => {
  const calls: { command: string; input: object }[] = [];
  let finish!: (value: string) => void;
  let stopped = false;
  const run: SpeechRunner = (command, _args, stdin) => {
    const input = JSON.parse(stdin!);
    calls.push({ command, input });
    if (input.action === "speak")
      return {
        completion: new Promise(resolve => {
          finish = resolve;
        }),
        stop() {
          stopped = true;
          finish("");
        },
      };
    return {
      stop() {},
      completion: Promise.resolve(
        JSON.stringify(command === process.execPath ? [{ ...voice, installed: true }] : []),
      ),
    };
  };
  const backend = new SiriSpeechBackend(run, process.execPath, () => true);
  const service = new SystemSpeechService(
    "darwin",
    run,
    "/bundle/macos-speech",
    async () => null,
    backend,
  );
  await service.listVoices();
  const text = "literal '$()' <speak>Hello</speak>";
  const speaking = service.speak("request", { voiceId: voice.id, language: "en", rate: 1, text });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), {
    command: process.execPath,
    input: { action: "speak", voiceId: voice.id, text, rate: 1 },
  });
  await service.stop("request");
  assert.equal(await speaking, "stopped");
  assert.equal(stopped, true);
  service.close();
});
test("Siri protocol validates catalog metadata and install request bounds", () => {
  const id = crypto.randomUUID();
  assert.equal(
    HostRequestSchema.parse({ id, type: "installSpeechVoice", voiceId: voice.id }).type,
    "installSpeechVoice",
  );
  assert.equal(
    HostRequestSchema.safeParse({ id, type: "installSpeechVoice", voiceId: "" }).success,
    false,
  );
  assert.equal(
    HostMessageSchema.parse({
      id,
      type: "speechVoiceCatalog",
      catalog: { available: true, voices: [voice] },
    }).type,
    "speechVoiceCatalog",
  );
  assert.equal(
    HostMessageSchema.safeParse({
      id,
      type: "speechVoiceInstallation",
      installation: { voiceId: voice.id, status: "downloaded" },
    }).success,
    false,
  );
});
