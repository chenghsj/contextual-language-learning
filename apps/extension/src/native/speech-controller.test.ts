import test from "node:test";
import assert from "node:assert/strict";
import type { HostMessage, HostRequest } from "@contextual/core";
import { SpeechController, SPEECH_SEGMENT_PAUSE_MS } from "./speech-controller";

const settings = { rate: 1, voices: {} };
function setup() {
  const sent: HostRequest[] = [];
  let reply!: (message: HostMessage) => void;
  let fail!: (error: Error) => void;
  let closed = false;
  const controller = new SpeechController((onMessage, onError) => {
    reply = onMessage;
    fail = onError;
    return {
      send(request) {
        if (request.type !== "watch") sent.push(request);
      },
      close() {
        closed = true;
      },
    };
  });
  return {
    controller,
    sent,
    reply: (message: HostMessage) => reply(message),
    fail: (error: Error) => fail(error),
    get closed() {
      return closed;
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

async function readySpeech() {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [{ id: "Alex", name: "Alex", language: "en-US", quality: "enhanced" }],
  });
  await listing;
  return env;
}

test("dialogue waits half a second after each completed line, preserving text and one active control", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const env = await readySpeech();
  let prepared = 0;
  try {
    const lines = ["First line.\nStill the first speaker.", " ", "Second line.", "Third line."];
    const speaking = env.controller.speak(
      "dialogue",
      "scene",
      lines.join("\n"),
      "en",
      settings,
      async () => {
        prepared++;
      },
      undefined,
      lines,
    );
    await tick();
    const spoken = () => env.sent.filter(request => request.type === "speak");
    assert.equal(spoken().length, 1);
    assert.equal(spoken()[0].input.text, lines[0]);
    context.mock.timers.tick(5000);
    await tick();
    assert.equal(spoken().length, 1, "the pause cannot start before speech finishes");
    for (let index = 0; index < 2; index++) {
      env.reply({ id: spoken()[index].id, type: "speechFinished", status: "completed" });
      await tick();
      assert.equal(env.controller.snapshot().active?.key, "dialogue");
      context.mock.timers.tick(SPEECH_SEGMENT_PAUSE_MS - 1);
      await tick();
      assert.equal(spoken().length, index + 1);
      context.mock.timers.tick(1);
      await tick();
      assert.equal(spoken().length, index + 2);
    }
    assert.deepEqual(
      spoken().map(request => request.input.text),
      [lines[0], lines[2], lines[3]],
    );
    assert.equal(new Set(spoken().map(request => request.id)).size, 3);
    assert.equal(env.controller.snapshot().active?.id, spoken()[2].id);
    env.reply({ id: spoken()[2].id, type: "speechFinished", status: "completed" });
    await speaking;
    assert.equal(prepared, 1);
    assert.equal(env.controller.snapshot().active, null, "no pause after the final line");
  } finally {
    env.controller.dispose();
  }
});

for (const action of ["stop", "replace", "dispose", "disconnect"] as const) {
  test(`${action} during a dialogue pause prevents remaining lines from starting`, async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const env = await readySpeech();
    try {
      const speaking = env.controller.speak(
        "dialogue",
        "scene",
        "One\nTwo",
        "en",
        settings,
        undefined,
        undefined,
        ["One", "Two"],
      );
      await tick();
      const first = env.sent.at(-1)!;
      env.reply({ id: first.id, type: "speechFinished", status: "completed" });
      await tick();
      let replacement: Promise<void> | undefined;
      if (action === "stop") await env.controller.stop("scene");
      else if (action === "replace") {
        replacement = env.controller.speak("other", "scene", "Other", "en", settings);
        await tick();
        const request = env.sent.at(-1)!;
        assert.equal(request.type, "speak");
        if (request.type === "speak") assert.equal(request.input.text, "Other");
        env.reply({ id: request.id, type: "speechFinished", status: "completed" });
      } else if (action === "dispose") env.controller.dispose();
      else env.fail(new Error("Connection lost"));
      await speaking;
      await replacement;
      context.mock.timers.tick(SPEECH_SEGMENT_PAUSE_MS);
      await tick();
      assert.deepEqual(
        env.sent.filter(request => request.type === "speak").map(request => request.input.text),
        action === "replace" ? ["One", "Other"] : ["One"],
      );
      assert.equal(env.controller.snapshot().active, null);
      if (action === "disconnect") {
        assert.equal(env.controller.snapshot().availability, "unavailable");
        assert.equal(env.controller.snapshot().error, "Connection lost");
      }
    } finally {
      env.controller.dispose();
    }
  });
}

test("stopping a later dialogue line targets its current native request and skips the rest", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const env = await readySpeech();
  try {
    const speaking = env.controller.speak(
      "dialogue",
      "scene",
      "One\nTwo\nThree",
      "en",
      settings,
      undefined,
      undefined,
      ["One", "Two", "Three"],
    );
    await tick();
    const first = env.sent.at(-1)!;
    env.reply({ id: first.id, type: "speechFinished", status: "completed" });
    await tick();
    context.mock.timers.tick(SPEECH_SEGMENT_PAUSE_MS);
    await tick();
    const second = env.sent.at(-1)!;
    assert.equal(second.type, "speak");
    const stopping = env.controller.stop("scene");
    const stop = env.sent.at(-1)!;
    assert.equal(stop.type, "stopSpeech");
    if (stop.type === "stopSpeech") assert.equal(stop.speechId, second.id);
    assert.notEqual(second.id, first.id);
    env.reply({ id: stop.id, type: "speechStopped" });
    env.reply({ id: second.id, type: "speechFinished", status: "stopped" });
    await stopping;
    await speaking;
    context.mock.timers.tick(SPEECH_SEGMENT_PAUSE_MS);
    await tick();
    assert.equal(env.sent.filter(request => request.type === "speak").length, 2);
    assert.equal(env.controller.snapshot().active, null);
  } finally {
    env.controller.dispose();
  }
});
test("voice previews use the exact voice or fail without falling back or changing preferences", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [
      {
        id: "siri:aaron",
        name: "Aaron",
        language: "en-US",
        engine: "siri",
        neural: true,
        installed: true,
      },
      {
        id: "siri:nora",
        aliases: ["siri:nora-old"],
        name: "Nora",
        language: "en-US",
        engine: "siri",
        neural: true,
        installed: true,
      },
    ],
  });
  await listing;
  const preference = { rate: 0.75, voices: { "en-US": "siri:aaron" } };
  const trial = env.controller.speak(
    "nora",
    "manager",
    "Hello",
    "en-US",
    preference,
    undefined,
    "siri:nora-old",
  );
  await tick();
  const request = env.sent.at(-1)!;
  assert.equal(request.type === "speak" && request.input.voiceId, "siri:nora");
  assert.equal(request.type === "speak" && request.input.rate, 0.75);
  env.reply({ id: request.id, type: "speechFinished", status: "completed" });
  await trial;
  const spoken = env.sent.filter(request => request.type === "speak").length;
  await env.controller.speak(
    "missing",
    "manager",
    "Hello",
    "en-US",
    preference,
    undefined,
    "siri:missing",
  );
  assert.equal(env.sent.filter(request => request.type === "speak").length, spoken);
  assert.equal(env.controller.snapshot().errorKind, "voice");
  assert.deepEqual(preference, { rate: 0.75, voices: { "en-US": "siri:aaron" } });
  env.controller.dispose();
});
test("saved public Voice 2 uses Shufen through Siri, with public speech available after Siri disappears", async () => {
  const env = setup();
  const publicId = "com.apple.ttsbundle.gryphon-neural_Shufen_zh-TW_premium";
  const publicVoice = { id: publicId, name: "聲音2", language: "zh-TW", neural: true };
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [
      publicVoice,
      ...["Chenghan", "Shufen"].map(name => ({
        id: `siri:${name.toLowerCase()}`,
        name,
        language: "zh-TW",
        engine: "siri" as const,
        neural: true,
        installed: true,
        resourceId: `com.apple.siri.tts.voice.zh_TW.${name.toLowerCase()}.neural.premium`,
      })),
    ],
  });
  await listing;
  const preference = { rate: 0.75, voices: { "zh-TW": publicId } };
  const first = env.controller.speak("first", "settings", "你好", "zh-TW", preference);
  await tick();
  const request = env.sent.at(-1)!;
  assert.equal(request.type === "speak" && request.input.voiceId, "siri:shufen");
  assert.equal(request.type === "speak" && request.input.rate, 0.75);
  env.reply({ id: request.id, type: "speechFinished", status: "completed" });
  await first;
  const refresh = env.controller.listVoices(true);
  env.reply({ id: env.sent.at(-1)!.id, type: "speechVoices", voices: [publicVoice] });
  await refresh;
  const fallback = env.controller.speak("second", "settings", "你好", "zh-TW", preference);
  await tick();
  const fallbackRequest = env.sent.at(-1)!;
  assert.equal(fallbackRequest.type === "speak" && fallbackRequest.input.voiceId, publicId);
  assert.equal(preference.voices["zh-TW"], publicId);
  env.reply({ id: fallbackRequest.id, type: "speechFinished", status: "completed" });
  await fallback;
  env.controller.dispose();
});

test("a saved Siri alias resolves to its resource instead of the first automatic voice", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [
      { id: "catherine", name: "Catherine", language: "en-AU", neural: true },
      {
        id: "siri:aaron",
        name: "Aaron",
        language: "en-US",
        engine: "siri",
        technology: "natural",
        resourceId: "aaron-resource",
        aliases: ["siri:aaron-old"],
        neural: true,
      },
    ],
  });
  await listing;
  const speaking = env.controller.speak("test", "settings", "Hello", "en", {
    rate: 0.75,
    voices: { en: "siri:aaron-old" },
  });
  await tick();
  const request = env.sent.at(-1)!;
  assert.equal(request.type === "speak" && request.input.voiceId, "siri:aaron");
  env.reply({ id: request.id, type: "speechFinished", status: "completed" });
  await speaking;
  env.controller.dispose();
});
test("unsupported platforms, missing voices and service failures remain distinct and recoverable", async () => {
  const env = setup();
  const unsupported = env.controller.listVoices();
  env.reply({ id: env.sent.at(-1)!.id, type: "speechVoices", voices: [], supported: false });
  await unsupported;
  assert.equal(env.controller.snapshot().availability, "unsupported");
  const refresh = env.controller.listVoices(true);
  env.reply({ id: env.sent.at(-1)!.id, type: "speechVoices", voices: [], supported: true });
  await refresh;
  assert.equal(env.controller.snapshot().availability, "ready");
  const failed = env.controller.listVoices(true);
  env.reply({ id: env.sent.at(-1)!.id, type: "error", message: "Service unavailable" });
  await assert.rejects(failed);
  assert.equal(env.controller.snapshot().availability, "unavailable");
  assert.equal(env.controller.snapshot().voices, null);
  const retry = env.controller.listVoices(true);
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [{ id: "good", name: "Good", language: "en-US", neural: true }],
  });
  await retry;
  assert.equal(env.controller.snapshot().availability, "ready");
  assert.equal(env.controller.snapshot().error, null);
  env.controller.dispose();
});
test("a playback failure does not disable available voices", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoices",
    voices: [{ id: "good", name: "Good", language: "en-US", neural: true }],
  });
  await listing;
  const speaking = env.controller.speak("line", "scene", "Hello", "en", settings);
  await tick();
  env.reply({ id: env.sent.at(-1)!.id, type: "error", message: "Audio output failed" });
  await speaking;
  assert.equal(env.controller.snapshot().availability, "ready");
  assert.equal(env.controller.snapshot().voices?.length, 1);
  assert.equal(env.controller.snapshot().errorKind, "service");
  env.controller.dispose();
});
test("resource folder acknowledgements must match the selected voice", async () => {
  const env = setup();
  const lookup = env.controller.voiceFolder("siri:aaron");
  assert.equal(env.sent.at(-1)!.type, "getSpeechVoiceFolder");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceFolder",
    voiceId: "siri:wrong",
    directory: "/other",
  });
  await assert.rejects(lookup, /Invalid Siri resource/);
  const lookupRetry = env.controller.voiceFolder("siri:aaron");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceFolder",
    voiceId: "siri:aaron",
    directory: "/aaron.asset",
  });
  assert.equal(await lookupRetry, "/aaron.asset");
  assert.equal(
    env.sent.some(request => request.type === "openSpeechVoiceFolder"),
    false,
  );
  const opening = env.controller.openVoiceFolder("siri:aaron");
  assert.equal(env.sent.at(-1)!.type, "openSpeechVoiceFolder");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceFolderOpened",
    voiceId: "siri:wrong",
    directory: "/other",
  });
  await assert.rejects(opening, /Invalid Siri resource/);
  const retry = env.controller.openVoiceFolder("siri:aaron");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceFolderOpened",
    voiceId: "siri:aaron",
    directory: "/aaron.asset",
  });
  assert.equal(await retry, "/aaron.asset");
  env.controller.dispose();
});
test("confirmed removal clears a voice listing that started before deletion", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  const listId = env.sent.at(-1)!.id;
  const removal = env.controller.removeVoice("siri:aaron");
  await tick();
  env.reply({ id: env.sent.at(-1)!.id, type: "speechVoiceRemoved", voiceId: "siri:aaron" });
  env.reply({
    id: listId,
    type: "speechVoices",
    voices: [{ id: "siri:aaron", name: "Aaron", language: "en-US", neural: true }],
  });
  await listing;
  await removal;
  assert.equal(env.controller.snapshot().voices, null);
  env.controller.dispose();
});
test("Siri catalog and download responses remain separate from cached playable voices", async () => {
  const env = setup();
  const catalog = env.controller.listVoiceCatalog();
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceCatalog",
    catalog: {
      available: true,
      voices: [
        {
          id: "siri:test",
          name: "Voice",
          language: "en-US",
          engine: "siri",
          neural: true,
          installed: false,
        },
      ],
    },
  });
  assert.equal((await catalog).voices[0].installed, false);
  assert.equal(env.controller.snapshot().voices, null);
  const download = env.controller.installVoice("siri:test");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceInstallation",
    installation: { voiceId: "siri:test", status: "requested" },
  });
  assert.equal((await download).status, "requested");
  const status = env.controller.voiceInstallation("siri:test");
  env.reply({
    id: env.sent.at(-1)!.id,
    type: "speechVoiceInstallation",
    installation: { voiceId: "wrong", status: "installed" },
  });
  await assert.rejects(status, /Invalid Siri/);
  env.controller.dispose();
});
test("basic-only languages never speak or pause video, even with a saved basic voice", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [
      { id: "basic", name: "Samantha", language: "en-US", quality: "default" },
      { id: "unknown", name: "Unknown", language: "en-US" },
    ],
  });
  await listing;
  let prepared = false;
  const savedVoices: Record<string, string>[] = [{}, { en: "basic" }];
  for (const voices of savedVoices) {
    await env.controller.speak("line", "scene", "Hello", "en", { rate: 1, voices }, async () => {
      prepared = true;
    });
    assert.equal(env.controller.snapshot().errorKind, "voice");
    assert.equal(env.controller.snapshot().active, null);
  }
  assert.equal(prepared, false);
  assert.equal(
    env.sent.some(request => request.type === "speak"),
    false,
  );
  env.controller.dispose();
});
test("automatic and obsolete saved voices choose neural; a valid explicit voice stays selected", async () => {
  const env = setup();
  const listing = env.controller.listVoices();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [
      { id: "compact", name: "Kyoko", language: "ja-JP", quality: "default" },
      { id: "enhanced", name: "Enhanced", language: "ja-JP", quality: "enhanced" },
      { id: "neural", name: "Voice 2", language: "ja-JP", quality: "enhanced", neural: true },
    ],
  });
  await listing;
  for (const [saved, expected] of [
    [undefined, "neural"],
    ["Kyoko", "neural"],
    ["compact", "neural"],
    ["enhanced", "enhanced"],
  ]) {
    const speaking = env.controller.speak("line", "scene", "こんにちは", "ja", {
      rate: 1,
      voices: saved ? { ja: saved } : {},
    });
    await tick();
    const request = env.sent.at(-1)!;
    assert.equal(request.type, "speak");
    if (request.type === "speak") assert.equal(request.input.voiceId, expected);
    env.reply({ id: request.id, type: "speechFinished", status: "completed" });
    await speaking;
  }
  env.controller.dispose();
});
test("leaving a scene while replacement waits for stop acknowledgement cancels the pending intent", async () => {
  const env = setup();
  const first = env.controller.speak("one", "scene", "One", "en", settings);
  await tick();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [{ id: "Alex", name: "Alex", language: "en-US", quality: "enhanced" }],
  });
  await tick();
  const firstRequest = env.sent.at(-1)!;
  const replacement = env.controller.speak("two", "scene", "Two", "en", settings);
  await tick();
  const stop = env.sent.at(-1)!;
  await env.controller.stop("scene");
  env.reply({ id: stop.id, type: "speechStopped" });
  env.reply({ id: firstRequest.id, type: "speechFinished", status: "stopped" });
  await first;
  await replacement;
  assert.equal(env.sent.filter(request => request.type === "speak").length, 1);
  assert.equal(env.controller.snapshot().active, null);
  env.controller.dispose();
});
test("rapid requests during voice loading speak only the latest request; no wrong-language fallback", async () => {
  const env = setup();
  const first = env.controller.speak("first", "scene", "first", "ja", settings);
  await tick();
  const second = env.controller.speak("second", "scene", "second", "ja", settings);
  await tick();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [{ id: "Kyoko", name: "Kyoko", language: "ja-JP", quality: "enhanced" }],
  });
  await first;
  await tick();
  const spoken = env.sent.filter(request => request.type === "speak");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].input.text, "second");
  env.reply({ id: spoken[0].id, type: "speechFinished", status: "completed" });
  await second;
  await env.controller.speak("en", "scene", "English", "en", settings);
  assert.equal(env.sent.filter(request => request.type === "speak").length, 1);
  assert.match(env.controller.snapshot().error!, /No high-quality system voice/);
  env.controller.dispose();
});
test("cancellation while pausing the video prevents a stale speech from starting", async () => {
  const env = setup();
  let resume!: () => void;
  let prepared = false;
  const speaking = env.controller.speak("line", "scene", "Hello", "en", settings, () => {
    prepared = true;
    return new Promise(resolve => {
      resume = resolve;
    });
  });
  await tick();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [{ id: "Alex", name: "Alex", language: "en-US", quality: "enhanced" }],
  });
  await tick();
  assert.ok(prepared);
  await env.controller.stop("scene");
  resume();
  await speaking;
  assert.equal(
    env.sent.some(request => request.type === "speak"),
    false,
  );
  env.controller.dispose();
});
test("replacement targets old speech; an older stop acknowledgement cannot resurrect it", async () => {
  const env = setup();
  const first = env.controller.speak("one", "scene", "One", "en", settings);
  await tick();
  env.reply({
    id: env.sent[0].id,
    type: "speechVoices",
    voices: [{ id: "Alex", name: "Alex", language: "en-US", quality: "enhanced" }],
  });
  await tick();
  const firstRequest = env.sent.at(-1)!;
  const second = env.controller.speak("two", "scene", "Two", "en", settings);
  await tick();
  const stopping = env.sent.at(-1)!;
  assert.equal(stopping.type, "stopSpeech");
  const third = env.controller.speak("three", "scene", "Three", "en", settings);
  await tick();
  const latest = env.sent.at(-1)!;
  assert.equal(latest.type, "speak");
  env.reply({ id: stopping.id, type: "speechStopped" });
  env.reply({ id: firstRequest.id, type: "speechFinished", status: "stopped" });
  await second;
  await first;
  assert.equal(env.controller.snapshot().active?.key, "three");
  assert.equal(env.sent.filter(request => request.type === "speak").length, 2);
  env.reply({ id: latest.id, type: "speechFinished", status: "completed" });
  await third;
  env.controller.dispose();
  assert.ok(env.closed);
});
