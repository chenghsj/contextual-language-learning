import assert from "node:assert/strict";
import test from "node:test";
import { getVideoAdapter, supports } from "./index";

const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const nf = "https://www.netflix.com/watch/81234567";

test("resolves registered platforms using a validated video identity", () => {
  assert.equal(getVideoAdapter(yt).id, "youtube");
  assert.equal(getVideoAdapter(nf).id, "netflix");
  assert.equal(getVideoAdapter("https://www.netflix.com.evil.example/watch/81234567").id, "import");
  assert.equal(getVideoAdapter("https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ").id, "import");
  assert.equal(getVideoAdapter("https://tv.apple.com/show/sample").id, "import");
});

test("capabilities derive from the adapter, not from platform conditionals in the reader", () => {
  assert.equal(supports(getVideoAdapter(yt), "timestampLink"), true);
  assert.equal(supports(getVideoAdapter(yt), "seek"), false);
  assert.equal(supports(getVideoAdapter(nf), "seek"), true);
  assert.equal(supports(getVideoAdapter(nf), "loop"), true);
  assert.equal(supports(getVideoAdapter(""), "loop"), false);
});

test("speed controls are provided only by adapters with playback rate support", () => {
  assert.equal(supports(getVideoAdapter(yt), "playbackRate"), true);
  assert.equal(supports(getVideoAdapter(nf), "playbackRate"), true);
  assert.equal(supports(getVideoAdapter("https://tv.apple.com/watch/example"), "playbackRate"), false);
});

test("YouTube and Netflix offer user-initiated subtitle retrieval; unsupported videos do not", () => {
  assert.equal(typeof getVideoAdapter(nf).fetchSubtitles, "function");
  assert.equal(typeof getVideoAdapter(yt).fetchSubtitles, "function");
  assert.equal(getVideoAdapter("https://example.com/video").fetchSubtitles, undefined);
});
