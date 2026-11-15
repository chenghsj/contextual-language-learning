import React, { useEffect, useState } from "react";
import type { UiLocale } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { sendTestNotification } from "../native/analysis-notifications";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

export function NotificationSettings({
  locale,
  completed,
  attention,
  onCompleted,
  onAttention,
}: {
  locale: UiLocale;
  completed: boolean;
  attention: boolean;
  onCompleted: (enabled: boolean) => void;
  onAttention: (enabled: boolean) => void;
}) {
  const ui = settingsLayoutCopy[locale];
  const [permission, setPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; success: boolean } | null>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if (!status?.success) return;
    const timer = window.setTimeout(() => setStatus(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    let active = true;
    const check = () =>
      void chrome.notifications
        .getPermissionLevel()
        .then(value => {
          if (active) setPermission(value);
        })
        .catch(() => {
          if (active) setPermission("unknown");
        });
    check();
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
    };
  }, []);
  async function test(): Promise<void> {
    setBusy(true);
    setStatus(null);
    try {
      const level = await chrome.notifications.getPermissionLevel();
      setPermission(level);
      if (level !== "granted") {
        setStatus({ message: ui.testFailed, success: false });
        setHelp(true);
        return;
      }
      await sendTestNotification(locale);
      setStatus({ message: ui.testSent, success: true });
    } catch {
      setStatus({ message: ui.testFailed, success: false });
      setHelp(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="grid min-w-0 gap-3 border-t border-border pt-4"
      aria-labelledby="notification-heading"
    >
      <h3 id="notification-heading" className="text-ui-heading font-semibold">
        {ui.notifications}
      </h3>
      {[
        {
          id: "analysis-notifications",
          enabled: completed,
          label: ui.completed,
          hint: ui.completedHint,
          change: onCompleted,
        },
        {
          id: "attention-notifications",
          enabled: attention,
          label: ui.attention,
          hint: ui.attentionHint,
          change: onAttention,
        },
      ].map(item => (
        <div key={item.id} className="flex min-h-11 items-center justify-between gap-3">
          <div>
            <label htmlFor={item.id} className="text-xs font-semibold">
              {item.label}
            </label>
            <p
              id={item.id + "-hint"}
              className="mt-1 text-ui-label leading-relaxed text-muted-foreground"
            >
              {item.hint}
            </p>
          </div>
          <Switch
            id={item.id}
            checked={item.enabled}
            aria-describedby={item.id + "-hint"}
            onCheckedChange={item.change}
          />
        </div>
      ))}
      {(completed || attention) && permission !== "granted" && (
        <p role="status" className="text-ui-body text-destructive">
          {permission === "denied" ? ui.denied : ui.permissionUnknown}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} aria-busy={busy} onClick={() => void test()}>
          <span className="inline-grid">
            <span className="invisible col-start-1 row-start-1" aria-hidden="true">
              {ui.test}
            </span>
            <span className="col-start-1 row-start-1" aria-live="polite" aria-atomic="true">
              {busy ? ui.testSending : status?.success ? ui.testSent : ui.test}
            </span>
          </span>
        </Button>
        <Button variant="ghost" onClick={() => setHelp(value => !value)} aria-expanded={help}>
          {ui.help}
        </Button>
      </div>
      {help && <p className="text-ui-body text-muted-foreground">{ui.permissionHelp}</p>}
      {status && !status.success && (
        <p role="status" className="text-ui-body text-destructive">
          {status.message}
        </p>
      )}
    </section>
  );
}
