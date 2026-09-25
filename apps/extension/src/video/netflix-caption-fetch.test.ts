import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_BYTE_LIMIT, fetchNetflixCaptionText, isAllowedCaptionDeliveryUrl,
} from "./netflix-caption-fetch";

const url = "https://ipv4-c001.nflxvideo.net/track.vtt?token=session-signed";
const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello.\n";

test("only HTTPS Netflix-owned delivery domains are accepted", () => {
  assert.equal(isAllowedCaptionDeliveryUrl(url), true);
  assert.equal(isAllowedCaptionDeliveryUrl("https://nflximg.net/sub.xml"), true);
  assert.equal(isAllowedCaptionDeliveryUrl("https://www.netflix.com/timedtext"), true);
  assert.equal(isAllowedCaptionDeliveryUrl("https://nflxvideo.net.attacker.example/sub.xml"), false);
  assert.equal(isAllowedCaptionDeliveryUrl("http://nflxvideo.net/sub.xml"), false);
  assert.equal(isAllowedCaptionDeliveryUrl("https://username:password@nflxvideo.net/sub.xml"), false);
  assert.equal(isAllowedCaptionDeliveryUrl("https://attacker.example/sub.xml"), false);
});

test("retrieves a caption document from the session URL using a bounded request", async () => {
  let options: RequestInit | undefined;
  const request: typeof fetch = async (_url, init) => {
    options = init;
    return new Response(vtt, { status: 200 });
  };
  assert.equal(await fetchNetflixCaptionText(url, request), vtt);
  assert.equal(options?.credentials, "include");
  assert.equal(options?.redirect, "manual");
  assert.ok(options?.signal);
});

test("does not make any request for an untrusted subtitle URL", async () => {
  let requested = false;
  const request: typeof fetch = async () => {
    requested = true;
    return new Response(vtt);
  };
  await assert.rejects(() => fetchNetflixCaptionText("https://evil.example/vtt", request), /unsupported subtitle address/);
  assert.equal(requested, false);
});

test("rejects redirects and HTTP failures instead of leaking signed URLs", async () => {
  await assert.rejects(
    () => fetchNetflixCaptionText(url, async () => new Response(null, { status: 302 })),
    /will not follow/,
  );
  await assert.rejects(
    () => fetchNetflixCaptionText(url, async () => new Response("Expired", { status: 403 })),
    /HTTP 403/,
  );
});

test("replaces raw Failed to fetch errors with an actionable permission message", async () => {
  await assert.rejects(
    () => fetchNetflixCaptionText(url, async () => { throw new TypeError("Failed to fetch"); }),
    /Chrome has granted this extension access/,
  );
});

test("enforces document size even when Content-Length is missing or wrong", async () => {
  await assert.rejects(() => fetchNetflixCaptionText(url, async () =>
    new Response("text", { headers: { "content-length": String(CAPTION_BYTE_LIMIT + 1) } })),
  /2 MB limit/);
  const bytes = new Uint8Array(CAPTION_BYTE_LIMIT + 1);
  await assert.rejects(() => fetchNetflixCaptionText(url, async () =>
    new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }))),
  /2 MB limit/);
});
