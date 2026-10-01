import test from "node:test";
import assert from "node:assert/strict";
import { piFeedback, type PiFeedbackContext } from "./pi-feedback";
import { piCopy } from "./pi";
import { translate, type UiLocale } from "./messages";

const locales: UiLocale[] = ["en", "zh-TW", "zh-CN", "ja", "ko"];
test("operation abort is not treated as login cancellation", () => {
  assert.equal(
    piFeedback("zh-TW", "This operation was aborted", "generation").message,
    "已取消教材生成。",
  );
  assert.equal(piFeedback("zh-TW", "This operation was aborted").message, "已取消");
  assert.equal(piFeedback("zh-TW", "Login cancelled.").message, "已取消登入。");
});
// Current Pi 0.99 / Antigravity 0.8 interactive output reachable through the
// six product providers. Runtime/API failures are open-ended and tested below.
const interactive = [
  "Enter OpenAI API key",
  "Enter Anthropic API key",
  "Enter Gemini API key",
  "Enter OpenRouter API key",
  "Enter GitHub Copilot token",
  "GitHub Enterprise URL/domain (blank for github.com)",
  "Enabling models...",
  "Open this link to sign in.",
  "Sign-in code: CODE-123",
  "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.",
  "Complete login in your browser, or paste the final redirect URL here:",
  "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
  "Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
  "Complete sign-in in your browser, or paste the authorization code / redirect URL here:",
  "Complete login in your browser, or paste the authorization code / redirect URL here:",
  "Exchanging authorization code for tokens...",
  "Exchanging authorization code for an API key...",
  "Listening for OpenRouter OAuth callback on http://localhost:3000/callback",
  "Could not listen on http://localhost:1455/auth/callback; paste the final redirect URL to continue. EADDRINUSE",
  "Complete Google sign-in. Pi captures the local callback automatically — or, on a remote/headless machine, paste the callback URL when prompted.",
  "Remote/headless machine (your browser can't reach localhost:51121)? After signing in, paste the full callback URL shown in your browser's address bar.",
  "Invalid callback (State mismatch). Please paste the full URL:",
  "A browser window should open. Complete login to finish.",
  "Select OpenAI Codex login method:",
  "Browser login (default)",
  "Device code login (headless)",
  "Continue in your browser.",
  "Sign in to Test:",
  "Sign in with browser (recommended)",
  "Sign in with device code (when signing in from another device)",
];
test("every supported provider interactive message has a translation, not a generic fallback", () => {
  for (const locale of locales.filter(item => item !== "en")) {
    for (const raw of interactive) {
      const result = piFeedback(locale, raw, "event");
      assert.notEqual(result.message, raw, `${locale}: ${raw}`);
      assert.doesNotMatch(
        result.message,
        /傳回新訊息|返回新消息|通知が届きました|알림을 보냈습니다/,
      );
    }
  }
  assert.match(piFeedback("zh-TW", "Sign-in code: CODE-123", "event").message, /CODE-123/);
  assert.match(piFeedback("ja", "Enter GitHub Copilot token", "prompt").message, /GitHub Copilot/);
});
test("all unknown SDK outputs get localized feedback and lossless original detail", () => {
  for (const locale of locales) {
    for (const context of [
      "event",
      "prompt",
      "error",
      "models",
      "generation",
    ] as PiFeedbackContext[]) {
      const raw =
        "New upstream message <script>not executable</script> https://example.test/?code=ABC";
      const result = piFeedback(locale, raw, context);
      assert.notEqual(result.message, raw);
      assert.equal(result.detail, raw);
    }
    const choice = piFeedback(locale, "New upstream choice", "option");
    assert.match(choice.message, /New upstream choice/);
    assert.equal(choice.detail, undefined);
  }
});
test("runtime and API failures are localized at every feedback boundary", () => {
  const failures = [
    "Connect this AI provider in settings before generating.",
    "The selected model is unavailable. Refresh the provider and choose a model.",
    "AI returned empty or oversized lesson output.",
    "Pi returned invalid lesson JSON. Retry from checkpoint.",
    "AI generation did not finish successfully. Reconnect if authorization expired, then retry this stage.",
    "HTTP 401 unauthorized",
    "HTTP 429 rate limit",
    "insufficient_quota",
    "fetch failed ECONNRESET",
    "Device flow timed out",
    "Device authorization was denied.",
    "Device authorization expired.",
    "Native Host disconnected.",
    "An Agent job is already running.",
    "This login prompt has expired.",
    "Error: Login cancelled.",
    "Invalid local AI installation ID.",
  ];
  for (const locale of locales.filter(item => item !== "en")) {
    for (const raw of failures) {
      assert.notEqual(piFeedback(locale, raw).message, raw);
      assert.notEqual(piFeedback(locale, raw, "models").message, raw);
      assert.notEqual(piFeedback(locale, raw, "generation").message, raw);
    }
  }
  assert.match(piFeedback("zh-TW", "HTTP 429 rate limit").message, /過於頻繁/);
  assert.match(piFeedback("zh-TW", "insufficient_quota").message, /額度/);
  assert.equal(piFeedback("ko", "HTTP 401 unauthorized").detail, "HTTP 401 unauthorized");
});
test("existing application feedback follows locale changes without replacing dynamic identifiers", () => {
  assert.equal(piFeedback("ja", piCopy["zh-TW"].cancelled).message, piCopy.ja.cancelled);
  assert.equal(
    piFeedback("zh-TW", translate("en", "statusProgress", { completed: 2, total: 10 })).message,
    translate("zh-TW", "statusProgress", { completed: 2, total: 10 }),
  );
  const result = piFeedback(
    "zh-TW",
    translate("en", "publishFailed", { message: "HTTP 429 rate limit" }),
  );
  assert.match(result.message, /過於頻繁/);
  assert.equal(result.detail, "HTTP 429 rate limit");
});

test("video reader connection failures show recovery without hiding it in diagnostics", () => {
  const raw = "影片分頁尚未載入擴充功能。請重新整理原本的影片分頁後重試，不必再開啟另一個分頁。";
  for (const locale of locales) {
    const result = piFeedback(locale, raw);
    assert.equal(result.detail, undefined);
    assert.notEqual(result.message, raw);
  }
  assert.match(piFeedback("zh-TW", raw).message, /重新整理正在播放影片的分頁/);
});

test("proactive playback recovery remains a direct video notification", () => {
  assert.deepEqual(piFeedback("zh-TW", "影片需要重新整理才能連接播放控制。", "event"), {
    message: "影片需要重新整理才能連接播放控制。",
  });
});
