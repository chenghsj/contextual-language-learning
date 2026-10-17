import type { JobSummary } from "@contextual/core";
import type { CancellationState } from "../native/cancellation-tracker";
import type { UiLocale } from "../i18n/messages";
import { cancellationCopy } from "../i18n/cancellation";
import { Button } from "./ui/button";
export function CancellationNotice({
  cancellations,
  locale,
  jobs,
  onRetry,
}: {
  cancellations: CancellationState;
  locale: UiLocale;
  jobs: JobSummary[];
  onRetry: (jobId: string, kind: "standard" | "custom") => void;
}) {
  const ui = cancellationCopy[locale];
  return (
    <>
      {Object.entries(cancellations).map(([jobId, cancellation]) => {
        const title = jobs.find(job => job.id === jobId)?.sourceTitle;
        return (
          <div
            key={jobId}
            data-ui="cancellationStatus"
            role="status"
            className="flex shrink-0 items-center justify-between gap-2 py-2 text-xs"
          >
            <p className="min-w-0 wrap-anywhere">
              {title && <span className="font-medium">{title} · </span>}
              {ui[cancellation.status]}
            </p>
            {cancellation.status === "unconfirmed" && (
              <Button variant="outline" size="sm" onClick={() => onRetry(jobId, cancellation.kind)}>
                {ui.retry}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
