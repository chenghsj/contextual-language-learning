import React from "react";
import type { UiLocale } from "../i18n/messages";
import { subtitleLayoutCopy } from "../i18n/subtitle-layout";
import { subtitleAcquisition } from "../i18n/subtitle-acquisition";
import { ActionFeedbackButton } from "./action-feedback-button";

export function VideoConnectionNotice({
  locale,
  hasSubtitles,
  failed,
}: {
  locale: UiLocale;
  hasSubtitles: boolean;
  failed: boolean;
}) {
  const copy = subtitleLayoutCopy[locale];
  const recovery = subtitleAcquisition[locale];
  return (
    <div
      role="status"
      data-ui="video-connection-notice"
      className="grid min-w-0 gap-1.5 text-xs leading-relaxed text-muted-foreground"
    >
      <p>{hasSubtitles ? copy.subtitlesPreserved : copy.reloadNeeded}</p>
      {failed && (
        <p role="alert" className="text-destructive">
          {recovery.reloadFailed}
        </p>
      )}
    </div>
  );
}

export function VideoConnectionReloadButton({
  locale,
  busy,
  disabled,
  onReload,
}: {
  locale: UiLocale;
  busy: boolean;
  disabled: boolean;
  onReload: () => void;
}) {
  return (
    <ActionFeedbackButton
      data-ui="video-reload-button"
      label={subtitleLayoutCopy[locale].reloadVideo}
      busyLabel={subtitleLayoutCopy[locale].reloadBusy}
      busy={busy}
      success={false}
      disabled={disabled}
      onClick={onReload}
    />
  );
}
