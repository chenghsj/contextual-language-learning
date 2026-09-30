import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { subtitleAcquisition } from "./subtitle-acquisition";
import { VideoCommandError } from "../video/tab";

test("all UI locales explain missing subtitle tracks and next actions", () => {
  for (const copy of Object.values(subtitleAcquisition)) {
    assert.ok(copy.trackUnavailable.includes("{language}"));
    assert.ok(copy.trackUnavailableAction.length > 10);
  }
});

test("missing tracks carry a structured code through the YouTube bridge", async () => {
  const page = await readFile(new URL("../content/youtube-page.ts", import.meta.url), "utf8");
  const content = await readFile(new URL("../content/youtube.ts", import.meta.url), "utf8");
  const tab = await readFile(new URL("../video/tab.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(page, /MissingYouTubeCaptionTrackError/);
  assert.match(page, /errorCode: "TRACK_UNAVAILABLE"/);
  assert.match(content, /result\.errorCode === "TRACK_UNAVAILABLE"/);
  assert.match(tab, /new VideoCommandError/);
  assert.match(app, /cause instanceof VideoCommandError/);
  assert.match(app, /data-tone=\{subtitleTone\}/);
  assert.match(app, /border-destructive\/60 bg-destructive\/10/);
  assert.match(app, /role=\{subtitleTone === "missing" \|\| subtitleTone === "error" \? "alert" : "status"\}/);
  assert.doesNotMatch(app, /cause\.message\.includes\("no available"/);
  assert.equal(new VideoCommandError("No track", "TRACK_UNAVAILABLE").code, "TRACK_UNAVAILABLE");
});
