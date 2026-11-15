import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAloudVoicesForLanguage } from "@contextual/core";
import { SystemSpeechService, runSpeechProcess } from "../src/platform/speech";

if (process.platform !== "win32") {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: "Requires Windows and a compatible local Narrator adapter.",
    }),
  );
  process.exit(0);
}
const languageIndex = process.argv.indexOf("--language");
const language = languageIndex < 0 ? "en" : process.argv[languageIndex + 1];
const samples: Record<string, string> = {
  en: "Let's learn something new together.",
  ja: "一緒に新しいことを学びましょう。",
  ko: "함께 새로운 것을 배워 봅시다.",
  "zh-CN": "我们一起学习新的事物吧。",
  "zh-TW": "我們一起學習新的事物吧。",
};
assert.ok(language && samples[language], "--language must be en, ja, ko, zh-CN or zh-TW");
const output = await mkdtemp(join(tmpdir(), "cll-windows-narrator-"));
const path = join(output, "sample.wav");
const service = new SystemSpeechService("win32", (command, args, stdin, timeout) => {
  const request = JSON.parse(stdin!);
  return runSpeechProcess(
    command,
    args,
    JSON.stringify(
      request.action === "speak" ? { ...request, action: "render", outputPath: path } : request,
    ),
    timeout,
  );
});
try {
  const voices = await service.listVoices();
  const voice = readAloudVoicesForLanguage(voices, language)[0];
  if (!voice) {
    assert.ok(
      !process.argv.includes("--require-voice"),
      `No compatible local Narrator voice for ${language}`,
    );
    console.log(JSON.stringify({ voices, language, synthesis: "skipped-no-compatible-voice" }));
  } else {
    assert.equal(
      await service.speak("smoke", {
        text: samples[language],
        language,
        voiceId: voice.id,
        rate: 1,
      }),
      "completed",
    );
    const audio = await readFile(path);
    assert.equal(audio.toString("ascii", 0, 4), "RIFF");
    assert.equal(audio.toString("ascii", 8, 12), "WAVE");
    let data: Buffer | undefined;
    let bits = 0;
    for (let offset = 12; offset + 8 <= audio.length;) {
      const tag = audio.toString("ascii", offset, offset + 4);
      const size = audio.readUInt32LE(offset + 4);
      assert.ok(offset + 8 + size <= audio.length, "complete WAV chunk");
      if (tag === "fmt ") {
        assert.ok(size >= 16);
        assert.equal(audio.readUInt16LE(offset + 8), 1, "PCM WAV");
        bits = audio.readUInt16LE(offset + 22);
      }
      if (tag === "data") data = audio.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert.ok([8, 16, 24, 32].includes(bits), "supported PCM sample size");
    assert.ok(
      data && data.length > 1000 && data.some(byte => byte !== (bits === 8 ? 128 : 0)),
      "non-silent PCM",
    );
    console.log(
      JSON.stringify({
        voice,
        language,
        path,
        synthesis: "non-silent-wav",
        note: "No speaker playback. Run with networking disabled to verify offline behavior; installed-extension acceptance is separate.",
      }),
    );
  }
} finally {
  service.close();
}
