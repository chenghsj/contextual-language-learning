import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentJson } from "./json";
import { agyAdapter } from "./agy";

const fence = String.fromCharCode(96, 96, 96);
const reply = { candidates: [{ cueIds: ["cue-1", "cue-2"], focusExpressions: ["どうしよう"],
  learningGoal: "Recognize a worried reply" }] };

test("parseAgentJson accepts raw JSON and a complete AGY-style JSON code fence", () => {
  assert.deepEqual(parseAgentJson(JSON.stringify(reply), "AGY"), reply);
  assert.deepEqual(parseAgentJson("\n" + fence + "json\n" + JSON.stringify(reply, null, 2) + "\n" + fence + "\n", "AGY"), reply);
  assert.deepEqual(parseAgentJson(fence + "JSON\r\n" + JSON.stringify(reply) + "\r\n" + fence, "AGY"), reply);
  assert.deepEqual(parseAgentJson(reply, "AGY"), reply);
});

test("the AGY adapter unwraps a JSON envelope containing a fenced model response", async () => {
  const output = JSON.stringify({ status: "SUCCESS", response: fence + "json\n" + JSON.stringify(reply) + "\n" + fence });
  const actual = await agyAdapter.generate({
    command: "agy", prompt: "Generate dialogue candidates", modelId: "",
    env: {}, workDir: "/tmp", signal: new AbortController().signal,
    run: async () => output,
  });
  assert.deepEqual(actual, reply);
});

test("parseAgentJson rejects prose, multiple fences and malformed content without exposing it", () => {
  for (const invalid of [
    "Here you go:\n" + fence + "json\n{}\n" + fence,
    fence + "json\n{}\n" + fence + "\n" + fence + "json\n{}\n" + fence,
    fence + "javascript\n{}\n" + fence,
    fence + "json\n{ broken }\n" + fence,
  ]) {
    assert.throws(() => parseAgentJson(invalid, "AGY"), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AGY returned invalid lesson JSON.*Resume/);
      assert.ok(!error.message.includes(invalid), "never expose full model output in the error");
      return true;
    });
  }
});
