import { pronunciationDiagnosticCopy } from "../i18n/pronunciation-diagnostics";
import { createFlowCopy } from "../i18n/create-flow";
import { customContentCopy } from "../i18n/custom-content";
import { cancellationCopy } from "../i18n/cancellation";
import type { CancellationState } from "../native/cancellation-tracker";
import { layoutText, sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { PageSection } from "./page-section";
import React, { useEffect, useRef, useState } from "react";
import { isPiProviderId, type AgentInfo, type JobSummary } from "@contextual/core";
import { agentDisplayName } from "../i18n/agent-display";
import { piCopy } from "../i18n/pi";
import type { UiLocale, MessageKey, MessageParams } from "../i18n/messages";
import { PiFeedback } from "./pi-feedback";
import { Button, destructiveOutlineClassName } from "./ui/button";
import { Badge } from "./ui/badge";
import { SelectField } from "./ui/select";
import { IconTooltip } from "./icon-tooltip";
import { RefreshCw } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader } from "./ui/dialog";
import { DialogTitleBar } from "./dialog-title-bar";
import { JobProgress, JobStage, hasDynamicGenerationPlan } from "./job-progress";
import { generationProgressCopy } from "../i18n/generation-progress";
import { activityCopy } from "../i18n/activity";

type Props = {
  locale?: UiLocale;
  onConfigure?: () => void;
  jobs: JobSummary[];
  cancellations?: CancellationState;
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
  cancellations = {},
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
  const activity = activityCopy[locale];
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<string[]>([]);
  const [endedJobs, setEndedJobs] = useState<JobSummary[]>([]);
  const [confirmation, setConfirmation] = useState<{ jobs: JobSummary[]; batch: boolean } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [listError, setListError] = useState("");
  const [refreshEnded, setRefreshEnded] = useState(0);
  const busyRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const canDelete = !!onListEnded && !!onDeleteRecords;
  // Progress and timestamps do not change which records can be cleared.
  const endedJobsRevision = jobs
    .filter(job => ["completed", "failed", "cancelled"].includes(job.status))
    .map(job => `${job.id}:${job.status}`)
    .sort()
    .join("|");
  useEffect(() => {
    if (!hostReady || !onListEnded) return;
    let live = true;
    setListError("");
    void onListEnded()
      .then(items => {
        if (live) setEndedJobs(items);
      })
      .catch(error => {
        if (live) setListError(taskHistoryError(error, t, "loadJobRecordsError"));
      });
    return () => {
      live = false;
    };
  }, [hostReady, onListEnded, endedJobsRevision, refreshEnded, t]);
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
  const activeJobs = filteredJobs
    .filter(job => matchesJobFilter(job.status, "active"))
    .sort((a, b) => {
      const rank = { running: 0, queued: 1, waiting: 2 };
      const statusOrder = rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank];
      return (
        statusOrder ||
        (a.status === "queued"
          ? a.createdAt.localeCompare(b.createdAt)
          : b.updatedAt.localeCompare(a.updatedAt))
      );
    });
  const endedRecords = filteredJobs
    .filter(job => !matchesJobFilter(job.status, "active"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visibleJobs = [...activeJobs, ...(showAllJobs ? endedRecords : endedRecords.slice(0, 3))];
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
  const jobSummary = (job: JobSummary) => {
    if (job.status === "completed") {
      const completedAt = layoutText(flow.completedAt, {
        time: new Date(job.updatedAt).toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      return `${hasDynamicGenerationPlan(job) ? generationProgressCopy[locale].completed(job.completed) : `${job.completed} / ${job.total}`} · ${completedAt}`;
    }
    if (job.status === "queued") {
      return `${ux.queued}: ${queued.findIndex(item => item.id === job.id) + 1}`;
    }
    if (hasDynamicGenerationPlan(job) && job.status === "running") {
      return <JobStage job={job} locale={locale} />;
    }
    const phase = phaseLabel(job);
    return phase;
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
              onClick={() => {
                onRefresh();
                setRefreshEnded(value => value + 1);
              }}
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
          <Accordion
            type="multiple"
            value={expandedJobs}
            onValueChange={setExpandedJobs}
            className="my-3 grid gap-1"
          >
            {!loadingJobs && !visibleJobs.length && (
              <p className="text-xs text-muted-foreground">{flow.activityEmpty}</p>
            )}
            {visibleJobs.map((job, index) => (
              <React.Fragment key={job.id}>
                {matchesJobFilter(job.status, "active") && index === 0 && (
                  <h3 className="mt-3 text-xs font-medium text-muted-foreground">
                    {activity.inProgress}
                  </h3>
                )}
                {jobFilter === "all" &&
                  !matchesJobFilter(job.status, "active") &&
                  (index === 0 || matchesJobFilter(visibleJobs[index - 1].status, "active")) && (
                    <h3 className="mt-3 text-xs font-medium text-muted-foreground">
                      {activity.history}
                    </h3>
                  )}
                {!matchesJobFilter(job.status, "active") &&
                  (index === 0 ||
                    matchesJobFilter(visibleJobs[index - 1].status, "active") ||
                    new Date(visibleJobs[index - 1].updatedAt).toLocaleDateString() !==
                      new Date(job.updatedAt).toLocaleDateString()) && (
                    <h3 className="mt-3 text-[11px] font-medium text-muted-foreground">
                      {dayLabel(job.updatedAt)}
                    </h3>
                  )}
                <AccordionItem
                  value={job.id}
                  data-ui="taskHistoryItem"
                  className="min-w-0 border-border [&_p]:my-1 [&_[data-ui=actions]_button]:h-auto [&_[data-ui=actions]_button]:min-h-8 [&_[data-ui=actions]_button]:whitespace-normal"
                >
                  <AccordionTrigger className="min-w-0 items-start gap-2 py-3 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 [&>svg]:mt-0.5">
                    <span className="grid min-w-0 flex-1 gap-2">
                      <span
                        className="line-clamp-2 min-w-0 break-words text-ui-heading font-semibold"
                        title={job.sourceTitle}
                      >
                        {job.sourceTitle}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge className="shrink-0 whitespace-nowrap text-[11px] leading-4">
                          {cancellations[job.id]
                            ? cancellationCopy[locale][
                                cancellations[job.id].status === "pending"
                                  ? "pendingLabel"
                                  : "unconfirmedLabel"
                              ]
                            : t(jobStatusKeys[job.status])}
                        </Badge>
                        <span className="min-w-0 break-words text-xs font-normal leading-4 text-muted-foreground">
                          {jobSummary(job)}
                        </span>
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent
                    forceMount
                    hidden={!expandedJobs.includes(job.id)}
                    data-ui="taskHistoryDetails"
                    className="min-w-0 pb-3 text-ui-body"
                  >
                    {job.status !== "queued" && (
                      <div data-ui="taskHistoryProgress" className="mb-3 grid gap-2">
                        <JobProgress
                          job={job}
                          locale={locale}
                          showStage={false}
                          legacyText={layoutText(flow.completedSteps, {
                            completed: job.completed,
                            total: job.total,
                          })}
                        />
                      </div>
                    )}
                    <p
                      className="mb-3 text-ui-label leading-relaxed text-muted-foreground"
                      data-ui="hint"
                    >
                      {agentDisplayName(
                        job.provider,
                        agentCatalog.find(item => item.id === job.provider)?.label,
                      )}
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
                    {job.retry && (
                      <p role="status">
                        {ux.retrying} {job.retry.attempt}/2 · {Math.ceil(job.retry.delayMs / 1000)}s
                        · {job.retry.reason}
                      </p>
                    )}
                    {job.status === "running" && (
                      <p className="text-muted-foreground">{ux.cancelHint}</p>
                    )}
                    {!!job.pronunciationMissingCount && (
                      <p className="text-muted-foreground" data-ui="pronunciationMissingCount">
                        {pronunciationDiagnosticCopy(locale).count(job.pronunciationMissingCount)}
                      </p>
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
                        ) : !agentCatalog.some(
                            item => item.id === job.provider && item.installed,
                          ) ? (
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
                          disabled={!hostReady || cancellations[job.id]?.status === "pending"}
                          onClick={() => onCancel(job)}
                        >
                          {cancellations[job.id]
                            ? cancellationCopy[locale][
                                cancellations[job.id].status === "pending"
                                  ? "pendingLabel"
                                  : "retry"
                              ]
                            : t("cancel")}
                        </Button>
                      )}
                      {job.documentId && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onOpen(job.documentId!)}
                          >
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
                  </AccordionContent>
                </AccordionItem>
              </React.Fragment>
            ))}
          </Accordion>
          {filteredJobs.length > visibleJobs.length && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllJobs(true)}>
              {t("showMoreJobs", { count: filteredJobs.length - visibleJobs.length })}
            </Button>
          )}
          {showAllJobs && endedRecords.length > 3 && (
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
                disabled={!hostReady || storageBusy || deleting || !endedJobs.length || !!listError}
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
          showCloseButton={false}
          aria-modal="true"
          className="max-h-[calc(100dvh-2rem)] max-w-[min(360px,calc(100%-2rem))] overflow-y-auto sm:max-w-[360px]"
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
            <DialogTitleBar closeLabel={t("cancel")} closeDisabled={deleting}>
              {confirmation?.batch
                ? t("clearEndedJobRecordsTitle", { count: confirmation.jobs.length })
                : t("deleteJobRecordTitle")}
            </DialogTitleBar>
            <DialogDescription className="text-xs whitespace-pre-line">
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
          <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2">
            <Button
              ref={cancelRef}
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirmation(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="outline"
              className={destructiveOutlineClassName}
              size="sm"
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
