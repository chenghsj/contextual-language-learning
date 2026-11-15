import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const script = readFileSync(
  new URL("../ContextualLearning/Resources/youtube-player.js", import.meta.url),
  "utf8",
);
function harness() {
  let options,
    time = 0,
    state = -1,
    now = 0,
    timerID = 0;
  const timers = new Map(),
    calls = [],
    messages = [];
  const event = value => {
    state = value;
    options.events.onStateChange({ data: value });
  };
  const player = {
    seekTo(t) {
      calls.push(["seek", t]);
      time = t;
    },
    playVideo() {
      calls.push(["play"]);
      event(1);
    },
    pauseVideo() {
      calls.push(["pause"]);
      event(2);
    },
    loadVideoById(v) {
      calls.push(["load", v.videoId]);
      time = v.startSeconds;
      event(1);
    },
    cueVideoById(v) {
      calls.push(["cue", v.videoId]);
      time = v.startSeconds;
      event(5);
    },
    getCurrentTime() {
      return time;
    },
    getPlayerState() {
      return state;
    },
  };
  const window = {
    location: { origin: "https://example.test" },
    webkit: {
      messageHandlers: {
        youtubePlayer: { postMessage: value => messages.push(value) },
      },
    },
  };
  const schedule = (fn, delay, interval) => {
    const id = ++timerID;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  const context = {
    window,
    YT: {
      Player: function (_, value) {
        options = value;
        return player;
      },
    },
    Date: { now: () => now },
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, delay) => schedule(fn, delay, 0),
    clearTimeout: id => timers.delete(id),
  };
  runInNewContext(script, context);
  const api = window.CLLYouTubePlayer;
  function tick(ms) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.fn();
    }
    now = end;
  }
  function request(id = "a", startSeconds = 83.125, endSeconds = 85.5, videoID = "aqz-KE-bpKQ") {
    return { id, videoID, startSeconds, endSeconds };
  }
  function start(value = request()) {
    api.play(value);
    window.onYouTubeIframeAPIReady();
    options.events.onReady();
    tick(50);
  }
  return {
    api,
    calls,
    messages,
    tick,
    request,
    start,
    event,
    setTime: value => {
      time = value;
    },
    get time() {
      return time;
    },
    get state() {
      return state;
    },
    get timers() {
      return timers.size;
    },
    get status() {
      return messages.at(-1).state;
    },
    error: code => options.events.onError({ data: code }),
  };
}

test("single play pauses at calibrated end, keeps frame, explicit play/replay starts at precise start", () => {
  const h = harness();
  h.start();
  assert.equal(h.time, 83.125);
  h.setTime(85.49);
  h.tick(50);
  assert.equal(h.state, 1);
  h.setTime(85.5);
  h.tick(50);
  assert.equal(h.state, 2);
  assert.equal(h.status, "completed");
  assert.equal(h.time, 85.5);
  assert.equal(h.timers, 0);
  h.api.command("resume");
  assert.equal(h.time, 83.125);
  assert.equal(h.state, 1);
});

test("loop pauses for half second, restarts, and manual pause cancels pending repeat", () => {
  const h = harness();
  h.api.setMode("loop");
  h.start();
  h.setTime(85.5);
  h.tick(50);
  assert.equal(h.status, "loop-waiting");
  h.tick(499);
  assert.equal(h.state, 2);
  h.tick(1);
  assert.equal(h.time, 83.125);
  assert.equal(h.state, 1);
  h.tick(50);
  h.setTime(85.5);
  h.tick(50);
  h.api.command("pause");
  h.tick(1000);
  assert.equal(h.state, 2);
  assert.equal(h.status, "paused");
  assert.equal(h.timers, 0);
});

test("changing segment cancels old repeat and ignores stale playhead while seek settles", () => {
  const h = harness();
  h.api.setMode("loop");
  h.start();
  h.setTime(85.5);
  h.tick(50);
  h.api.play(h.request("b", 10, 12));
  h.setTime(85.5);
  h.tick(50);
  assert.equal(h.state, 1);
  h.setTime(10.2);
  h.tick(50);
  h.setTime(12);
  h.tick(50);
  assert.equal(h.status, "loop-waiting");
  h.tick(500);
  assert.equal(h.time, 10);
  assert.equal(h.messages.at(-1).requestID, "b");
});

test("continuous mode passes end, mode changes do not seek or resume, once applies to current playhead", () => {
  const h = harness();
  h.api.setMode("continuous");
  h.start();
  h.setTime(100);
  h.tick(2000);
  assert.equal(h.state, 1);
  const seeks = h.calls.filter(v => v[0] === "seek").length;
  h.api.setMode("once");
  h.tick(50);
  assert.equal(h.status, "completed");
  assert.equal(h.calls.filter(v => v[0] === "seek").length, seeks);
  h.api.setMode("continuous");
  h.tick(1000);
  assert.equal(h.state, 2);
});

test("background, mode change and errors cancel delayed repeat; returning never auto-resumes old audio", () => {
  for (const cancel of [
    h => h.api.setActive(false),
    h => h.api.setMode("once"),
    h => h.error(150),
  ]) {
    const h = harness();
    h.api.setMode("loop");
    h.start();
    h.setTime(85.5);
    h.tick(50);
    cancel(h);
    h.tick(1000);
    assert.equal(h.state, 2);
    h.api.setActive(true);
    h.tick(1000);
    assert.equal(h.state, 2);
  }
});

test("old snapshots without end stay continuous and unknown video errors keep request identity", () => {
  const h = harness();
  h.start(h.request("legacy", 0, null));
  h.setTime(999);
  h.tick(2000);
  assert.equal(h.state, 1);
  h.error(150);
  assert.equal(h.messages.at(-1).code, 150);
  assert.equal(h.messages.at(-1).requestID, "legacy");
});

test("very short segment still stops if polling missed the seek interval", () => {
  const h = harness();
  h.start(h.request("short", 1, 1.01));
  h.setTime(1.1);
  h.tick(1100);
  assert.equal(h.status, "completed");
});

test("full video ending loops within bounds; duplicate request does not replay; pending inactive request starts only on return", () => {
  const h = harness();
  h.api.setMode("loop");
  h.start();
  const count = h.calls.length;
  h.api.play(h.request());
  assert.equal(h.calls.length, count);
  h.event(0);
  assert.equal(h.status, "loop-waiting");
  h.tick(500);
  assert.equal(h.state, 1);
  h.api.setActive(false);
  h.api.play(h.request("b", 0, 1, "_vRos9BS0Ak"));
  assert.equal(h.state, 5);
  h.tick(1000);
  assert.notEqual(h.state, 1);
  h.api.setActive(true);
  assert.equal(h.state, 1);
  assert.equal(h.time, 0);
});
