import { Disclosure } from "./disclosure";
import React from "react";
import { ActionFeedbackButton } from "./action-feedback-button";
import type { UiLocale } from "../i18n/messages";
import { HOST_PROTOCOL_VERSION } from "@contextual/core";
import { hostConnectionCopy } from "../i18n/host-connection";
import { Button } from "./ui/button";

/** Public setup uses a packaged installer; developer commands live in documentation. */
export function HostConnectionSettings({
  locale,
  connected,
  checked,
  sdkMode,
  version,
  protocolVersion,
  busy,
  lastCheckedAt = null,
  checkSuccess = false,
  error,
  onCheck,
}: {
  locale: UiLocale;
  connected: boolean;
  checked: boolean;
  sdkMode: boolean;
  version: string | null;
  protocolVersion: number | null;
  busy: boolean;
  lastCheckedAt?: number | null;
  checkSuccess?: boolean;
  error: string;
  onCheck: () => void;
}) {
  const ui = hostConnectionCopy[locale];
  const downloadUrl = import.meta.env?.VITE_HOST_SETUP_DOWNLOAD_URL ?? "";
  const versionMatches = version === chrome.runtime.getManifest().version;
  const protocolMatches = protocolVersion === HOST_PROTOCOL_VERSION;
  const compatible = versionMatches && protocolMatches && sdkMode;
  return (
    <section
      className="grid min-w-0 gap-2 rounded-[var(--radius)] border border-border px-[11px] py-[10px]"
      data-ui="hostConnection"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <strong className="text-ui-heading font-semibold">{ui.title}</strong>
        <span
          role="status"
          className={
            !busy && connected && compatible
              ? "text-xs text-primary"
              : "text-xs text-muted-foreground"
          }
        >
          {busy
            ? ui.checking
            : connected
              ? compatible
                ? ui.connected
                : ui.updateNeeded
              : checked
                ? ui.disconnected
                : ui.checking}
        </span>
      </div>
      <Disclosure className="min-w-0" triggerClassName="py-2" title={<>{ui.name}</>}>
        <p className="mt-2 leading-relaxed">{ui.help}</p>
      </Disclosure>
      {connected && compatible && (
        <p className="text-xs text-muted-foreground">
          {ui.version}: {version}
        </p>
      )}
      {connected && !versionMatches && (
        <p className="text-ui-body text-destructive" role="status">
          {ui.mismatch} {ui.version}: {version ?? "unknown"}
        </p>
      )}
      {connected && versionMatches && !protocolMatches && (
        <p className="text-ui-body text-destructive" role="status">
          {ui.protocolMismatch}
        </p>
      )}
      {connected && versionMatches && protocolMatches && !sdkMode && (
        <p className="text-ui-body text-destructive" role="status">
          {ui.unsupportedMode}
        </p>
      )}
      {checked && (!connected || !compatible) && (
        <div className="grid min-w-0 gap-3">
          <strong className="text-ui-heading font-semibold">{ui.install}</strong>
          <p className="text-ui-body text-muted-foreground">
            {downloadUrl ? ui.installerSteps : ui.localInstallerSteps}
          </p>
          {downloadUrl && (
            <Button size="sm" onClick={() => void chrome.tabs.create({ url: downloadUrl })}>
              {connected ? ui.downloadUpdate : ui.downloadInstaller}
            </Button>
          )}
          <p className="text-ui-body text-muted-foreground">{ui.installerAfterInstall}</p>
        </div>
      )}
      {error && (
        <p className="text-ui-body text-destructive break-all" role="status">
          {error}
        </p>
      )}
      <ActionFeedbackButton
        label={ui.check}
        busyLabel={ui.checking}
        successLabel={ui.connected}
        busy={busy}
        success={checkSuccess && connected && compatible}
        disabled={busy}
        feedbackKey={lastCheckedAt ?? undefined}
        onClick={onCheck}
        data-ui="host-check-button"
      />
      {lastCheckedAt !== null && !busy && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.lastChecked}:{" "}
          <time dateTime={new Date(lastCheckedAt).toISOString()}>
            {new Date(lastCheckedAt).toLocaleTimeString(locale)}
          </time>
        </p>
      )}
      <Disclosure
        className="min-w-0"
        triggerClassName="py-2"
        title={ui.uninstall}
        data-ui="hostUninstall"
      >
        <div className="grid min-w-0 gap-2 pt-2">
          <p className="text-ui-body">{ui.installerUninstall}</p>
          <p className="text-ui-body text-muted-foreground">{ui.uninstallEffects}</p>
        </div>
      </Disclosure>
    </section>
  );
}
