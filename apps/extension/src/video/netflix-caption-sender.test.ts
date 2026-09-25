import assert from "node:assert/strict";
import test from "node:test";
import { validateNetflixCaptionSender, type NetflixCaptionSender } from "./netflix-caption-sender";

const extensionId = "immersive-extension-test";
const watch = "https://www.netflix.com/watch/81234567";
const sender: NetflixCaptionSender = {
  id: extensionId,
  frameId: 0,
  tab: { id: 42 },
  url: watch,
  origin: "https://www.netflix.com",
};
const check = (candidate: NetflixCaptionSender, tabUrl = watch, videoId = "81234567") =>
  validateNetflixCaptionSender(candidate, extensionId, tabUrl, videoId);

test("accepts a top-level Netflix watch page caption request", () => {
  assert.equal(check(sender), null);
});

test("accepts a Netflix SPA content script loaded on /browse after tab navigates to /watch", () => {
  assert.equal(check({ ...sender, url: "https://www.netflix.com/browse" }), null);
  assert.equal(check({ ...sender, url: "https://www.netflix.com/watch/76543210" }), null);
});

test("uses the current tab URL and the requested video ID, not the sender's old document pathname", () => {
  assert.match(check(sender, "https://www.netflix.com/browse") ?? "", /not on a video watch page/);
  assert.match(check(sender, "https://www.netflix.com/watch/76543210") ?? "", /video changed/);
});

test("rejects cross-origin, impersonating and nested-frame caption requests", () => {
  assert.match(check({ ...sender, frameId: 1 }) ?? "", /top-level/);
  assert.match(check({ ...sender, id: "other-extension" }) ?? "", /this extension/);
  assert.match(check({ ...sender, url: "https://www.netflix.com.evil.test/browse" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, url: "https://youtube.com/watch/81234567" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, origin: "https://www.netflix.com.evil.test" }) ?? "", /document origin/);
  assert.match(check({ ...sender, url: "https://netflix.com/browse" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, url: undefined, origin: undefined }) ?? "", /current Netflix page/);
});

test("origin alone is sufficient when Chrome omits the sender document URL", () => {
  assert.equal(check({ ...sender, url: undefined }), null);
});
