import assert from "node:assert/strict";
import test from "node:test";
import { encodeMessage, NativeFramer } from "./protocol";

test("native messaging recovers frames fragmented across reads", () => {
  const values: unknown[] = [];
  const framer = new NativeFramer(message => values.push(message));
  const one = encodeMessage({ id: "one", type: "health" });
  const two = encodeMessage({ id: "two", text: "日本語" });
  const combined = Buffer.concat([one, two]);
  framer.push(combined.subarray(0, 2));
  framer.push(combined.subarray(2, 13));
  framer.push(combined.subarray(13));
  assert.deepEqual(values, [
    { id: "one", type: "health" },
    { id: "two", text: "日本語" },
  ]);
});

test("oversize native messages fail before allocation of payload", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(9 * 1024 * 1024);
  assert.throws(() => new NativeFramer(() => {}).push(header), /too large/);
});
