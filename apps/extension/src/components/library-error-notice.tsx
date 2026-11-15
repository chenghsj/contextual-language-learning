import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { libraryNoticeCopy } from "../i18n/library-notice";
import { DriveAccountMismatchError } from "../lib/drive-reconnection";
import { Button } from "./ui/button";

export function LibraryErrorNotice({
  error,
  account,
  locale,
  busy,
  hasLocalContent,
  onRetry,
  onReconnect,
}: {
  error: string;
  account?: { id: string; email?: string };
  locale: UiLocale;
  busy: boolean;
  hasLocalContent: boolean;
  onRetry: () => void | Promise<void>;
  onReconnect: () => Promise<void>;
}) {
  const ui = libraryNoticeCopy(locale);
  const detailsId = useId();
  const titleId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState("");
  const [accountMismatch, setAccountMismatch] = useState<DriveAccountMismatchError | null>(null);
  const pending = useRef(false);
  const authExpired = /\binvalid_(?:grant|token)\b/i.test(error);
  useEffect(() => {
    setDetailsOpen(false);
    setReconnectError("");
    setAccountMismatch(null);
  }, [error, account?.id]);
  async function reconnect() {
    if (busy || pending.current) return;
    pending.current = true;
    setConnecting(true);
    setReconnectError("");
    setAccountMismatch(null);
    try {
      await onReconnect();
    } catch (cause) {
      if (cause instanceof DriveAccountMismatchError) setAccountMismatch(cause);
      else setReconnectError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setConnecting(false);
    }
  }
  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      data-ui="library-error"
      className="flex min-w-0 items-start gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-foreground"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="text-ui-heading font-semibold">
          {authExpired ? ui.authTitle : ui.title}
        </h3>
        {account && (
          <p className="mt-1 text-ui-body wrap-anywhere" data-ui="library-error-account">
            {ui.account.replace("{account}", account.email ?? account.id)}
          </p>
        )}
        <p className="mt-1 text-ui-body text-foreground/80">
          {authExpired ? ui.authDescription : ui.description}
          {hasLocalContent && <> {ui.localAvailable}</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-h-8 text-xs"
            disabled={busy || connecting}
            aria-busy={connecting}
            onClick={() => (authExpired ? void reconnect() : void onRetry())}
          >
            {authExpired
              ? connecting
                ? ui.reconnecting
                : account
                  ? ui.reconnectAccount
                  : ui.reconnect
              : ui.retry}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 min-h-8 gap-1 px-2 text-xs text-foreground/80"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen(value => !value)}
          >
            {detailsOpen ? ui.hideDetails : ui.details}
            <ChevronDown
              aria-hidden="true"
              className={"size-3.5 " + (detailsOpen ? "rotate-180" : "")}
            />
          </Button>
        </div>
        {(reconnectError || accountMismatch) && (
          <p role="status" className="mt-2 text-ui-body wrap-anywhere">
            {accountMismatch
              ? ui.accountMismatch
                  .replace("{actual}", accountMismatch.actual.email)
                  .replace(
                    "{expected}",
                    accountMismatch.expected.email ?? accountMismatch.expected.id,
                  )
              : ui.reconnectFailed}
          </p>
        )}
        {detailsOpen && (
          <pre
            id={detailsId}
            className="mt-2 border-t border-primary/20 pt-2 font-sans text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-foreground/80"
          >
            {reconnectError ? error + "\n\n" + reconnectError : error}
          </pre>
        )}
      </div>
    </section>
  );
}
