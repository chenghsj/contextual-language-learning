import test from "node:test";
import assert from "node:assert/strict";
import { WindowsNarratorBackend, windowsNarratorArgs } from "./windows-narrator";
import { SystemSpeechService, type SpeechRunner } from "./speech";
import { createSpeechHandler } from "../host/speech";
import { HostMessageSchema, type HostMessage } from "@contextual/core";

const voice = {
  id: "narrator:HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech\\Voices\\TokenEnums\\NaturalVoiceEnumerator\\MicrosoftWindows.Voice.ja-JP.Nanami.1",
  name: "Microsoft Nanami (Natural)",
  language: "ja-JP",
  engine: "narrator" as const,
  neural: true as const,
  installed: true as const,
};

test("Windows Narrator accepts only proven local voice metadata, including empty lists and BOM", async () => {
  for (const voices of [[], [voice]]) {
    const backend = new WindowsNarratorBackend(() => ({
      completion: Promise.resolve("\uFEFF" + JSON.stringify(voices)),
      stop() {},
    }));
    assert.deepEqual(await backend.installed(), voices);
  }
  for (const invalid of [
    { ...voice, engine: undefined },
    { ...voice, neural: false },
    { ...voice, installed: false },
    { ...voice, id: "Edge-ja-JP-NanamiNeural" },
  ]) {
    const backend = new WindowsNarratorBackend(() => ({
      completion: Promise.resolve(JSON.stringify([invalid])),
      stop() {},
    }));
    await assert.rejects(backend.installed());
  }
});

test("Narrator script separates local tokens from cloud voices and rechecks the exact token at playback", () => {
  const script = Buffer.from(windowsNarratorArgs.at(-1)!, "base64").toString("utf16le");
  assert.match(script, /NaturalVoiceType'\) -cne 'Narrator;Local'/);
  assert.match(script, /\$id -ceq \[string\]\$inputData.voiceId/);
  assert.match(script, /if \(\$null -eq \$selected\) \{ throw/);
  assert.match(script, /Get-Attribute \$selected 'Locale'/);
  assert.match(script, /\$synth.Voice = \$selected/);
  assert.match(script, /Speak\(\[string\]\$segments\[\$index\], 16\)/);
  assert.match(script, /silence msec="300"/);
  assert.doesNotMatch(script, /Invoke-Expression|SelectVoice|New-Object System.Speech/);
});

test("Windows Host advertises the experiment even without installed voices, while old responses remain valid", async () => {
  const replies: HostMessage[] = [];
  const run: SpeechRunner = () => ({ completion: Promise.resolve("[]"), stop() {} });
  const handler = createSpeechHandler(
    reply => replies.push(reply),
    new SystemSpeechService("win32", run),
  );
  try {
    await handler.handle({ id: crypto.randomUUID(), type: "listSpeechVoices" });
    const parsed = HostMessageSchema.parse(replies[0]);
    assert.equal(parsed.type, "speechVoices");
    if (parsed.type === "speechVoices") {
      assert.equal(parsed.experimentalBackend, "windows-narrator");
      assert.deepEqual(parsed.voices, []);
    }
    assert.ok(
      HostMessageSchema.safeParse({
        id: crypto.randomUUID(),
        type: "speechVoices",
        voices: [],
      }).success,
    );
  } finally {
    handler.close();
  }
});

test("Windows Narrator stops the actual request and never starts a mismatched language", async () => {
  let exit!: (value: string) => void;
  let stopped = false;
  let plays = 0;
  const service = new SystemSpeechService("win32", (_command, _args, stdin) => {
    if (JSON.parse(stdin!).action === "voices")
      return { completion: Promise.resolve(JSON.stringify([voice])), stop() {} };
    plays++;
    return {
      completion: new Promise(resolve => {
        exit = resolve;
      }),
      stop() {
        stopped = true;
        exit("");
      },
    };
  });
  const input = { text: "一緒に学びましょう。", language: "ja", voiceId: voice.id, rate: 1 };
  try {
    await service.listVoices();
    await assert.rejects(service.speak("wrong", { ...input, language: "zh-TW" }), /unavailable/);
    assert.equal(plays, 0);
    const speaking = service.speak("one", input);
    await new Promise(resolve => setImmediate(resolve));
    await service.stop("one");
    assert.equal(stopped, true);
    assert.equal(await speaking, "stopped");
  } finally {
    service.close();
  }
});
