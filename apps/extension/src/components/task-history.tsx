import { createFlowCopy } from "../i18n/create-flow";
import { customContentCopy } from "../i18n/custom-content";
import { layoutText, sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { PageSection } from "./page-section";
import React, { useEffect, useRef, useState } from "react";
import { isPiProviderId, type AgentInfo, type JobSummary } from "@immersive/core";
import { agentDisplayName } from "../i18n/agent-display";
import { piCopy } from "../i18n/pi";
import type { UiLocale, MessageKey, MessageParams } from "../i18n/messages";
import { PiFeedback } from "./pi-feedback";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { SelectField } from "./ui/select";
import { IconTooltip } from "./icon-tooltip";
import { RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Props = {
  locale?: UiLocale;
  onConfigure?: () => void;
  jobs: JobSummary[];
  loadingJobs: boolean;
  hostReady: boolean;
  generating: boolean;
  storageBusy: boolean;
  agentCatalog: AgentInfo[];
  t: (key: MessageKey, params?: MessageParams) => string;
  onRefresh: () => void;
  onResume: (id: string) => void;
  onCancel?: (job: JobSummary) => void;
  onOpen: (id: string) => void;
  onDetails?: (job: JobSummary) => void | Promise<void>;
  onRetryPublication: (id: string) => Promise<void>;
  onRetryBackup: (id: string) => Promise<void>;
  onListEnded?: () => Promise<JobSummary[]>;
  onDeleteRecords?: (
    ids: string[],
  ) => Promise<{ deleted: string[]; failed: { jobId: string; message: string }[] }>;
};
export const jobStatusKeys: Record<JobSummary["status"], MessageKey> = {
  queued: "jobQueued",
  running: "jobRunning",
  waiting: "jobWaiting",
  completed: "jobCompleted",
  failed: "jobFailed",
  cancelled: "jobCancelled",
};

export type JobFilter = "all" | "active" | "failed" | "completed" | "cancelled";

export function matchesJobFilter(status: JobSummary["status"], filter: JobFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active")
    return status === "queued" || status === "running" || status === "waiting";
  return status === filter;
}

export function taskHistoryError(error: unknown, t: Props["t"], fallback: MessageKey): string {
  if (!(error instanceof Error)) return t(fallback);
  if (/Invalid discriminator value|Unsupported Native Host request/i.test(error.message)) {
    return t("taskHistoryHostUpdate");
  }
  return error.message;
}

/** Activity owns task filtering, paging and recovery actions. */
export function TaskHistory({
  jobs,
  loadingJobs,
  hostReady,
  generating,
  storageBusy,
  agentCatalog,
  locale = "en",
  onConfigure,
  t,
  onRefresh,
  onResume,
  onCancel,
  onOpen,
  onDetails,
  onRetryPublication,
  onRetryBackup,
  onListEnded,
  onDeleteRecords,
}: Props) {
  const ux = createFlowCopy(locale);
  const queued = jobs
    .filter(job => job.status === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const customUi = customContentCopy(locale);
  const phaseLabel = (job: JobSummary) =>
    job.kind === "custom" && job.phase === "selecting"
      ? customUi.merge
      : job.kind === "custom" && job.phase === "creating"
        ? customUi.segments
        : job.phase
          ? flow[job.phase]
          : "";
  const ui = piCopy[locale];
  const flow = sidePanelLayoutCopy[locale];
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [endedJobs, setEndedJobs] = useState<JobSummary[]>([]);
  const [confirmation, setConfirmation] = useState<{ jobs: JobSummary[]; batch: boolean } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [loadingEnded, setLoadingEnded] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [listError, setListError] = useState("");
  const [refreshEnded, setRefreshEnded] = useState(0);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const canDelete = !!onListEnded && !!onDeleteRecords;
  useEffect(() => {
    if (!hostReady || !onListEnded) return;
    let live = true;
    setLoadingEnded(true);
    setListError("");
    void onListEnded()
      .then(items => {
        if (live) setEndedJobs(items);
      })
      .catch(error => {
        if (live) setListError(taskHistoryError(error, t, "loadJobRecordsError"));
      })
      .finally(() => {
        if (live) setLoadingEnded(false);
      });
    return () => {
      live = false;
    };
  }, [hostReady, onListEnded, jobs, refreshEnded, t]);
  const openConfirmation = (items: JobSummary[], batch: boolean) => {
    focusReturnRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteError("");
    setConfirmation({ jobs: items, batch });
  };
  const deleteConfirmed = async () => {
    if (!confirmation || !onDeleteRecords || busyRef.current) return;
    busyRef.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await onDeleteRecords(confirmation.jobs.map(job => job.id));
      const removed = new Set(result.deleted);
      setEndedJobs(previous => previous.filter(job => !removed.has(job.id)));
      setRefreshEnded(value => value + 1);
      if (result.failed.length) {
        setConfirmation(
          previous =>
            previous && { ...previous, jobs: previous.jobs.filter(job => !removed.has(job.id)) },
        );
        setDeleteError(
          t("partialJobDeletion", {
            deleted: result.deleted.length,
            failed: result.failed.length,
          }) +
            " " +
            result.failed.map(item => item.message).join("; "),
        );
      } else setConfirmation(null);
    } catch (error) {
      setDeleteError(taskHistoryError(error, t, "deleteJobRecordsError"));
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
  };
  const filteredJobs = jobs.filter(job => matchesJobFilter(job.status, jobFilter));
  const selectedJobs = showAllJobs
    ? filteredJobs
    : jobFilter === "all"
      ? [
          ...filteredJobs.filter(job => job.status !== "completed"),
          ...filteredJobs.filter(job => job.status === "completed").slice(0, 3),
        ]
      : filteredJobs.slice(0, 3);
  const visibleJobs = [...selectedJobs].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  const dayLabel = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return date.toDateString() === today.toDateString()
      ? flow.today
      : date.toDateString() === yesterday.toDateString()
        ? flow.yesterday
        : date.toLocaleDateString(locale);
  };
  return (
    <PageSection>
      <div>
        <div className="flex min-w-0 items-center gap-2" data-ui="taskHistoryControls">
          <SelectField
            ariaLabel={t("jobFilterLabel")}
            value={jobFilter}
            onValueChange={value => {
              setJobFilter(value as JobFilter);
              setShowAllJobs(false);
            }}
            className="h-8 flex-1 text-xs"
            options={[
              { value: "all", label: t("jobFilterAll") },
              { value: "active", label: t("jobFilterActive") },
              { value: "completed", label: t("jobFilterCompleted") },
              { value: "failed", label: t("jobFailed") },
              { value: "cancelled", label: t("jobCancelled") },
            ]}
          />
          <IconTooltip label={t("refreshJobs")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={loadingJobs}
              aria-busy={loadingJobs}
              onClick={onRefresh}
            >
              <RefreshCw
                aria-hidden="true"
                className={loadingJobs ? "animate-spin motion-reduce:animate-none" : undefined}
              />
              <span className="sr-only">{t("refreshJobs")}</span>
            </Button>
          </IconTooltip>
        </div>
        <div className="mt-2">
          <div className="my-[10px] grid gap-[7px]">
            {!loadingJobs && !visibleJobs.length && (
              <p className="text-xs text-muted-foreground">{flow.activityEmpty}</p>
            )}
            {visibleJobs.map((job, index) => (
              <React.Fragment key={job.id}>
                {(index === 0 ||
                  new Date(visibleJobs[index - 1].updatedAt).toLocaleDateString() !==
                    new Date(job.updatedAt).toLocaleDateString()) && (
                  <h3 className="mt-2 text-[11px] font-medium text-muted-foreground">
                    {dayLabel(job.updatedAt)}
                  </h3>
                )}
                <div
                  className="min-w-0 border-b border-border px-0 py-2.5 [&_p]:my-[3px] [&_p]:text-xs [&_[data-ui=actions]]:mt-[5px] [&_[data-ui=actions]]:gap-[5px] [&_[data-ui=actions]_button]:h-auto [&_[data-ui=actions]_button]:min-h-7"
                  key={job.id}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2 [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-[13px]">
                    <strong className="min-w-0 flex-1 truncate" title={job.sourceTitle}>
                      {job.sourceTitle}
                    </strong>
                    <Badge className="shrink-0 whitespace-nowrap text-[11px] leading-4">
                      {t(jobStatusKeys[job.status])}
                    </Badge>
                  </div>
                  <p
                    className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground"
                    data-ui="hint"
                  >
                    {agentDisplayName(
                      job.provider,
                      agentCatalog.find(item => item.id === job.provider)?.label,
                    )}{" "}
                    ·{" "}
                    {layoutText(flow.completedSteps, {
                      completed: job.completed,
                      total: job.total,
                    })}
                    {job.backup &&
                      " · " +
                        t(
                          job.backup.status === "backed-up"
                            ? "backupSaved"
                            : ["pending", "uploading"].includes(job.backup.status)
                              ? "backupProcessing"
                              : "backupFailedMessage",
                        )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.status === "completed"
                      ? layoutText(flow.completedAt, {
                          time: new Date(job.updatedAt).toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })
                      : job.phase
                        ? job.status === "cancelled"
                          ? layoutText(flow.cancelledAtPhase, { phase: phaseLabel(job) })
                          : phaseLabel(job)
                        : new Date(job.updatedAt).toLocaleTimeString(locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                  </p>
                  {job.status === "queued" && (
                    <p>
                      {ux.queued}: {queued.findIndex(item => item.id === job.id) + 1}
                    </p>
                  )}
                  {job.retry && (
                    <p role="status">
                      {ux.retrying} {job.retry.attempt}/2 · {Math.ceil(job.retry.delayMs / 1000)}s ·{" "}
                      {job.retry.reason}
                    </p>
                  )}
                  {job.status === "running" && (
                    <p className="text-muted-foreground">{ux.cancelHint}</p>
                  )}
                  {job.error && (
                    <PiFeedback locale={locale} message={job.error} context="generation" />
                  )}
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:max-w-full"
                    data-ui="actions"
                  >
                    {onDetails && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!hostReady}
                        onClick={() => void onDetails(job)}
                      >
                        {customUi.details}
                      </Button>
                    )}
                    {["waiting", "failed", "cancelled"].includes(job.status) &&
                      (!isPiProviderId(job.provider) ? (
                        <p className="text-muted-foreground">{ui.legacy}</p>
                      ) : !agentCatalog.some(item => item.id === job.provider && item.installed) ? (
                        <div className="grid gap-2">
                          <p className="text-muted-foreground">{ui.resumeConnect}</p>
                          {onConfigure && (
                            <Button variant="outline" size="sm" onClick={onConfigure}>
                              {ui.connect}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!hostReady || deleting}
                          onClick={() => onResume(job.id)}
                        >
                          {t("resume")}
                        </Button>
                      ))}
                    {onCancel && ["queued", "running", "waiting"].includes(job.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!hostReady}
                        onClick={() => onCancel(job)}
                      >
                        {t("cancel")}
                      </Button>
                    )}
                    {job.documentId && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onOpen(job.documentId!)}>
                          {t("openLesson")}
                        </Button>
                        {job.publication && job.publication.status !== "published" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={storageBusy}
                            onClick={() => void onRetryPublication(job.id)}
                          >
                            {t("retryPublish")}
                          </Button>
                        )}
                        {job.backup && ["failed", "conflict"].includes(job.backup.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={storageBusy}
                            onClick={() => void onRetryBackup(job.id)}
                          >
                            {t("retryBackup")}
                          </Button>
                        )}
                      </>
                    )}
                    {canDelete && ["completed", "failed", "cancelled"].includes(job.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={!hostReady || storageBusy || deleting}
                        onClick={() => openConfirmation([job], false)}
                      >
                        {t("deleteJobRecord")}
                      </Button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
          {filteredJobs.length > visibleJobs.length && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllJobs(true)}>
              {t("showMoreJobs", { count: filteredJobs.length - visibleJobs.length })}
            </Button>
          )}
          {showAllJobs && filteredJobs.length > 3 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllJobs(false)}>
              {t("showLessJobs")}
            </Button>
          )}
          {canDelete && (
            <div className="mt-4 border-t border-border pt-3">
              <Button
                ref={clearRef}
                variant="ghost"
                size="sm"
                className="max-w-full whitespace-normal text-left"
                disabled={
                  !hostReady ||
                  storageBusy ||
                  deleting ||
                  loadingEnded ||
                  !endedJobs.length ||
                  !!listError
                }
                onClick={() => openConfirmation(endedJobs, true)}
              >
                {t("clearEndedJobRecords")}
              </Button>
              {listError && (
                <p role="alert" className="mt-2 break-words text-xs text-destructive">
                  {listError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={confirmation !== null}
        onOpenChange={open => {
          if (!open && !busyRef.current) setConfirmation(null);
        }}
      >
        <DialogContent
          closeLabel={t("cancel")}
          closeDisabled={deleting}
          aria-modal="true"
          className="w-[calc(100%-2rem)] max-w-[360px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg"
          onOpenAutoFocus={event => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = focusReturnRef.current;
            if (target?.isConnected && !(target as HTMLButtonElement).disabled) target.focus();
            else if (clearRef.current && !clearRef.current.disabled) clearRef.current.focus();
            else document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>
              {confirmation?.batch
                ? t("clearEndedJobRecordsTitle", { count: confirmation.jobs.length })
                : t("deleteJobRecordTitle")}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {t("deleteJobRecordHint")}
            </DialogDescription>
          </DialogHeader>
          {confirmation?.batch ? (
            <p className="text-sm text-muted-foreground">
              {t("endedJobCounts", {
                completed: confirmation.jobs.filter(job => job.status === "completed").length,
                failed: confirmation.jobs.filter(job => job.status === "failed").length,
                cancelled: confirmation.jobs.filter(job => job.status === "cancelled").length,
              })}
            </p>
          ) : (
            <p className="break-words text-sm">{confirmation?.jobs[0]?.sourceTitle}</p>
          )}
          {deleteError && (
            <p role="alert" className="break-words text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              ref={cancelRef}
              variant="outline"
              disabled={deleting}
              onClick={() => setConfirmation(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || !hostReady || storageBusy || !confirmation?.jobs.length}
              aria-busy={deleting}
              onClick={() => void deleteConfirmed()}
            >
              {deleting
                ? t("deletingJobRecords")
                : confirmation?.batch
                  ? t("clearJobRecords")
                  : t("deleteJobRecord")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
