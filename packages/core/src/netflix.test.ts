import assert from "node:assert/strict";
import test from "node:test";
import { netflixWatchId } from "./netflix";

test("Netflix watch URLs are matched by video ID, never by a lookalike domain", () => {
  assert.equal(netflixWatchId("https://www.netflix.com/watch/81234567?trackId=123"), "81234567");
  assert.equal(netflixWatchId("https://www.netflix.com/browse"), null);
  assert.equal(netflixWatchId("https://www.netflix.com.evil.example/watch/81234567"), null);
  assert.equal(netflixWatchId("http://netflix.com/watch/81234567"), null);
});
