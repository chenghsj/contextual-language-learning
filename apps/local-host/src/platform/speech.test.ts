import test from "node:test";
import assert from "node:assert/strict";
import {
  SystemSpeechService as PlatformSpeechService,
  type SpeechProcess,
  type SpeechRunner,
} from "./speech";

class SystemSpeechService extends PlatformSpeechService {
  constructor(platform: NodeJS.Platform, run?: SpeechRunner, helper?: string) {
    super(platform, run, helper, async () => null);
  }
}

const input = {
  text: "じゃあ、一緒に作りましょう。",
  language: "ja",
  voiceId: "com.apple.voice.compact.ja-JP.Kyoko",
  rate: 0.75,
};

const macVoices = JSON.stringify([
  { id: input.voiceId, name: "Kyoko", language: "ja-JP", quality: "default", neural: false },
  {
    id: "com.apple.ttsbundle.gryphon-neural_Sakura_ja-JP_premium",
    name: "聲音2",
    language: "ja-JP",
    quality: "enhanced",
    neural: true,
  },
]);
const isSpeaking = (stdin?: string) => stdin && JSON.parse(stdin).action === "speak";
test("speech capability follows the public Mac helper minimum, independently of Siri", () => {
  for (const [platform, version, expected] of [
    ["darwin", "21.6.0", false],
    ["darwin", "22.0.0", true],
    ["darwin", "25.0.0", true],
    ["win32", "10.0.0", true],
    ["linux", "6.0.0", false],
  ] as const) {
    const service = new PlatformSpeechService(
      platform,
      undefined,
      undefined,
      undefined,
      undefined,
      version,
    );
    assert.equal(service.supported, expected);
    service.close();
  }
});

test("installed Apple Swift executes the packaged source; unusable tools fall back to the compiled helper", async () => {
  for (const broken of [false, true]) {
    const calls: { command: string; args: string[]; stdin?: string }[] = [];
    const service = new PlatformSpeechService(
      "darwin",
      (command, args, stdin) => {
        calls.push({ command, args, stdin });
        return {
          completion:
            broken && command === "/apple/swift"
              ? Promise.reject(new Error("old SDK"))
              : Promise.resolve(isSpeaking(stdin) ? "" : macVoices),
          stop() {},
        };
      },
      "/bundle/macos-speech",
      async () => "/apple/swift",
    );
    await service.listVoices();
    assert.deepEqual(calls[0].args, [
      "-module-cache-path",
      "/bundle/speech-module-cache",
      "/bundle/macos-speech.swift",
    ]);
    assert.equal(await service.speak("one", input), "completed");
    assert.equal(calls.at(-1)!.command, broken ? "/bundle/macos-speech" : "/apple/swift");
    assert.equal(calls.at(-1)!.args.includes(input.text), false);
    service.close();
  }
});

test("stop acknowledgement waits for the audio process to exit", async () => {
  let exit!: (value: string) => void;
  let killed = false;
  const completion = new Promise<string>(resolve => {
    exit = resolve;
  });
  const service = new SystemSpeechService("darwin", (_command, _args, stdin) =>
    isSpeaking(stdin)
      ? {
          completion,
          stop() {
            killed = true;
          },
        }
      : { completion: Promise.resolve(macVoices), stop() {} },
  );
  const speech = service.speak("one", input);
  await new Promise(resolve => setImmediate(resolve));
  let acknowledged = false;
  const stopping = service.stop("one").then(() => {
    acknowledged = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(killed, true);
  assert.equal(acknowledged, false);
  exit("");
  assert.equal(await speech, "stopped");
  await stopping;
  assert.equal(acknowledged, true);
});
function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let stopped = false;
  return {
    completion,
    resolve,
    reject,
    get stopped() {
      return stopped;
    },
    stop() {
      stopped = true;
      resolve("");
    },
  };
}
test("macOS preserves unique voice IDs and quality, passing text as JSON stdin", async () => {
  const calls: { command: string; args: string[]; stdin?: string }[] = [];
  const run: SpeechRunner = (command, args, stdin) => {
    calls.push({ command, args, stdin });
    return { completion: Promise.resolve(isSpeaking(stdin) ? "" : macVoices), stop() {} };
  };
  const service = new SystemSpeechService("darwin", run, "/bundle with spaces/macos-speech");
  const voices = await service.listVoices();
  assert.equal(voices[1].neural, true);
  assert.equal(voices[1].quality, "enhanced");
  const text = "日本語 '\" $(Get-Item Secret) <speak>literal</speak>";
  assert.equal(await service.speak("one", { ...input, text }), "completed");
  assert.deepEqual(calls[1], {
    command: "/bundle with spaces/macos-speech",
    args: [],
    stdin: JSON.stringify({ action: "speak", voiceId: input.voiceId, text, rate: input.rate }),
  });
  await assert.rejects(service.speak("wrong", { ...input, language: "en" }), /unavailable/);
  assert.equal(calls.length, 2);
});
test("replacement waits for exit, stale stop does not cancel the new speech, and EOF stops it", async () => {
  const processes: ReturnType<typeof deferred>[] = [];
  const run: SpeechRunner = (_command, _args, stdin) => {
    if (!isSpeaking(stdin)) return { completion: Promise.resolve(macVoices), stop() {} };
    const process = deferred();
    processes.push(process);
    return process;
  };
  const service = new SystemSpeechService("darwin", run);
  await service.listVoices();
  const first = service.speak("first", input);
  await new Promise(resolve => setImmediate(resolve));
  const second = service.speak("second", input);
  assert.equal(await first, "stopped");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(processes.length, 2);
  service.stop("first");
  assert.equal(processes[1].stopped, false);
  service.close();
  assert.equal(await second, "stopped");
  await assert.rejects(service.speak("closed", input), /closed/);
});
test("stop during voice discovery prevents any audio process from launching", async () => {
  const voices = deferred();
  let calls = 0;
  const service = new SystemSpeechService("darwin", () => {
    calls++;
    return voices;
  });
  const speaking = service.speak("pending", input);
  await new Promise(resolve => setImmediate(resolve));
  service.stop("pending");
  voices.resolve(macVoices);
  assert.equal(await speaking, "stopped");
  assert.equal(calls, 1);
});
test("Windows uses a static encoded script and JSON stdin for Narrator token IDs and literal text", async () => {
  const calls: { command: string; args: string[]; stdin: string }[] = [];
  const service = new SystemSpeechService("win32", (command, args, stdin = "") => {
    calls.push({ command, args, stdin });
    return {
      completion: Promise.resolve(
        calls.length === 1
          ? JSON.stringify([
              {
                id: "narrator:local-Nanami",
                name: "Nanami",
                language: "ja-JP",
                engine: "narrator",
                neural: true,
                installed: true,
              },
            ])
          : "",
      ),
      stop() {},
    };
  });
  const text = "日本語 ' \" $(Get-Item Secret) <speak>literal</speak>";
  assert.equal(
    await service.speak("win", { ...input, voiceId: "narrator:local-Nanami", text }),
    "completed",
  );
  assert.equal(calls[1].command, "powershell.exe");
  assert.equal(calls[1].args.includes(text), false);
  assert.equal(JSON.parse(calls[1].stdin).text, text);
  assert.equal(JSON.parse(calls[1].stdin).voiceId, "narrator:local-Nanami");
  assert.equal(JSON.parse(calls[1].stdin).voiceLanguage, "ja-JP");
  assert.equal(JSON.parse(calls[1].stdin).rate, -2);
  const script = Buffer.from(calls[1].args.at(-1)!, "base64").toString("utf16le");
  assert.ok(script.includes("$synth.Speak([string]$segments[$index], 16)"));
  assert.ok(script.includes(".Split([char]0x2029)"));
  assert.ok(script.includes('silence msec="300"'));
  assert.ok(script.includes("$synth.Voice = $selected"));
  assert.ok(!script.includes(text));
  assert.ok(!script.includes("Invoke-Expression"));
});
test("unsupported platforms and synthesis failures remain errors", async () => {
  await assert.rejects(new SystemSpeechService("linux").listVoices(), /macOS and Windows/);
  const service = new SystemSpeechService("darwin", (_command, _args, stdin) => ({
    completion: isSpeaking(stdin)
      ? Promise.reject(new Error("audio failed"))
      : Promise.resolve(macVoices),
    stop() {},
  }));
  await assert.rejects(service.speak("fail", input), /audio failed/);
});
