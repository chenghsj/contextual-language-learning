import React, { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UiLocale } from "../i18n/messages";
import type { usePlatformVideoNotice } from "../hooks/use-platform-video-notice";
import { contextualReaderMessages } from "../i18n/contextual-reader";
import { subtitleAcquisition } from "../i18n/subtitle-acquisition";
import { Button } from "./ui/button";
import { PiFeedback } from "./pi-feedback";
import { Toaster } from "./ui/sonner";

const NOTICE_ID = "app-notice";

/** Bridge existing application feedback to the shadcn/ui Sonner viewport. */
export function NoticeViewport({
  error,
  notice,
  dismiss,
  closeLabel,
  regionLabel,
  theme,
  locale,
  videoRecovery,
}: {
  videoRecovery?: ReturnType<typeof usePlatformVideoNotice>;
  locale?: UiLocale;
  error: string;
  notice: string;
  dismiss: () => void;
  closeLabel: string;
  regionLabel: string;
  theme: "light" | "dark";
}) {
  const latest = useRef({ error, notice, dismiss });
  latest.current = { error, notice, dismiss };

  useEffect(() => {
    const message = error || notice;
    if (!message) {
      toast.dismiss(NOTICE_ID);
      return;
    }
    const onDismiss = () => {
      if (latest.current.error === error && latest.current.notice === notice) {
        latest.current.dismiss();
      }
    };
    const options = {
      id: NOTICE_ID,
      className: "app-notice",
      style: { height: "auto" },
      duration: Infinity,
      onDismiss,
    };
    if (error)
      toast.error(locale ? <PiFeedback locale={locale} message={message} /> : message, options);
    else
      toast(
        locale ? <PiFeedback locale={locale} message={message} context="event" /> : message,
        options,
      );
  }, [error, notice, locale]);

  const recoveryCopy = subtitleAcquisition[locale ?? "en"];
  const recoveryMessage = contextualReaderMessages[locale ?? "en"].reloadRequired;
  useEffect(() => {
    const id = "video-recovery";
    if (!videoRecovery?.recovery) {
      toast.dismiss(id);
      return;
    }
    toast(
      <div className="grid gap-2 text-xs">
        <p>{recoveryMessage}</p>
        {videoRecovery.failed && (
          <p className="text-destructive" role="status">
            {recoveryCopy.reloadFailed}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-fit text-xs"
          disabled={videoRecovery.busy}
          onClick={() => void videoRecovery.reload()}
        >
          {videoRecovery.busy ? recoveryCopy.reloadingTab : recoveryCopy.reloadTab}
        </Button>
      </div>,
      {
        id,
        duration: Infinity,
        className: "app-notice",
        style: { height: "auto" },
        onDismiss: videoRecovery.dismiss,
      },
    );
  }, [
    videoRecovery?.recovery,
    videoRecovery?.busy,
    videoRecovery?.failed,
    videoRecovery?.reload,
    videoRecovery?.dismiss,
    recoveryCopy,
    recoveryMessage,
  ]);

  return (
    <Toaster
      theme={theme}
      position="top-center"
      visibleToasts={1}
      closeButton
      customAriaLabel={regionLabel}
      toastOptions={{ closeButtonAriaLabel: closeLabel }}
    />
  );
}
