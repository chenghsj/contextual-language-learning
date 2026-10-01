import assert from "node:assert/strict";
import test from "node:test";
import {
  NETFLIX_SEEK_GRACE_MS,
  isManagedNetflixSeek,
  reachedNetflixSeekTarget,
  netflixLoopReachedEnd,
} from "./netflix-loop-timing";

test("Netflix seeking event before currentTime updates is still a managed seek", () => {
  const now = 1_000;
  assert.equal(isManagedNetflixSeek(83_500, now + NETFLIX_SEEK_GRACE_MS, now + 1), true);
  assert.equal(reachedNetflixSeekTarget(83_500, 33_000, true), false);
  assert.equal(reachedNetflixSeekTarget(83_500, 83_500, true), false);
  assert.equal(reachedNetflixSeekTarget(83_500, 83_500, false), true);
  assert.equal(isManagedNetflixSeek(null, now + NETFLIX_SEEK_GRACE_MS, now + 1), false);
  assert.equal(
    isManagedNetflixSeek(83_500, now + NETFLIX_SEEK_GRACE_MS, now + NETFLIX_SEEK_GRACE_MS + 1),
    false,
  );
});

test("Netflix loop uses the actual HTML video cursor and waits until the cue end", () => {
  assert.equal(netflixLoopReachedEnd(84_000, 85_600), false);
  assert.equal(netflixLoopReachedEnd(85_510, 85_600), true);
  assert.equal(netflixLoopReachedEnd(Number.NaN, 85_600), false);
});
