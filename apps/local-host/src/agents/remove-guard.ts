import type { JobSummary } from "@immersive/core";

/** A resumable checkpoint must never lose the Agent definition it references. */
export function assertAgentMayBeRemoved(
  id: string, jobs: readonly Pick<JobSummary, "provider" | "status">[],
): void {
  const blocked = jobs.find(job => job.provider === id &&
    ["queued", "running", "waiting", "failed"].includes(job.status));
  if (blocked) {
    throw new Error("This Agent has an active or resumable job (" + blocked.status +
      "). Finish or explicitly cancel the job before removing its configuration.");
  }
}
