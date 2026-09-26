import { useState } from "react";
import type { UiLocale } from "../i18n/messages";
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
  return /Edg\//.test(ua) ? "edge" : /Chromium/.test(ua) && !/Chrome/.test(ua)
    ? "chromium" : "chrome";
}

/** Browser registration is per extension ID; installing new Agents does not change it. */
export function HostConnectionSettings({ locale, connected, checked, version, busy, error, onCheck }: {
  locale: UiLocale; connected: boolean; checked: boolean; version: string | null;
  busy: boolean; error: string; onCheck: () => void;
}) {
  const ui = hostConnectionCopy[locale];
  const [os, setOS] = useState<OS>(detectedOS);
  const [browser, setBrowser] = useState<Browser>(detectedBrowser);
  const [copied, setCopied] = useState("");
  const extensionId = chrome.runtime.id;
  const versionMatches = version === chrome.runtime.getManifest().version;
  const command = "node scripts/install-host.mjs " + extensionId +
    (browser === "chrome" ? "" : " --browser " + browser);
  async function copy(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setCopied(ui.copied); }
    catch { setCopied(ui.error); }
  }
  return <section className="grid min-w-0 gap-3 border border-border p-3" data-ui="hostConnection">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <strong className="text-sm">{ui.title}</strong>
      <span className={connected && versionMatches ? "text-xs text-primary" : "text-xs text-muted-foreground"}>
        {connected ? ui.connected : checked ? ui.disconnected : ui.checking}
      </span>
    </div>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{ui.name}</summary>
      <p className="mt-2 leading-relaxed">{ui.help}</p>
    </details>
    {connected && versionMatches && <p className="text-xs text-muted-foreground">
      {ui.version}: {version}</p>}
    {connected && !versionMatches && <p className="text-xs text-destructive" role="status">
      {ui.mismatch} {ui.version}: {version ?? "unknown"}</p>}
    {checked && (!connected || !versionMatches) && <div className="grid min-w-0 gap-3">
      <strong className="text-xs">{ui.install}</strong>
      <label className="grid gap-1 text-xs">{ui.chooseOS}
        <SelectField ariaLabel={ui.chooseOS} value={os} onValueChange={value => setOS(value as OS)}
          options={[{ value:"macos",label:"macOS" },{ value:"windows",label:"Windows" },
            { value:"linux",label:"Linux" }]} />
      </label>
      <label className="grid gap-1 text-xs">{ui.chooseBrowser}
        <SelectField ariaLabel={ui.chooseBrowser} value={browser} onValueChange={value => setBrowser(value as Browser)}
          options={[{ value:"chrome",label:"Chrome" },{ value:"edge",label:"Edge" },
            { value:"chromium",label:"Chromium" }]} />
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">{ui.steps}</p>
      <Button variant="outline" size="sm"
        onClick={() => void chrome.tabs.create({
          url:"https://github.com/chenghsj/immersive-language-learning/releases",
        })}>{ui.releases} · {os}</Button>
      <div className="grid min-w-0 gap-1">
        <code className="min-w-0 select-all break-all border border-border p-2 text-xs">{command}</code>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy(extensionId)}>{ui.copyID}</Button>
          <Button variant="outline" size="sm" onClick={() => void copy(command)}>{ui.copyCommand}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{ui.manual}</p>
    </div>}
    {error && <p className="text-xs text-destructive break-all" role="status">{error}</p>}
    {copied && <p className="text-xs text-muted-foreground" role="status">{copied}</p>}
    <Button variant="outline" size="sm" disabled={busy} onClick={onCheck}>{ui.check}</Button>
  </section>;
}
