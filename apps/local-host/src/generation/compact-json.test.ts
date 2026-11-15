import test from "node:test";
import assert from "node:assert/strict";
import { parseCompactJson } from "./compact-json";
test("the observed targetLineIndex key can regain its closing quote without touching values", () => {
  const literal = '"targetLineIndex:0, factory';
  const broken = '{"targetLineIndex:0,"targetText":' + JSON.stringify(literal) + "}";
  assert.deepEqual(parseCompactJson(broken), {
    value: { targetLineIndex: 0, targetText: literal },
    repairs: ["target_line_index_key_quote"],
  });
  for (const bad of ['{"otherKey:0}', '{"pointIds":[] factory}', '{"targetLineIndex:0,"missing":}'])
    assert.throws(() => parseCompactJson(bad));
});
test("only observed structural lexical typos are normalized, without changing quoted source", () => {
  const object =
    '{\\\n"sourceSpans":[{"start":1,"end":18"}],"text":"end:18\\\" and \\\\ remain source"}';
  const parsed = parseCompactJson(object);
  assert.deepEqual(parsed.value, {
    sourceSpans: [{ start: 1, end: 18 }],
    text: 'end:18" and \\ remain source',
  });
  assert.deepEqual(parsed.repairs, ["stray_object_backslash", "span_number_quote"]);
  assert.throws(() => parseCompactJson("prefix " + object));
  assert.throws(() => parseCompactJson('{"end":18,"value":}'));
  assert.throws(() => parseCompactJson('{"end":18" ,"missing":}'));
  assert.deepEqual(parseCompactJson('{"text":"18\\\"","end":18}').repairs, []);
});
test("a known unquoted annotation key is quoted without evaluating or rewriting values", () => {
  const source = '{"segments":[{"text":"近い",reading:"ちかい"}],"literal":"{reading: untouched}"}';
  assert.deepEqual(parseCompactJson(source), {
    value: { segments: [{ text: "近い", reading: "ちかい" }], literal: "{reading: untouched}" },
    repairs: ["unquoted_reading_key"],
  });
  for (const invalid of [
    "{reading: process.exit()}",
    '{otherKey:"x"}',
    '{reading:"x",}',
    'prefix {reading:"x"}',
  ])
    assert.throws(() => parseCompactJson(invalid));
});
