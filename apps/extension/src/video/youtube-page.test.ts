import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM, type DOMWindow } from "jsdom";
import { build } from "vite";
import { parseSubtitles } from "@contextual/core";

// Exercise the actual MAIN-world bridge, including its fetch interception and
// response events, with deterministic player metadata and network responses.
const built = await build({
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    target: "chrome114",
    lib: {
      entry: fileURLToPath(new URL("../content/youtube-page.ts", import.meta.url)),
      name: "YouTubeCaptionTest",
      formats: ["iife"],
    },
  },
});
const output = Array.isArray(built) ? built[0] : built;
assert.ok("output" in output);
const chunk = output.output.find(item => item.type === "chunk");
assert.ok(chunk?.type === "chunk");
const script = chunk.code;
const videoId = "dQw4w9WgXcQ";
const baseUrl = "https://www.youtube.com/api/timedtext?v=" + videoId + "&lang=ja&kind=asr";
const captionBody = (text: string) =>
  JSON.stringify({
    events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: text }] }],
  });

function fixture(reply: (url: string) => string | Response, includeNativeEnglish = false) {
  const dom = new JSDOM('<div id="movie_player"></div>', {
    url: "https://www.youtube.com/watch?v=" + videoId,
    runScripts: "outside-only",
  });
  const window = dom.window;
  const requests: string[] = [];
  const captionTracks = [
    { baseUrl, languageCode: "ja", kind: "asr", isTranslatable: true },
    ...(includeNativeEnglish
      ? [
          {
            baseUrl: baseUrl.replace("lang=ja", "lang=en"),
            languageCode: "en",
            kind: "asr",
            isTranslatable: true,
          },
        ]
      : []),
  ];
  Object.assign(window.document.getElementById("movie_player")!, {
    getPlayerResponse: () => ({
      videoDetails: { videoId },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks,
          translationLanguages: [{ languageCode: "en" }, { languageCode: "ko" }],
        },
      },
    }),
  });
  window.fetch = async input => {
    const url = String(input);
    requests.push(url);
    const body = reply(url);
    return body instanceof Response ? body : new Response(body, { status: 200 });
  };
  Object.defineProperty(window, "AbortSignal", { value: AbortSignal });
  window.performance.getEntriesByType = () => [];
  window.eval(script);
  return { window, requests, close: () => window.close() };
}

type Reply = {
  ok: boolean;
  language?: string;
  text?: string;
  errorCode?: string;
  tracks?: { language: string; kind: string }[];
};

function request(window: DOMWindow, type: "caption" | "track", language = "en"): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const name = "contextual-learning:youtube:" + type + "-response";
    const timer = setTimeout(() => reject(new Error("Caption bridge did not respond")), 2000);
    window.addEventListener(
      name,
      event => {
        clearTimeout(timer);
        resolve((event as CustomEvent<Reply>).detail);
      },
      { once: true },
    );
    window.dispatchEvent(
      new window.CustomEvent("contextual-learning:youtube:" + type + "-request", {
        detail: { source: "contextual-learning", id, videoId, language },
      }),
    );
  });
}

test("the page bridge advertises translations and reuses the player's translated response", async () => {
  const page = fixture(url =>
    captionBody(new URL(url).searchParams.has("tlang") ? "Hello" : "こんにちは"),
  );
  try {
    const metadata = await request(page.window, "track");
    assert.deepEqual(
      Array.from(metadata.tracks ?? [], track => [track.language, track.kind]),
      [
        ["ja", "auto"],
        ["en", "translated"],
        ["ko", "translated"],
      ],
    );
    assert.ok(!JSON.stringify(metadata).includes("timedtext"));
    // Caption bodies are cloned asynchronously, as with the real player's fetch.
    await page.window.fetch(baseUrl);
    await page.window.fetch(baseUrl + "&tlang=en&pot=player-session");
    await new Promise(resolve => setTimeout(resolve, 30));
    const before = page.requests.length;
    const translated = await request(page.window, "caption", "en");
    assert.equal(translated.ok, true);
    assert.equal(translated.language, "en");
    assert.equal(parseSubtitles(translated.text!)[0].originalText, "Hello");
    const original = await request(page.window, "caption", "ja");
    assert.equal(original.language, "ja");
    assert.equal(parseSubtitles(original.text!)[0].originalText, "こんにちは");
    assert.equal(page.requests.length, before, "both requests reuse the correct captured body");
  } finally {
    page.close();
  }
});

test("translation fallback retains tlang across JSON3 and exact-URL retries and returns target language", async () => {
  const page = fixture(url => (new URL(url).searchParams.has("fmt") ? "" : captionBody("Hello")));
  try {
    const response = await request(page.window, "caption", "en");
    assert.equal(response.ok, true);
    assert.equal(response.language, "en");
    assert.equal(parseSubtitles(response.text!)[0].originalText, "Hello");
    assert.equal(page.requests.length, 2);
    for (const raw of page.requests) {
      const url = new URL(raw);
      assert.equal(url.searchParams.get("lang"), "ja");
      assert.equal(url.searchParams.get("tlang"), "en");
    }
    const unsupported = await request(page.window, "caption", "fr");
    assert.equal(unsupported.errorCode, "TRACK_UNAVAILABLE");
    assert.equal(page.requests.length, 2, "unadvertised translations never trigger requests");
  } finally {
    page.close();
  }
});

test("a captured translation never masks a native track in the same output language", async () => {
  const page = fixture(
    url => captionBody(new URL(url).searchParams.has("tlang") ? "Translation" : "Native English"),
    true,
  );
  try {
    await page.window.fetch(baseUrl + "&tlang=en");
    await new Promise(resolve => setTimeout(resolve, 30));
    const response = await request(page.window, "caption", "en");
    assert.equal(response.language, "en");
    assert.equal(parseSubtitles(response.text!)[0].originalText, "Native English");
    assert.ok(!new URL(page.requests.at(-1)!).searchParams.has("tlang"));
  } finally {
    page.close();
  }
});

test("a 429 stops fallback retries and pauses further subtitle requests", async () => {
  const page = fixture(() => new Response("Too many requests", { status: 429 }));
  try {
    const response = await request(page.window, "caption", "en");
    assert.equal(response.errorCode, "CAPTION_RATE_LIMITED");
    assert.equal(page.requests.length, 1, "do not try another URL after YouTube rate limits us");
    const again = await request(page.window, "caption", "ko");
    assert.equal(again.errorCode, "CAPTION_RATE_LIMITED");
    assert.equal(page.requests.length, 1, "changing language must not bypass the cooldown");
  } finally {
    page.close();
  }
});

test("the player's 429 pauses extension fetching without changing the player response", async () => {
  const page = fixture(() => new Response("Too many requests", { status: 429 }));
  try {
    const playerResponse = await page.window.fetch(baseUrl + "&tlang=en");
    assert.equal(playerResponse.status, 429);
    assert.equal(await playerResponse.text(), "Too many requests");
    const response = await request(page.window, "caption", "en");
    assert.equal(response.errorCode, "CAPTION_RATE_LIMITED");
    assert.equal(page.requests.length, 1, "leave the player's failed request alone");
  } finally {
    page.close();
  }
});

test("the player's XHR rate limit is observed without fetching captions", async () => {
  const page = fixture(() => captionBody("Hello"));
  try {
    const xhr = new page.window.XMLHttpRequest();
    xhr.open("GET", baseUrl + "&tlang=en");
    Object.defineProperty(xhr, "status", { value: 429 });
    xhr.getResponseHeader = () => null;
    xhr.dispatchEvent(new page.window.Event("load"));
    const response = await request(page.window, "caption", "en");
    assert.equal(response.errorCode, "CAPTION_RATE_LIMITED");
    assert.equal(page.requests.length, 0);
  } finally {
    page.close();
  }
});

test("caption retrieval resumes after the server's Retry-After delay", async () => {
  let now = Date.now();
  let limited = true;
  const page = fixture(() =>
    limited
      ? new Response("Too many requests", { status: 429, headers: { "Retry-After": "120" } })
      : captionBody("Hello"),
  );
  page.window.Date.now = () => now;
  try {
    await request(page.window, "caption", "en");
    limited = false;
    now += 61_000;
    assert.equal((await request(page.window, "caption", "en")).errorCode, "CAPTION_RATE_LIMITED");
    assert.equal(page.requests.length, 1);
    now += 60_000;
    assert.equal((await request(page.window, "caption", "en")).ok, true);
    assert.equal(page.requests.length, 2);
  } finally {
    page.close();
  }
});
