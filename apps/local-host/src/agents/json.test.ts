import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentJson } from "./json";

const fence = String.fromCharCode(96, 96, 96);
const reply = { candidates: [{ cueIds: ["cue-1", "cue-2"], focusExpressions: ["どうしよう"],
  learningGoal: "Recognize a worried reply" }] };

test("generic imported CLI parser accepts raw JSON and a complete JSON code fence", () => {
  assert.deepEqual(parseAgentJson(JSON.stringify(reply), "Imported CLI"), reply);
  assert.deepEqual(parseAgentJson("\n" + fence + "json\n" + JSON.stringify(reply, null, 2) + "\n" + fence + "\n",
    "Imported CLI"), reply);
  assert.deepEqual(parseAgentJson(fence + "JSON\r\n" + JSON.stringify(reply) + "\r\n" + fence,
    "Imported CLI"), reply);
  assert.deepEqual(parseAgentJson(reply, "Imported CLI"), reply);
});

test("generic CLI parser rejects prose, multiple fences and malformed content without exposing it", () => {
  for (const invalid of [
    "Here you go:\n" + fence + "json\n{}\n" + fence,
    fence + "json\n{}\n" + fence + "\n" + fence + "json\n{}\n" + fence,
    fence + "javascript\n{}\n" + fence,
    fence + "json\n{ broken }\n" + fence,
  ]) {
    assert.throws(() => parseAgentJson(invalid, "Imported CLI"), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Imported CLI returned invalid lesson JSON.*Resume/);
      assert.ok(!error.message.includes(invalid), "never expose full model output in the error");
      return true;
    });
  }
});
