import { customContentCopy } from "../i18n/custom-content";
import { cancellationCopy } from "../i18n/cancellation";
import React from "react";
import { AlertCircle, Check, Circle, LoaderCircle } from "lucide-react";
import type { JobSummary } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { JobProgress } from "./job-progress";

export function GenerationStatus({
  locale,
  job,
  kind,
  title,
  progress,
  notificationsEnabled,
  compact = false,
  onLibrary,
  onActivity,
  onCancel,
  onResume,
  cancellation,
}: {
  locale: UiLocale;
  job?: JobSummary;
  kind?: "standard" | "custom";
  title: string;
  progress: string;
  notificationsEnabled: boolean;
  compact?: boolean;
  onLibrary: () => void;
  onActivity?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  cancellation?: "pending" | "unconfirmed";
}) {
  const ui = sidePanelLayoutCopy[locale],
    layout = settingsLayoutCopy[locale];
  const attention = job && ["waiting", "failed"].includes(job.status);
  const customUi = customContentCopy(locale);
  const isCustom = (job?.kind ?? kind) === "custom";
  const generationTitle = isCustom ? customUi.generationTitle : ui.generationTitle;
  const phases: NonNullable<JobSummary["phase"]>[] = isCustom
    ? ["creating", "selecting", "saving"]
    : ["analyzing", "selecting", "creating", "saving"];
  const phase = phases.findIndex(phase => phase === job?.phase);
  return (
    <section
      className={
        compact
          ? "mb-3 grid gap-2 rounded-[var(--radius)] border border-border p-3"
          : "grid gap-4 py-8"
      }
      aria-label={attention ? layout.needsAttention : generationTitle}
      aria-live="polite"
    >
      <h2 className="flex items-center gap-2 text-ui-heading font-semibold">
        {attention && <AlertCircle className="size-4" aria-hidden="true" />}
        {attention
          ? job.status === "failed"
            ? layout.failed
            : layout.interrupted
          : generationTitle}
      </h2>
      <p className="text-ui-body wrap-anywhere">{job?.sourceTitle || title}</p>
      {!compact && phase >= 0 && (
        <ol className="grid gap-3 text-xs">
          {phases.map((name, index) => {
            const Icon = index < phase ? Check : index === phase ? LoaderCircle : Circle;
            return (
              <li key={name} className="flex items-center gap-2">
                <Icon
                  className={
                    "size-4 " + (index === phase ? "animate-spin motion-reduce:animate-none" : "")
                  }
                  aria-hidden="true"
                />
                {isCustom && name === "creating"
                  ? customUi.segments
                  : isCustom && name === "selecting"
                    ? customUi.merge
                    : ui[name]}
              </li>
            );
          })}
        </ol>
      )}
      {job ? (
        <JobProgress
          job={job}
          locale={locale}
          legacyText={translate(locale, "statusProgress", {
            completed: job.completed,
            total: job.total,
          })}
        />
      ) : (
        <>
          <Progress value={0} aria-label={translate(locale, "generationProgressLabel")} />
          <p className="text-ui-body text-muted-foreground">{progress}</p>
        </>
      )}
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {notificationsEnabled ? layout.runningNotify : layout.runningQuiet}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!compact && (
          <Button variant="outline" onClick={onLibrary}>
            {ui.backLibrary}
          </Button>
        )}
        {attention && onResume && (
          <Button variant="outline" onClick={onResume}>
            {translate(locale, "resume")}
          </Button>
        )}
        {onActivity && (
          <Button variant="ghost" onClick={onActivity}>
            {compact ? layout.activity : ui.details}
          </Button>
        )}
        {!compact && onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={cancellation === "pending"}>
            {cancellation
              ? cancellationCopy[locale][cancellation === "pending" ? "pendingLabel" : "retry"]
              : translate(locale, "cancelGeneration")}
          </Button>
        )}
      </div>
    </section>
  );
}
