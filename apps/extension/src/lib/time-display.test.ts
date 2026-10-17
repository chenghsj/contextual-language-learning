import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayTime, parseDisplayTime } from "./time-display";

test("UI timestamps use tenths with correct minute/hour carry and leave source precision intact", () => {
  const original = { startMs: 110777, endMs: 1422004 };
  assert.equal(formatDisplayTime(original.startMs), "01:50.8");
  assert.equal(formatDisplayTime(original.endMs), "23:42.0");
  assert.equal(formatDisplayTime(59950), "01:00.0");
  assert.equal(formatDisplayTime(3599950), "01:00:00.0");
  assert.equal(formatDisplayTime(3723045), "01:02:03.0");
  assert.equal(formatDisplayTime(NaN), "");
  assert.deepEqual(original, { startMs: 110777, endMs: 1422004 });
});

test("compact range inputs accept precise milliseconds and existing hour format", () => {
  assert.equal(parseDisplayTime("01:50.777"), 110777);
  assert.equal(parseDisplayTime("23:42.004"), 1422004);
  assert.equal(parseDisplayTime("00:00.1"), 100);
  assert.equal(parseDisplayTime("01:02:03.045"), 3723045);
  for (const value of ["", "01:", "01:60", "60:00", "00:00.0001", "-01:00"]) {
    assert.ok(Number.isNaN(parseDisplayTime(value)));
  }
});
