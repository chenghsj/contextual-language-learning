import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { DriveAccount, JobSummary } from "@contextual/core";
import {
  DriveBackupSettings,
  type DriveBackupSettingsProps,
} from "../components/drive-backup-settings";

Object.assign(globalThis, { React });

test("backup permission retry appears only after failure while retaining its error", () => {
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
  assert.doesNotMatch(failed, /正在確認備份權限/);

  const rechecking = render({ verified: false, accessChecking: true, error });
  assert.match(rechecking, /正在確認備份權限…/);
  assert.doesNotMatch(rechecking, />重試</);

  for (const verified of [false, true]) {
    const settled = render({ verified, accessChecking: false, error: "" });
    assert.doesNotMatch(settled, />重試<|正在確認備份權限/);
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

  const disconnected = render([]);
  assert.match(disconnected, /自動備份新教材/);
  assert.match(disconnected, /連結 Google/);
  assert.doesNotMatch(disconnected, /data-ui="backupProgress"/);
});
