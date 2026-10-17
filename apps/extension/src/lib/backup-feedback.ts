import type { JobSummary } from "@contextual/core";
/** A successful request is not proof of completion: inspect every targeted record. */
export function backupFeedbackResult(
  jobs: JobSummary[],
  accountId: string,
  expectedIds?: string[],
) {
  const records = jobs.filter(
    job => job.backup?.accountId === accountId && (!expectedIds || expectedIds.includes(job.id)),
  );
  const failed = records.filter(job => job.backup?.status === "failed").length;
  if (failed) return { status: "failed" as const, failed };
  if (
    !records.length ||
    expectedIds?.some(id => !records.some(job => job.id === id)) ||
    records.some(job => job.backup?.status !== "backed-up")
  )
    return { status: "attention" as const, failed: 0 };
  return { status: "completed" as const, failed: 0 };
}
