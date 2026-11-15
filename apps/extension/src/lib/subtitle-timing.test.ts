import assert from "node:assert/strict";
import test from "node:test";
import type { SubtitleCue } from "@contextual/core";
import { transformSubtitleTiming } from "./subtitle-timing";
const cue = (startMs: number, endMs: number, id = "cue-1"): SubtitleCue => ({
  id,
  startMs,
  endMs,
  originalText: "Speech",
});

test("offset and proportional drift preserve millisecond precision, IDs, and source data", () => {
  const source = [
    cue(1234, 2456),
    cue(11234, 12456, "cue-2"),
    { ...cue(0, 1, "untimed"), startMs: null, endMs: null },
  ];
  const before = structuredClone(source);
  assert.deepEqual(transformSubtitleTiming(source, { offsetMs: -234 }), [
    { id: "cue-1", startMs: 1000, endMs: 2222 },
    { id: "cue-2", startMs: 11000, endMs: 12222 },
  ]);
  assert.deepEqual(
    transformSubtitleTiming([cue(1000, 2000), cue(11000, 12000, "cue-2")], {
      anchors: [
        { subtitleMs: 1000, audioMs: 1200 },
        { subtitleMs: 11000, audioMs: 12200 },
      ],
    }),
    [
      { id: "cue-1", startMs: 1200, endMs: 2300 },
      { id: "cue-2", startMs: 12200, endMs: 13300 },
    ],
  );
  assert.deepEqual(source, before);
  assert.deepEqual(transformSubtitleTiming(source, { offsetMs: 0 }), []);
});

test("invalid transforms reject the whole operation without clamping or partial results", () => {
  for (const offsetMs of [-1001, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => transformSubtitleTiming([cue(1000, 2000)], { offsetMs }));
  assert.throws(() =>
    transformSubtitleTiming([cue(1000, 2000), cue(4000, 5000)], { offsetMs: 1000 }, 5500),
  );
  assert.throws(() =>
    transformSubtitleTiming([cue(1000, 1001)], {
      anchors: [
        { subtitleMs: 1000, audioMs: 1000 },
        { subtitleMs: 2000, audioMs: 1001 },
      ],
    }),
  );
  for (const anchors of [
    [
      { subtitleMs: 1000, audioMs: 1000 },
      { subtitleMs: 1000, audioMs: 2000 },
    ],
    [
      { subtitleMs: 1000, audioMs: 2000 },
      { subtitleMs: 2000, audioMs: 1000 },
    ],
    [
      { subtitleMs: -1, audioMs: 0 },
      { subtitleMs: 2000, audioMs: 2000 },
    ],
  ] as const)
    assert.throws(() => transformSubtitleTiming([cue(1000, 2000)], { anchors }));
});
