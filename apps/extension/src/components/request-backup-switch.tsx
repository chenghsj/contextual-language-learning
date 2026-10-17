import React, { useId } from "react";
import type { UiLocale } from "../i18n/messages";
import { backupSettingsCopy } from "../i18n/backup-settings";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

export function RequestBackupSwitch({
  locale,
  enabled,
  disabled,
  accessStatus,
  accountEmail,
  onChange,
  onSettings,
}: {
  locale: UiLocale;
  enabled: boolean;
  disabled: boolean;
  accessStatus: "disconnected" | "checking" | "verified" | "failed";
  accountEmail?: string;
  onChange(enabled: boolean): void;
  onSettings(): void;
}) {
  const ui = backupSettingsCopy(locale);
  const descriptionId = useId();
  const connected = accessStatus === "verified";
  const description = connected
    ? accountEmail || ui.requestHint
    : accessStatus === "checking"
      ? ui.requestChecking
      : accessStatus === "failed"
        ? ui.requestFailed
        : ui.requestUnavailable;
  return (
    <div
      data-ui="requestBackup"
      data-state={accessStatus}
      className="grid min-w-0 gap-1 border-t border-border pt-3"
    >
      <label className="flex min-w-0 items-center justify-between gap-3 text-xs leading-5">
        <span className="min-w-0">{ui.request}</span>
        <Switch
          aria-label={ui.request}
          aria-describedby={descriptionId}
          checked={enabled}
          disabled={disabled || !connected}
          onCheckedChange={onChange}
        />
      </label>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <p
          id={descriptionId}
          role="status"
          className="min-w-0 py-1.5 text-xs leading-5 text-muted-foreground wrap-anywhere"
        >
          {description}
        </p>
        <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={onSettings}>
          {connected ? ui.requestSettings : ui.settings}
        </Button>
      </div>
    </div>
  );
}
