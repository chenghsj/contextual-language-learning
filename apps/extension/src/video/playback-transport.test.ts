import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("YouTube resumes inside a loop, repeats from its start, and timing play clears bounds", async () => {
  const dom = new JSDOM('<video class="html5-main-video"></video>', { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  const video = dom.window.document.querySelector("video")!;
  let plays = 0, pauses = 0;
  video.play = async () => { plays++; };
  video.pause = () => { pauses++; };
  let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, location: dom.window.location,
    chrome: { runtime: { onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } } } });
  await import("../content/youtube");
  function send(message: unknown): Promise<unknown> { return new Promise(resolve => listener(message, {}, resolve)); }
  assert.deepEqual(await send({ type: "LOOP_SET", startMs: 1000, endMs: 5000, resumeMs: 3000, repeats: "infinite", delaySeconds: 0 }), { ok: true });
  assert.equal(video.currentTime, 3);
  video.dispatchEvent(new dom.window.Event("seeked"));
  video.currentTime = 5;
  video.dispatchEvent(new dom.window.Event("timeupdate"));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(video.currentTime, 1, "repeat uses original start, not resume position");
  await send({ type: "PLAYBACK_PAUSE" });
  assert.ok(pauses >= 2);
  await send({ type: "PLAYBACK_PLAY" });
  video.currentTime = 7;
  const before = pauses;
  video.dispatchEvent(new dom.window.Event("timeupdate"));
  assert.equal(pauses, before, "normal timing playback can pass the old end boundary");
  assert.ok(plays >= 3);
  assert.deepEqual(await send({ type: "LOOP_SET", startMs: 1000, endMs: 5000, resumeMs: 6000, repeats: 1, delaySeconds: 0 }), { ok: false, error: "Invalid loop range or repeat setting." });
  dom.window.close();
});
