import React, { useState } from "react";
import type { SpeechDownloadTask } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { speechDownloadTaskCopy } from "../i18n/speech-download-task";
import { speechVoiceLanguageName } from "../i18n/speech-downloads";
import { useSpeechDownloads, useSpeechDownloadSnapshot } from "./speech-downloads-provider";
import { SpeechDownloadFeedback } from "./speech-download-feedback";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function DownloadActivityItem({
  task,
  locale,
  expanded,
  onViewVoice,
}: {
  task: SpeechDownloadTask;
  locale: UiLocale;
  expanded: boolean;
  onViewVoice: (task: SpeechDownloadTask) => void;
}) {
  const client = useSpeechDownloads();
  const snapshot = useSpeechDownloadSnapshot();
  const copy = speechDownloadTaskCopy[locale];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const progress = task.progress;
  const active = ["requesting", "waiting-system", "cancelling"].includes(progress.status);
  const status =
    progress.status === "waiting-system"
      ? copy.waitingSystem
      : progress.status === "requesting"
        ? copy.requesting
        : progress.status === "cancelling"
          ? copy.cancelling
          : progress.status === "completed"
            ? copy.completed
            : progress.status === "cancelled"
              ? copy.cancelled
              : copy.failed;
  const reason =
    progress.status === "failed"
      ? progress.reason === "rejected"
        ? copy.rejected
        : progress.reason === "resource-unavailable"
          ? copy.resourceUnavailable
          : copy.subscriptionLost
      : progress.status === "cancelled" && progress.shared
        ? copy.sharedCancelled
        : "";
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : copy.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AccordionItem
      value={`download:${task.id}`}
      data-ui="downloadActivityItem"
      className="min-w-0 border-border [&_p]:my-1"
    >
      <AccordionTrigger className="min-w-0 items-start gap-2 py-3 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 [&>svg]:mt-0.5">
        <span className="grid min-w-0 flex-1 gap-2 text-left">
          <span className="line-clamp-2 min-w-0 break-words text-ui-heading font-semibold">
            {task.voice.name}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge className="shrink-0 gap-1.5 whitespace-nowrap text-ui-meta leading-4">
              {active && (
                <span aria-hidden="true" className="inline-flex">
                  <SpeechDownloadFeedback task={task} locale={locale} service={snapshot.service} />
                </span>
              )}
              {status}
            </Badge>
            <span className="min-w-0 break-words text-xs font-normal leading-4 text-muted-foreground">
              {copy.title} · {speechVoiceLanguageName(task.voice.language, locale)}
            </span>
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent
        forceMount
        hidden={!expanded}
        data-ui="downloadActivityDetails"
        className="min-w-0 pb-3 text-ui-body"
      >
        {reason && (
          <p role={progress.status === "failed" ? "alert" : "status"} className="break-words">
            {reason}
          </p>
        )}
        {task.observation.kind === "reconciling" && (
          <p className="text-muted-foreground">{copy.reconciling}</p>
        )}
        {task.observation.kind === "unavailable" && (
          <p role="alert" className="break-words text-destructive">
            {copy.unavailable}
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-destructive">
            {error}
          </p>
        )}
        <div
          data-ui="actions"
          className="mt-2 flex flex-wrap items-center gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:whitespace-normal"
        >
          {active && progress.status !== "cancelling" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action(() => client.cancel(task.id))}
            >
              {copy.cancel}
            </Button>
          )}
          {(progress.status === "failed" || progress.status === "cancelled") && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action(() => client.retry(task.id))}
            >
              {copy.retry}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onViewVoice(task)}>
            {copy.viewVoice}
          </Button>
          {!active && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void action(() => client.clearEnded([task.id]))}
            >
              {copy.clear}
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
