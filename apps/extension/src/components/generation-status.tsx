import React from "react";
import { AlertCircle, Check, Circle, LoaderCircle } from "lucide-react";
import type { JobSummary } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { sidePanelLayoutCopy } from "../i18n/side-panel-layout";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

export function GenerationStatus({ locale, job, title, progress, notificationsEnabled, compact = false,
  onLibrary, onActivity, onCancel, onResume }: {
  locale: UiLocale; job?: JobSummary; title: string; progress: string; notificationsEnabled: boolean;
  compact?: boolean; onLibrary: () => void; onActivity?: () => void; onCancel?: () => void; onResume?: () => void;
}) {
  const ui = sidePanelLayoutCopy[locale], layout = settingsLayoutCopy[locale];
  const attention = job && ["waiting", "failed"].includes(job.status);
  const phases = ["analyzing", "selecting", "creating", "saving"] as const;
  const phase = phases.findIndex(phase => phase === job?.phase);
  const percent = job?.total ? Math.min(100, 100 * job.completed / job.total) : 0;
  return <section className={compact ? "mb-3 grid gap-2 rounded-[var(--radius)] border border-border p-3" : "grid gap-4 py-8"}
    aria-label={attention ? layout.needsAttention : ui.generationTitle} aria-live="polite">
    <h2 className="flex items-center gap-2 text-sm font-semibold">{attention && <AlertCircle className="size-4" aria-hidden="true" />}
      {attention ? (job.status === "failed" ? layout.failed : layout.interrupted) : ui.generationTitle}</h2>
    <p className="text-sm wrap-anywhere">{job?.sourceTitle || title}</p>
    {!compact && phase >= 0 && <ol className="grid gap-3 text-xs">
      {phases.map((name, index) => { const Icon = index < phase ? Check : index === phase ? LoaderCircle : Circle;
        return <li key={name} className="flex items-center gap-2"><Icon className={"size-4 " + (index === phase ? "animate-spin motion-reduce:animate-none" : "")} aria-hidden="true" />{ui[name]}</li>; })}
    </ol>}
    <Progress value={percent} aria-label={translate(locale, "generationProgressLabel")} />
    <p className="text-xs text-muted-foreground">{job ? translate(locale, "statusProgress", { completed: job.completed, total: job.total }) : progress}</p>
    {!compact && <p className="text-xs text-muted-foreground">{notificationsEnabled ? layout.runningNotify : layout.runningQuiet}</p>}
    <div className="flex flex-wrap gap-2">
      {!compact && <Button variant="outline" onClick={onLibrary}>{ui.backLibrary}</Button>}
      {attention && onResume && <Button variant="outline" onClick={onResume}>{translate(locale, "resume")}</Button>}
      {compact && onActivity && <Button variant="ghost" onClick={onActivity}>{layout.activity}</Button>}
      {!compact && onCancel && <Button variant="ghost" onClick={onCancel}>{translate(locale, "cancelGeneration")}</Button>}
    </div>
  </section>;
}
