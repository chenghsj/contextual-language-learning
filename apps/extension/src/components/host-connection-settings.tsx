import { Disclosure } from "./disclosure";
import React, { useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { HOST_PROTOCOL_VERSION } from "@immersive/core";
import { hostConnectionCopy } from "../i18n/host-connection";
import { Button } from "./ui/button";
import { SelectField } from "./ui/select";

type OS = "macos" | "windows" | "linux";
type Browser = "chrome" | "edge" | "chromium";

function detectedOS(): OS {
  const ua = navigator.userAgent;
  return /Windows/i.test(ua) ? "windows" : /Macintosh|Mac OS/i.test(ua) ? "macos" : "linux";
}
function detectedBrowser(): Browser {
  const ua = navigator.userAgent;
  return /Edg\//.test(ua) ? "edge" : /Chromium/.test(ua) ? "chromium" : "chrome";
}

/** Browser registration and install commands use the current extension ID. */
export function HostConnectionSettings({
  locale,
  connected,
  checked,
  sdkMode,
  version,
  protocolVersion,
  busy,
  lastCheckedAt = null,
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
  error: string;
  onCheck: () => void;
}) {
  const ui = hostConnectionCopy[locale];
  const [os, setOS] = useState<OS>(detectedOS);
  const [browser, setBrowser] = useState<Browser>(detectedBrowser);
  const [copied, setCopied] = useState("");
  const [installMethod, setInstallMethod] = useState<"package" | "source">("source");
  const [uninstallCopied, setUninstallCopied] = useState("");
  const extensionId = chrome.runtime.id;
  const versionMatches = version === chrome.runtime.getManifest().version;
  const protocolMatches = protocolVersion === HOST_PROTOCOL_VERSION;
  const compatible = versionMatches && protocolMatches && sdkMode;
  const command =
    (installMethod === "package"
      ? "node scripts/install-host.mjs "
      : "pnpm build\npnpm host:install ") +
    extensionId +
    (browser === "chrome" ? "" : " --browser " + browser);
  const uninstallCommand =
    "node scripts/uninstall-host.mjs" + (browser === "chrome" ? "" : " --browser " + browser);
  async function copy(value: string, setFeedback = setCopied): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(ui.copied);
    } catch {
      setFeedback(ui.error);
    }
  }
  return (
    <section
      className="grid min-w-0 gap-2 rounded-[var(--radius)] border border-border px-[11px] py-[10px]"
      data-ui="hostConnection"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <strong className="text-xs">{ui.title}</strong>
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
      <Disclosure
        className="min-w-0 [&_h3>button]:py-2 [&_h3>button]:text-xs"
        title={<>{ui.name}</>}
      >
        <p className="mt-2 leading-relaxed">{ui.help}</p>
      </Disclosure>
      {connected && compatible && (
        <p className="text-xs text-muted-foreground">
          {ui.version}: {version}
        </p>
      )}
      {connected && !versionMatches && (
        <p className="text-xs text-destructive" role="status">
          {ui.mismatch} {ui.version}: {version ?? "unknown"}
        </p>
      )}
      {connected && versionMatches && !protocolMatches && (
        <p className="text-xs text-destructive" role="status">
          {ui.protocolMismatch}
        </p>
      )}
      {connected && versionMatches && protocolMatches && !sdkMode && (
        <p className="text-xs text-destructive" role="status">
          {ui.unsupportedMode}
        </p>
      )}
      {checked && (!connected || !compatible) && (
        <div className="grid min-w-0 gap-3">
          <strong className="text-xs">{ui.install}</strong>
          <label className="grid gap-1 text-xs">
            {ui.installMethod}
            <SelectField
              ariaLabel={ui.installMethod}
              value={installMethod}
              onValueChange={value => {
                if (value === "package" || value === "source") {
                  setInstallMethod(value);
                  setCopied("");
                }
              }}
              options={[
                { value: "package", label: ui.packageInstall },
                { value: "source", label: ui.sourceInstall },
              ]}
            />
          </label>
          {installMethod === "package" && (
            <label className="grid gap-1 text-xs">
              {ui.chooseOS}
              <SelectField
                ariaLabel={ui.chooseOS}
                value={os}
                onValueChange={value => setOS(value as OS)}
                options={[
                  { value: "macos", label: "macOS" },
                  { value: "windows", label: "Windows" },
                  { value: "linux", label: "Linux" },
                ]}
              />
            </label>
          )}
          <label className="grid gap-1 text-xs">
            {ui.chooseBrowser}
            <SelectField
              ariaLabel={ui.chooseBrowser}
              value={browser}
              onValueChange={value => {
                setBrowser(value as Browser);
                setCopied("");
                setUninstallCopied("");
              }}
              options={[
                { value: "chrome", label: "Chrome" },
                { value: "edge", label: "Edge" },
                { value: "chromium", label: "Chromium" },
              ]}
            />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {installMethod === "package" ? ui.steps : ui.sourceSteps}
          </p>
          {os !== "macos" && (
            <p
              className="text-xs leading-relaxed text-muted-foreground"
              data-ui="host-os-requirements"
            >
              {os === "windows" ? ui.windowsRequirements : ui.linuxRequirements}
            </p>
          )}
          {installMethod === "package" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void chrome.tabs.create({
                  url: "https://github.com/chenghsj/immersive-language-learning/releases",
                })
              }
            >
              {ui.releases} · {os}
            </Button>
          )}
          <div className="grid min-w-0 gap-1">
            <p className="text-xs font-semibold">
              {ui.commandLocation}:{" "}
              {installMethod === "package" ? ui.packageFolder : ui.projectFolder}
            </p>
            <code className="min-w-0 select-all whitespace-pre-wrap break-all border border-border p-2 text-xs">
              {command}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void copy(extensionId)}>
                {ui.copyID}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copy(command)}>
                {ui.copyCommand}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{ui.afterInstall}</p>
          <p className="text-xs text-muted-foreground">{ui.manual}</p>
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive break-all" role="status">
          {error}
        </p>
      )}
      {copied && (
        <p className="text-xs text-muted-foreground" role="status">
          {copied}
        </p>
      )}
      <Button variant="outline" size="sm" disabled={busy} aria-busy={busy} onClick={onCheck}>
        {busy && (
          <LoaderCircle
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {busy ? ui.checking : ui.check}
      </Button>
      {lastCheckedAt !== null && !busy && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.lastChecked}:{" "}
          <time dateTime={new Date(lastCheckedAt).toISOString()}>
            {new Date(lastCheckedAt).toLocaleTimeString(locale)}
          </time>
        </p>
      )}
      <Disclosure
        className="min-w-0 [&_h3>button]:py-2 [&_h3>button]:text-xs"
        title={ui.uninstall}
        data-ui="hostUninstall"
      >
        <div className="grid min-w-0 gap-2 pt-2">
          <p className="text-xs leading-relaxed">{ui.uninstallSteps}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{ui.uninstallEffects}</p>
          <label className="grid gap-1 text-xs">
            {ui.uninstallBrowser}
            <SelectField
              ariaLabel={ui.uninstallBrowser}
              value={browser}
              onValueChange={value => {
                setBrowser(value as Browser);
                setCopied("");
                setUninstallCopied("");
              }}
              options={[
                { value: "chrome", label: "Chrome" },
                { value: "edge", label: "Edge" },
                { value: "chromium", label: "Chromium" },
              ]}
            />
          </label>
          <code className="min-w-0 select-all whitespace-pre-wrap break-all border border-border p-2 text-xs">
            {uninstallCommand}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy(uninstallCommand, setUninstallCopied)}
          >
            {ui.copyUninstallCommand}
          </Button>
          {uninstallCopied && (
            <p className="text-xs text-muted-foreground" role="status">
              {uninstallCopied}
            </p>
          )}
        </div>
      </Disclosure>
    </section>
  );
}
