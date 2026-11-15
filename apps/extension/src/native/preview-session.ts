import type { JobSummary, LearningDocument } from "@contextual/core";
import type { JobPreviewInfo } from "./host-client";

/** Coalesces revision notifications, rejecting responses from an abandoned reader. */
export function createPreviewSession(options: {
  load: (jobId: string) => Promise<{ info: JobPreviewInfo; document: LearningDocument }>;
  onSnapshot: (value: { info: JobPreviewInfo; document: LearningDocument }) => void;
  onError: (error: unknown) => void;
}) {
  let active: string | null = null,
    generation = 0,
    pending = false,
    applied = -1,
    status = "";
  let latest: JobSummary | null = null;
  let failedKey: string | null = null;
  let reconnectPending = false;
  const key = (summary: JobSummary | null) =>
    `${summary?.previewRevision ?? 0}:${summary?.status ?? status}`;
  const fetch = async () => {
    if (!active || pending) return;
    const id = active,
      token = generation,
      requested = latest;
    pending = true;
    let accepted = false;
    try {
      const snapshot = await options.load(id);
      if (token !== generation || active !== id) return;
      if (snapshot.info.jobId !== id || snapshot.info.revision < applied)
        throw new Error("Stale preview revision");
      applied = snapshot.info.revision;
      status = snapshot.info.status;
      options.onSnapshot(snapshot);
      failedKey = null;
      accepted = true;
      if (status === "completed") active = null;
    } catch (error) {
      if (token === generation) {
        failedKey = key(latest);
        options.onError(error);
      }
    } finally {
      if (token === generation) {
        pending = false;
        const reconnect = reconnectPending;
        reconnectPending = false;
        if (reconnect && active) {
          failedKey = null;
          void fetch();
          return;
        }
        if (
          accepted &&
          active &&
          latest &&
          ((latest.previewRevision ?? 0) > applied ||
            (latest !== requested && latest.status !== status))
        )
          void fetch();
      }
    }
  };
  return {
    open(jobId: string) {
      if (active !== jobId) {
        generation++;
        pending = false;
        applied = -1;
        status = "";
        latest = null;
        reconnectPending = false;
      }
      active = jobId;
      failedKey = null;
      reconnectPending = false;
      void fetch();
    },
    update(summary: JobSummary) {
      if (active !== summary.id) return;
      latest = summary;
      if (key(summary) === failedKey) return;
      if ((summary.previewRevision ?? 0) > applied || summary.status !== status) void fetch();
    },
    close() {
      active = null;
      generation++;
      pending = false;
      latest = null;
      failedKey = null;
    },
    reconnect() {
      failedKey = null;
      if (active && pending) {
        reconnectPending = true;
        return;
      }
      if (active) void fetch();
    },
  };
}
