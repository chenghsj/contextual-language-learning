import React from "react";
import { LoaderCircle } from "lucide-react";
import {
  isSpeechDownloadActive,
  type SpeechDownloadSnapshot,
  type SpeechDownloadTask,
} from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { speechDownloadTaskCopy } from "../i18n/speech-download-task";

export function SpeechDownloadFeedback({
  task,
  locale,
  service,
}: {
  task: SpeechDownloadTask;
  locale: UiLocale;
  service: SpeechDownloadSnapshot["service"];
}) {
  if (!isSpeechDownloadActive(task)) return null;
  const copy = speechDownloadTaskCopy[locale];
  const unavailable =
    service === "unavailable" ||
    service === "storage-error" ||
    task.observation.kind === "unavailable";
  const status = unavailable
    ? copy.checkPaused
    : task.progress.status === "cancelling"
      ? copy.cancelling
      : task.progress.status === "requesting"
        ? copy.requesting
        : copy.waitingSystem;
  const checkedAt = task.observation.kind === "fresh" ? task.observation.checkedAt : null;
  return (
    <span
      data-ui="speechDownloadFeedback"
      className="inline-flex shrink-0 items-center text-muted-foreground"
      title={
        checkedAt ? `${copy.lastChecked} ${new Date(checkedAt).toLocaleString(locale)}` : status
      }
      role="img"
      aria-label={`${task.voice.name} · ${status}`}
    >
      <LoaderCircle
        aria-hidden="true"
        className={
          unavailable ? "size-3.5 opacity-40" : "size-3.5 animate-spin motion-reduce:animate-none"
        }
      />
    </span>
  );
}
