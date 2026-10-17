import assert from "node:assert/strict";
import test from "node:test";
import {
  HostRequestSchema,
  HostMessageSchema,
  SpeechSettingsSchema,
  speechVoicesForLanguage,
  readAloudVoicesForLanguage,
  subtitleSpeechText,
  downloadableSpeechVoicesForLanguage,
  findSystemVoice,
} from "./index";
import { randomUUID } from "node:crypto";

test("Siri resource identity collapses aliases while preserving unrelated names and voices", () => {
  const resourceId = "com.apple.siri.tts.voice.en_US.aaron.natural.premium";
  const voices = [
    {
      id: "fm-aaron",
      name: "aaron",
      language: "en-US",
      engine: "siri" as const,
      technology: "fmvoice",
      resourceId,
      neural: true,
      installed: true,
    },
    {
      id: "natural-aaron",
      name: "Aaron",
      language: "en-US",
      engine: "siri" as const,
      technology: "natural",
      resourceId,
      neural: true,
      installed: true,
    },
    {
      id: "different",
      name: "Aaron",
      language: "en-US",
      engine: "siri" as const,
      technology: "neural",
      resourceId: "another-resource",
      neural: true,
    },
    {
      id: "public",
      name: "Aaron",
      language: "en-US",
      engine: "av" as const,
      resourceId,
      neural: true,
    },
  ];
  const choices = speechVoicesForLanguage(voices, "en");
  assert.equal(choices.length, 3);
  assert.equal(choices[0].id, "natural-aaron");
  assert.deepEqual((choices[0] as (typeof choices)[0] & { aliases?: string[] }).aliases, [
    "fm-aaron",
  ]);
});

test("reader uses Siri for the requested language and preserves matching public voice preferences", () => {
  const voices = [
    ...["Chenghan", "Shufen"].map(name => ({
      id: `siri:com.apple.speech.synthesis.voice.custom.siri.${name.toLowerCase()}.premium`,
      name,
      language: "zh-TW",
      engine: "siri" as const,
      technology: "neural",
      neural: true,
      installed: true,
      resourceId: `com.apple.siri.tts.voice.zh_TW.${name.toLowerCase()}.neural.premium`,
    })),
    ...["Chenghan", "Shufen"].map((name, index) => ({
      id: `com.apple.ttsbundle.gryphon-neural_${name}_zh-TW_premium`,
      name: `聲音${index + 1}`,
      language: "zh-TW",
      neural: true,
      quality: "enhanced" as const,
    })),
    { id: "cn-public", name: "CN", language: "zh-CN", neural: true },
  ];
  const choices = readAloudVoicesForLanguage(voices, "zh-TW");
  assert.deepEqual(
    choices.map(v => v.name),
    ["Chenghan", "Shufen"],
  );
  for (const name of ["Chenghan", "Shufen"])
    assert.equal(
      findSystemVoice(choices, `com.apple.ttsbundle.gryphon-neural_${name}_zh-TW_premium`)?.name,
      name,
    );
  assert.deepEqual(
    readAloudVoicesForLanguage(voices, "zh-CN").map(v => v.id),
    ["cn-public"],
  );
  assert.equal("aliases" in voices[0], false);
});

test("Siri priority requires an eligible installed voice in the requested language", () => {
  const publicVoice = { id: "public", name: "Public", language: "ja-JP", neural: true };
  for (const siri of [
    { language: "en-US", neural: true, installed: true },
    { language: "ja-JP", neural: true, installed: false },
    { language: "ja-JP", neural: false, quality: "default" as const, installed: true },
  ])
    assert.deepEqual(
      readAloudVoicesForLanguage(
        [publicVoice, { id: "siri:test", name: "Siri", engine: "siri", ...siri }],
        "ja",
      ).map(v => v.id),
      [publicVoice.id],
    );
  assert.deepEqual(
    readAloudVoicesForLanguage(
      [
        { id: "siri:basic", name: "Siri", engine: "siri", language: "ja-JP", installed: true },
        { id: "basic", name: "Basic", language: "ja-JP" },
      ],
      "ja",
    ),
    [],
  );
});

test("public Siri preferences are not mapped by display names or unconfirmed resource identities", () => {
  const id = "com.apple.ttsbundle.gryphon-neural_Shufen_zh-TW_premium";
  const publicVoice = { id, name: "Shufen", language: "zh-TW", neural: true };
  for (const resourceId of [
    undefined,
    "com.apple.siri.tts.voice.zh_TW.shufen.natural.premium",
    "com.apple.siri.tts.voice.zh_CN.shufen.neural.premium",
  ])
    assert.equal(
      findSystemVoice(
        readAloudVoicesForLanguage(
          [
            publicVoice,
            {
              id: "siri:shufen",
              name: "Shufen",
              language: "zh-TW",
              engine: "siri",
              neural: true,
              resourceId,
            },
          ],
          "zh-TW",
        ),
        id,
      ),
      undefined,
    );
});

test("download choices exclude existing resources even when playback discovery misses them", () => {
  const voices = [
    {
      id: "downloaded",
      name: "Catherine",
      language: "en-AU",
      installed: false,
      resourceAvailable: true,
    },
    { id: "ready", name: "Nora", language: "en-US", installed: true, resourceAvailable: true },
    { id: "new", name: "New", language: "en-US", installed: false, resourceAvailable: false },
    { id: "legacy", name: "Legacy", language: "en-US", installed: false },
  ];
  assert.deepEqual(
    downloadableSpeechVoicesForLanguage(voices, "en").map(v => v.id),
    ["new", "legacy"],
  );
});

test("speech protocol bounds text and rate, accepts Japanese, and preserves terminal status", () => {
  const request = {
    id: randomUUID(),
    type: "speak",
    input: { text: "  料理を作りましょう。  ", language: "ja", voiceId: "Kyoko", rate: 1 },
  };
  const parsed = HostRequestSchema.parse(request);
  assert.equal(parsed.type === "speak" && parsed.input.text, "料理を作りましょう。");
  for (const input of [
    { ...request.input, text: " " },
    { ...request.input, text: "x".repeat(6001) },
    { ...request.input, rate: 20 },
    { ...request.input, language: "ja;command" },
  ])
    assert.equal(HostRequestSchema.safeParse({ ...request, input }).success, false);
  assert.equal(
    HostMessageSchema.safeParse({ id: request.id, type: "speechFinished", status: "stopped" })
      .success,
    true,
  );
  assert.deepEqual(SpeechSettingsSchema.parse({}), { rate: 1, voices: {} });
});

test("reader choices keep neural/enhanced/premium and exclude basic or unclassified voices", () => {
  const voices = [
    { id: "old", name: "Old", language: "ja-JP", quality: "default" as const },
    { id: "unknown", name: "Unknown", language: "ja-JP" },
    { id: "enhanced", name: "Enhanced", language: "ja-JP", quality: "enhanced" as const },
    { id: "premium", name: "Premium", language: "ja-JP", quality: "premium" as const },
    { id: "neural", name: "Neural", language: "ja-JP", neural: true },
    { id: "english", name: "English", language: "en-US", neural: true },
  ];
  assert.deepEqual(
    readAloudVoicesForLanguage(voices, "ja").map(v => v.id),
    ["neural", "premium", "enhanced"],
  );
  assert.deepEqual(readAloudVoicesForLanguage(voices.slice(0, 2), "ja"), []);
});

test("explicit Chinese locales select matching regional voices and do not cross-fallback", () => {
  const voices = [
    { id: "tw", name: "Voice 2", language: "zh-TW", neural: true },
    { id: "cn-basic", name: "Tingting", language: "zh-CN", quality: "default" as const },
  ];
  assert.deepEqual(
    readAloudVoicesForLanguage(voices, "zh-TW").map(v => v.id),
    ["tw"],
  );
  assert.deepEqual(readAloudVoicesForLanguage(voices, "zh-CN"), []);
  assert.equal(speechVoicesForLanguage(voices, "zh").length, 2);
});
test("voice selection filters by the spoken language, including regional variants", () => {
  const voices = [
    { id: "one", name: "One", language: "en-US" },
    { id: "two", name: "Two", language: "ja-JP" },
    { id: "three", name: "Three", language: "en-GB" },
  ];
  assert.deepEqual(
    speechVoicesForLanguage(voices, "en").map(voice => voice.id),
    ["one", "three"],
  );
  assert.deepEqual(speechVoicesForLanguage(voices, "ko"), []);
});

test("automatic voice order prefers neural and enhanced voices without mutating the list", () => {
  const voices = [
    {
      id: "com.apple.eloquence.ja-JP.Eddy",
      name: "Eddy",
      language: "ja-JP",
      quality: "default" as const,
    },
    {
      id: "com.apple.voice.compact.ja-JP.Kyoko",
      name: "Kyoko",
      language: "ja-JP",
      quality: "default" as const,
    },
    { id: "premium", name: "Premium", language: "ja-JP", quality: "premium" as const },
    {
      id: "neural",
      name: "Voice 2",
      language: "ja-JP",
      quality: "enhanced" as const,
      neural: true,
    },
    {
      id: "english",
      name: "English",
      language: "en-US",
      quality: "premium" as const,
      neural: true,
    },
  ];
  assert.deepEqual(
    speechVoicesForLanguage(voices, "ja").map(v => v.id),
    ["neural", "premium", voices[1].id, voices[0].id],
  );
  assert.equal(voices[0].name, "Eddy");
  const response = HostMessageSchema.parse({ id: randomUUID(), type: "speechVoices", voices });
  assert.equal(response.type === "speechVoices" && response.voices[3].neural, true);
});

test("subtitle speech marks cue boundaries without changing words, punctuation or cue-internal wraps", () => {
  const lines = ["  急ですが 手島さんの連載スタート", "1か月 早まりました", "早ま…\nえ？"];
  const text = subtitleSpeechText([lines[0], " ", lines[1], "", lines[2]]);
  assert.deepEqual(text.split("\u2029"), lines);
  const parsed = HostRequestSchema.parse({
    id: randomUUID(),
    type: "speak",
    input: { text, language: "ja", voiceId: "Kyoko", rate: 1 },
  });
  assert.equal(parsed.type === "speak" && parsed.input.text, text.trim());
  assert.equal(subtitleSpeechText(["一つだけ。"]), "一つだけ。");
  assert.equal(subtitleSpeechText(["", " "]), "");
});
