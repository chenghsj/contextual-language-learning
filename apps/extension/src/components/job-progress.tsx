import React, { useEffect, useState } from "react";
import type { JobSummary } from "@contextual/core";
import { generationProgressCopy } from "../i18n/generation-progress";
import { translate, type UiLocale } from "../i18n/messages";
import { Progress } from "./ui/progress";
import { Check, LoaderCircle } from "lucide-react";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";

export function hasDynamicGenerationPlan(job: JobSummary) {
  return job.execution?.schemaVersion === "7";
}

export function JobStage({ job, locale }: { job: JobSummary; locale: UiLocale }) {
  if (job.status !== "running" && job.status !== "completed") return null;
  const done = job.status === "completed";
  const Icon = done ? Check : LoaderCircle;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      data-ui="jobStage"
    >
      <Icon
        className={"size-3.5 shrink-0 " + (done ? "" : "animate-spin motion-reduce:animate-none")}
        aria-hidden="true"
      />
      {done
        ? generationProgressCopy[locale].ready
        : job.phase
          ? sidePanelLayoutCopy[locale][job.phase]
          : translate(locale, "jobRunning")}
    </span>
  );
}

export function JobActivity({ job, locale }: { job: JobSummary; locale: UiLocale }) {
  const [now, setNow] = useState(Date.now());
  const active = job.status === "running" ? (job.activity ?? []) : [];
  useEffect(() => {
    if (!active.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status, active.length]);
  if (!active.length) return null;
  const copy = generationProgressCopy[locale];
  return (
    <div data-ui="jobActivity" className="grid gap-1 text-xs text-muted-foreground">
      {active.length > 1 && <p>{copy.active(active.length)}</p>}
      {active.map(call => (
        <p key={call.id} className="tabular-nums">
          {copy.activity(
            analysisPartNumber(call.step),
            copy.states[call.state],
            Math.max(0, Math.floor((now - Date.parse(call.startedAt)) / 1000)),
          )}
        </p>
      ))}
    </div>
  );
}

// Derive identity from the frozen window, not its position among the remaining calls.
// Splits retain their parent number (window-0ab → 1.1.2); repair/output retries retain it too.
function analysisPartNumber(step: string): string | undefined {
  const window = /^window-(\d+)([ab]*)(?:-|$)/.exec(step);
  if (!window) return undefined;
  return [Number(window[1]) + 1, ...[...window[2]].map(part => (part === "a" ? 1 : 2))].join(".");
}

/** V7 work can split until its output validates; a planned batch count is not a completion percentage. */
export function JobProgress({
  job,
  locale,
  legacyText,
  showStage = true,
}: {
  job: JobSummary;
  locale: UiLocale;
  legacyText: string;
  showStage?: boolean;
}) {
  const dynamic = hasDynamicGenerationPlan(job);
  const copy = generationProgressCopy[locale];
  const value = job.total > 0 ? Math.max(0, Math.min(100, (100 * job.completed) / job.total)) : 0;
  return (
    <div className="grid gap-2" data-ui="jobProgress">
      {!dynamic && (
        <Progress value={value} aria-label={translate(locale, "generationProgressLabel")} />
      )}
      {dynamic && (showStage || job.status === "completed") && (
        <JobStage job={job} locale={locale} />
      )}
      <JobActivity job={job} locale={locale} />
      <p className="text-xs text-muted-foreground">
        {dynamic ? copy.completed(job.completed) : legacyText}
      </p>
    </div>
  );
}
