import test from "node:test";
import assert from "node:assert/strict";
import { youtubeVideo } from "./youtube";

test("YouTube watch, short, embed and live URLs resolve to a fixed video identity", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    "https://youtu.be/M7lc1UVf-VE",
    "https://m.youtube.com/shorts/M7lc1UVf-VE",
    "https://youtube.com/live/M7lc1UVf-VE",
    "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
  ])
    assert.deepEqual(youtubeVideo(url), { id: "M7lc1UVf-VE", start: 0 });
  assert.deepEqual(youtubeVideo("https://youtu.be/M7lc1UVf-VE?t=1m25s"), {
    id: "M7lc1UVf-VE",
    start: 85,
  });
  assert.deepEqual(youtubeVideo("https://youtube.com/watch?v=M7lc1UVf-VE&start=30", 42000), {
    id: "M7lc1UVf-VE",
    start: 42,
  });
});
test("untrusted hosts, credentials, scripts and invalid video IDs cannot become embeds", () => {
  for (const url of [
    undefined,
    "javascript:alert(1)",
    "http://youtube.com/watch?v=M7lc1UVf-VE",
    "https://youtube.com.evil.test/watch?v=M7lc1UVf-VE",
    "https://youtube.com@evil.test/watch?v=M7lc1UVf-VE",
    "https://evil.test/embed/M7lc1UVf-VE",
    "https://youtube.com/watch?v=not-valid",
    "https://youtu.be/M7lc1UVf-VE/extra",
    "https://user:secret@youtube.com/watch?v=M7lc1UVf-VE",
  ])
    assert.equal(youtubeVideo(url), null);
});
