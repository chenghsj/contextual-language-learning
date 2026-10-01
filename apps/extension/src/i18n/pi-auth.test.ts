import test from "node:test";
import assert from "node:assert/strict";
import { piAuthMessage } from "./pi-auth";
import type { UiLocale } from "./messages";

test("authentication instructions, progress, prompts and choices cover every UI locale", () => {
  const messages = [
    "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.",
    "Complete login in your browser, or paste the final redirect URL here:",
    "Complete login in your browser, or paste the authorization code / redirect URL here:",
    "Open this link to sign in.",
    "Exchanging authorization code for tokens...",
    "Enabling models...",
    "Enter OpenAI API key",
    "Select OpenAI Codex login method:",
    "Browser login (default)",
    "Device code login (headless)",
    "Sign-in code: ABC-123",
    "This login prompt has expired.",
  ];
  for (const locale of ["zh-TW", "zh-CN", "ja", "ko"] as UiLocale[]) {
    for (const message of messages)
      assert.notEqual(piAuthMessage(locale, message), message, `${locale}: ${message}`);
    assert.ok(piAuthMessage(locale, "Sign-in code: ABC-123").includes("ABC-123"));
    assert.ok(piAuthMessage(locale, "Enter OpenAI API key").includes("OpenAI"));
  }
  for (const message of messages) assert.equal(piAuthMessage("en", message), message);
});
test("unknown diagnostic details and URLs remain intact", () => {
  const diagnostic = "HTTP 403: provider-specific diagnostic";
  assert.equal(piAuthMessage("zh-TW", diagnostic), diagnostic);
  assert.equal(
    piAuthMessage("ja", "https://example.test/?code=ABC"),
    "https://example.test/?code=ABC",
  );
});
