import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { VIDEO_COMMAND_ERROR_CODES } from "../video/command-errors";
import type { UiLocale } from "./messages";
import { subtitleAcquisition, subtitleFailureMessage } from "./subtitle-acquisition";
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
  assert.match(page, /super\(message, "TRACK_UNAVAILABLE"\)/);
  assert.match(content, /isVideoCommandErrorCode\(result\.errorCode\)/);
  assert.match(tab, /new VideoCommandError/);
  assert.match(app, /cause instanceof VideoCommandError/);
  assert.match(app, /data-state=\{subtitleState\}/);
  assert.match(app, /<Button variant="ghost" size="sm"/);
  assert.doesNotMatch(app, /subtitleLayout\.hint|subtitleUi\.tracksUnknown|subtitleLayout\.ready/);
  assert.match(app, /!subtitleReaderBlocked && subtitleState !== "ready" && <Button/);
  assert.match(app, /videoRecovery=\{page === "create" && !generating \? undefined : videoRecovery\}/);
  assert.match(app, /subtitleReaderBlocked \? subtitleLayout\.reloadNeeded/);
  assert.match(app, /role=\{subtitleState === "error" \? "alert" : "status"\}/);
  assert.doesNotMatch(app, /cause\.message\.includes\("no available"/);
  assert.equal(new VideoCommandError("No track", "TRACK_UNAVAILABLE").code, "TRACK_UNAVAILABLE");
});


test("subtitle errors offer localized recovery instructions without transport diagnostics", () => {
  for (const locale of Object.keys(subtitleAcquisition) as UiLocale[]) {
    for (const code of VIDEO_COMMAND_ERROR_CODES) {
      const message = subtitleFailureMessage(locale, { code, language: "ja" });
      assert.ok(message.length > 10, locale + " " + code);
      assert.doesNotMatch(message, /HTTP|200|session caption request|CAPTION_|TRACK_/);
      if (locale === "zh-TW" || locale === "zh-CN") assert.match(message, /字幕/);
      if (locale === "ja") assert.match(message, /字幕|動画/);
      if (locale === "ko") assert.match(message, /자막|동영상/);
    }
  }
  const failure = { code: "CAPTION_EMPTY" as const, language: "ja" as const };
  assert.match(subtitleFailureMessage("zh-TW", failure), /開啟字幕.*播放幾秒.*匯入字幕/);
  assert.match(subtitleFailureMessage("en", failure), /Turn on captions.*play for a few seconds/);
  assert.notEqual(subtitleFailureMessage("zh-TW", failure), subtitleFailureMessage("ja", failure),
    "changing the interface language must reformat the stored failure");
});
