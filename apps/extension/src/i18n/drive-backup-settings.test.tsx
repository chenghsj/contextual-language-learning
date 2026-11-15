import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { libraryNoticeCopy } from "./library-notice";
import { renderToStaticMarkup } from "react-dom/server";
import type { DriveAccount, JobSummary } from "@contextual/core";
import {
  DriveBackupSettings,
  type DriveBackupSettingsProps,
} from "../components/drive-backup-settings";

Object.assign(globalThis, { React });

test("unknown or failed account reads never claim the Host is missing OAuth", () => {
  const props: DriveBackupSettingsProps = {
    locale: "zh-TW",
    backup: { enabled: false },
    accounts: [],
    configured: null,
    verified: false,
    accessChecking: false,
    busy: false,
    error: "",
    folderUrl: null,
    jobs: [],
    phase: null,
    onEnabled() {},
    onAccount() {},
    onConnect() {},
    onDisconnect() {},
    onRetryAccess() {},
    onOpenFolder() {},
    onBackup() {},
    onRetryFailed() {},
    onRetryAccounts() {},
  };
  const loading = renderToStaticMarkup(<DriveBackupSettings {...props} accountsLoading />);
  assert.match(loading, /正在讀取 Google 帳號/);
  assert.doesNotMatch(loading, /尚未設定 Google OAuth/);
  const failed = renderToStaticMarkup(
    <DriveBackupSettings {...props} accountsError="本機服務連線中斷" />,
  );
  assert.match(failed, /本機服務連線中斷/);
  assert.match(failed, />重試<\/button>/);
  assert.doesNotMatch(failed, /尚未設定 Google OAuth/);
  const unconfigured = renderToStaticMarkup(<DriveBackupSettings {...props} configured={false} />);
  assert.match(unconfigured, /尚未設定 Google OAuth/);
  const recovered = renderToStaticMarkup(<DriveBackupSettings {...props} configured />);
  assert.doesNotMatch(recovered, /尚未設定 Google OAuth|>重試<\/button>/);
  assert.match(recovered, />連結 Google 帳號<\/button>/);
});

test("unverified backup access always has recovery actions, including after OAuth cancellation", () => {
  const render = (state: Pick<DriveBackupSettingsProps, "verified" | "accessChecking" | "error">) =>
    renderToStaticMarkup(
      <DriveBackupSettings
        locale="zh-TW"
        backup={{ enabled: false, accountId: "account" }}
        accounts={[{ id: "account", email: "account@example.test" }]}
        configured
        busy={false}
        folderUrl={null}
        jobs={[]}
        phase={null}
        onEnabled={() => {}}
        onAccount={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRetryAccess={() => {}}
        onReconnect={() => {}}
        onOpenFolder={() => {}}
        onBackup={() => {}}
        onRetryFailed={() => {}}
        {...state}
      />,
    );

  const checking = render({ verified: false, accessChecking: true, error: "" });
  assert.match(checking, /正在確認備份權限…/);
  assert.doesNotMatch(checking, />重試<|重新檢查/);

  const error = "驗證 Drive 權限失敗（HTTP 403，insufficientPermissions）。";
  const failed = render({ verified: false, accessChecking: false, error });
  assert.match(failed, />重試<\/button>/);
  assert.ok(failed.includes(error));
  assert.match(failed, />重新連結 Google 帳號<\/button>/);
  assert.doesNotMatch(failed, /正在確認備份權限/);

  const rechecking = render({ verified: false, accessChecking: true, error });
  assert.match(rechecking, /正在確認備份權限…/);
  assert.doesNotMatch(rechecking, />重試</);
  assert.doesNotMatch(rechecking, />重新連結 Google 帳號<\/button>/);

  for (const verified of [false, true]) {
    const settled = render({ verified, accessChecking: false, error: "" });
    assert.doesNotMatch(settled, /正在確認備份權限/);
    if (verified) assert.doesNotMatch(settled, />重試</);
    else {
      assert.match(settled, />重試<\/button>/);
      assert.match(settled, />重新連結 Google 帳號<\/button>/);
    }
  }
});

test("disconnecting the last Drive account keeps settings and the reconnect action visible", () => {
  const fields = {
    provider: "openai",
    completed: 1,
    total: 1,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
  const jobs: JobSummary[] = [
    {
      ...fields,
      id: "local-lesson",
      sourceTitle: "Local lesson without backup",
      status: "completed",
    },
    {
      ...fields,
      id: "backed-up-lesson",
      sourceTitle: "Previously backed up lesson",
      status: "completed",
      backup: {
        accountId: "removed-account",
        status: "failed",
        updatedAt: fields.updatedAt,
      },
    },
  ];
  const render = (accounts: DriveAccount[]) =>
    renderToStaticMarkup(
      <DriveBackupSettings
        locale="zh-TW"
        backup={{ enabled: false }}
        accounts={accounts}
        configured
        verified={false}
        accessChecking={false}
        busy={false}
        error=""
        folderUrl={null}
        jobs={jobs}
        phase={null}
        onEnabled={() => {}}
        onAccount={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRetryAccess={() => {}}
        onOpenFolder={() => {}}
        onBackup={() => {}}
        onRetryFailed={() => {}}
      />,
    );

  const connected = render([{ id: "removed-account", email: "account@example.test" }]);
  assert.match(connected, /account@example.test/);
  assert.match(connected, /1 份備份失敗/);
  assert.doesNotMatch(connected, /backup-existing-button|backup-retry-button/);

  const disconnected = render([]);
  assert.match(disconnected, /自動備份新教材/);
  assert.match(disconnected, /連結 Google/);
  assert.doesNotMatch(disconnected, /data-ui="backupProgress"/);
});

test("backup OAuth expiry uses localized recovery copy and hides diagnostics initially", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const html = renderToStaticMarkup(
      <DriveBackupSettings
        locale={locale}
        backup={{ enabled: false, accountId: "account" }}
        accounts={[{ id: "account", email: "account@example.test" }]}
        configured
        verified={false}
        accessChecking={false}
        busy={false}
        error="Google OAuth Token 交換失敗（HTTP 400，invalid_grant）。授權碼可能已失效或被使用。"
        folderUrl={null}
        jobs={[]}
        phase={null}
        onEnabled={() => {}}
        onAccount={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onRetryAccess={() => {}}
        onReconnect={() => {}}
        onOpenFolder={() => {}}
        onBackup={() => {}}
        onRetryFailed={() => {}}
      />,
    );
    const copy = libraryNoticeCopy(locale);
    assert.ok(html.includes(copy.authDescription));
    assert.ok(html.includes(copy.details));
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /invalid_grant|HTTP 400|Token 交換|授權碼/);
  }
});
