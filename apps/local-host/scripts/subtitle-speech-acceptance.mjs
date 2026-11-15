import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-subtitle-speech-"));
async function run(helper, input) {
  const child = exec(helper, [], { timeout: 60000, maxBuffer: 2_000_000 });
  child.child.stdin.end(JSON.stringify(input));
  return (await child).stdout;
}
function wave(data) {
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  let format, pcm;
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + size);
    const type = data.toString("ascii", offset, offset + 4);
    if (type === "fmt ") format = chunk;
    if (type === "data") pcm = chunk;
    offset += 8 + size + (size % 2);
  }
  assert.ok(format && pcm);
  return { pcm, rate: format.readUInt32LE(4), frameBytes: format.readUInt16LE(12) };
}
const texts = ["赤福って普通だよね", "90%って感じがする"];
for (const name of ["macos-speech", "macos-speech-siri"]) {
  const helper = join(root, "dist", name);
  const voices = JSON.parse(await run(helper, { action: "voices" }));
  const voice =
    voices.find(
      v =>
        v.language.startsWith("ja") &&
        (v.neural || v.quality === "premium" || v.quality === "enhanced"),
    ) ?? voices.find(v => v.language.startsWith("ja"));
  assert.ok(voice, `${name} has a real Japanese voice`);
  const audio = [];
  for (const [index, text] of [...texts, texts.join("\u2029")].entries()) {
    const path = join(output, `${name}-${index}.wav`);
    await run(helper, { action: "render", voiceId: voice.id, rate: 1, text, outputPath: path });
    audio.push(wave(await readFile(path)));
  }
  const [first, second, group] = audio;
  assert.equal(group.rate, first.rate);
  assert.equal(group.frameBytes, first.frameBytes);
  const extraSeconds =
    (group.pcm.length - first.pcm.length - second.pcm.length) / group.frameBytes / group.rate;
  assert.ok(Math.abs(extraSeconds - 0.3) <= 0.03, `${name} adds a 300ms boundary: ${extraSeconds}`);
  let longest = 0,
    runLength = 0;
  for (const byte of group.pcm) {
    runLength = byte === 0 ? runLength + 1 : 0;
    longest = Math.max(longest, runLength);
  }
  assert.ok(
    longest >= group.rate * group.frameBytes * 0.3,
    "the rendered stream contains the silent boundary",
  );
  console.log(
    JSON.stringify({ backend: name, voiceId: voice.id, addedPauseSeconds: extraSeconds, output }),
  );
}
