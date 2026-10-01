import assert from "node:assert/strict";
import test from "node:test";
import { shouldFollowSelectedVideo } from "./draft-navigation";
const old = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const next = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
test("switching videos follows the new video after fetching captions for the old video", () => {
  assert.equal(shouldFollowSelectedVideo(old, next, "old subtitles", "video"), true);
});
test("manual transcripts remain bound to their original video", () => {
  assert.equal(shouldFollowSelectedVideo(old, next, "my transcript", "manual"), false);
  assert.equal(shouldFollowSelectedVideo(old, next, "unlinked transcript"), false);
});
test("empty drafts follow video changes, but title updates and unsupported tabs do not reset captions", () => {
  assert.equal(shouldFollowSelectedVideo(old, next, ""), true);
  assert.equal(shouldFollowSelectedVideo(old, old + "&t=20", "captions", "video"), false);
  assert.equal(shouldFollowSelectedVideo(old, "https://example.com", ""), false);
});
