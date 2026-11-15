import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { speechVoicesForLanguage } from "@contextual/core";
import { SystemSpeechService, runSpeechProcess } from "../src/platform/speech";

if (process.platform !== "darwin")
  throw new Error("This synthesis-file smoke check requires macOS.");
const output = await mkdtemp(join(tmpdir(), "cll-system-speech-"));
let sample = 0;
const service = new SystemSpeechService("darwin", (command, args, input, timeout) => {
  const request = JSON.parse(input!);
  return runSpeechProcess(
    command,
    args,
    request.action === "speak"
      ? JSON.stringify({
          ...request,
          action: "render",
          outputPath: join(output, `sample-${++sample}.wav`),
        })
      : input,
    timeout,
  );
});
try {
  const voices = await service.listVoices();
  assert.equal(new Set(voices.map(v => v.id)).size, voices.length, "unique native voice IDs");
  const selected = [];
  for (const [language, text] of [
    ["en", "Let's learn together."],
    ["ja", "動画を見てたら、自分でも料理を作りたくなっちゃって。"],
  ]) {
    const voice = speechVoicesForLanguage(voices, language)[0];
    assert.ok(voice, `installed ${language} voice`);
    selected.push(voice);
    assert.equal(
      await service.speak(language, { text, language, voiceId: voice.id, rate: 1 }),
      "completed",
    );
    const audio = await readFile(join(output, `sample-${sample}.wav`));
    assert.equal(audio.toString("ascii", 0, 4), "RIFF");
    assert.ok(audio.length > 1000, "native synthesizer produced audio data");
  }
  const japanese = speechVoicesForLanguage(voices, "ja")[0];
  if (process.argv.includes("--require-neural"))
    assert.equal(japanese.neural, true, "the real neural voice is selected");
  const cancelling = service.speak("cancel", {
    text: "一緒に新しいことを学びましょう。".repeat(250),
    language: "ja",
    voiceId: japanese.id,
    rate: 1,
  });
  const deadline = Date.now() + 15_000;
  let rendering = false;
  while (Date.now() < deadline) {
    try {
      rendering = (await stat(join(output, "sample-3.wav"))).size > 1000;
    } catch {}
    if (rendering) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(rendering, "stop is exercised after actual audio synthesis begins");
  const stoppedAt = Date.now();
  await service.stop("cancel");
  assert.equal(await cancelling, "stopped");
  assert.ok(Date.now() - stoppedAt < 3000, "native helper exits promptly on stop");
  process.stdout.write(
    JSON.stringify({
      voices: voices.length,
      samples: 2,
      selected,
      output,
      note: "Actual AVSpeechSynthesizer files and cancellation; no speaker playback or installed extension verification.",
    }) + "\n",
  );
} finally {
  service.close();
}
