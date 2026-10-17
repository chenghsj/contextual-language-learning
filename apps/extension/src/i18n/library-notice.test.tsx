import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryErrorNotice } from "../components/library-error-notice";
import { libraryNoticeCopy } from "./library-notice";

test("expired authorization explains the recovery without exposing diagnostics by default", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const ui = libraryNoticeCopy(locale);
    const html = renderToStaticMarkup(
      <LibraryErrorNotice
        locale={locale}
        error="Google OAuth Token 交換失敗（HTTP 400，invalid_grant）"
        account={{ id: "failed-account", email: "failed@example.test" }}
        busy={false}
        hasLocalContent
        onRetry={() => {}}
        onReconnect={async () => {}}
      />,
    );
    assert.ok(html.includes(ui.authTitle));
    assert.ok(html.includes(ui.reconnectAccount));
    assert.ok(html.includes("failed@example.test"));
    assert.ok(html.includes(ui.account.replace("{account}", "failed@example.test")));
    assert.ok(html.includes(ui.localAvailable));
    assert.equal(html.includes("invalid_grant"), false);
    assert.equal(html.includes("HTTP 400"), false);
  }
});

test("ordinary catalog errors offer retry and do not claim that local lessons exist", () => {
  const ui = libraryNoticeCopy("zh-TW");
  const html = renderToStaticMarkup(
    <LibraryErrorNotice
      locale="zh-TW"
      error="Disk read failed"
      busy={false}
      hasLocalContent={false}
      onRetry={() => {}}
      onReconnect={async () => {}}
    />,
  );
  assert.ok(html.includes(ui.title));
  assert.ok(html.includes(ui.retry));
  assert.equal(html.includes(ui.authTitle), false);
  assert.equal(html.includes(ui.localAvailable), false);
});
