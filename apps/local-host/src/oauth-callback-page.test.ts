import assert from "node:assert/strict";
import test from "node:test";
import {
  oauthCallbackHeaders, oauthCallbackPageStart, oauthCallbackPageEnd,
} from "./drive/oauth-callback-page";

const nonce = "abcdefghijklmnopqrstuv_123456789";

test("the standalone shadcn-style callback renders a centered accessible pending card", () => {
  const html = oauthCallbackPageStart(nonce);
  for (const slot of ["card", "badge", "alert"]) {
    assert.match(html, new RegExp('data-slot="' + slot + '"'));
  }
  assert.match(html, /data-state="pending"/);
  assert.match(html, /正在完成 Google Drive 連結/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /history\.replaceState\(null, "", location\.pathname\)/);
  assert.match(html, /⌘W 關閉分頁/);
  assert.doesNotMatch(html, /window\.close\(\)|id="oauth-close"/);
  assert.match(html, /class="brand-mark" src="data:image\/png;base64,/);
});

test("callback marks successful authorization only in the final streamed chunk", () => {
  const first = oauthCallbackPageStart(nonce);
  assert.doesNotMatch(first, /window\.__immersiveOAuthComplete\("success"\)/);
  assert.match(oauthCallbackPageEnd(nonce, "success"),
    /window\.__immersiveOAuthComplete\("success"\)/);
  assert.match(oauthCallbackPageEnd(nonce, "error"),
    /window\.__immersiveOAuthComplete\("error"\)/);
  assert.doesNotMatch(oauthCallbackPageEnd(nonce, "success"), /access_token|refresh_token/);
});

test("callback enforces a nonce-only CSP and no OAuth query referrers", () => {
  const headers = oauthCallbackHeaders(nonce);
  assert.match(headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /script-src 'nonce-/);
  assert.match(headers["Content-Security-Policy"], /style-src 'nonce-/);
  assert.match(headers["Content-Security-Policy"], /img-src data:/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-inline|https:/);
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Cache-Control"], /no-store/);
  assert.throws(() => oauthCallbackPageStart('"><script>alert(1)</script>'));
  assert.throws(() => oauthCallbackPageEnd("bad", "success"));
});
