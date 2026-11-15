import { isSpeechDownloadActive, type JobSummary, type SpeechDownloadTask } from "@contextual/core";

export type ActivityFilter = "all" | "active" | "failed" | "completed" | "cancelled";
export type ActivityItem =
  | {
      kind: "generation";
      job: JobSummary;
      id: string;
      updatedAt: string;
      active: boolean;
      status: ActivityFilter;
    }
  | {
      kind: "download";
      task: SpeechDownloadTask;
      id: string;
      updatedAt: string;
      active: boolean;
      status: ActivityFilter;
    };

export function activityItems(
  jobs: JobSummary[],
  downloads: SpeechDownloadTask[],
  filter: ActivityFilter,
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...jobs.map(job => ({
      kind: "generation" as const,
      job,
      id: `generation:${job.id}`,
      updatedAt: job.updatedAt,
      active: ["queued", "running", "waiting"].includes(job.status),
      status: (["queued", "running", "waiting"].includes(job.status)
        ? "active"
        : job.status) as ActivityFilter,
    })),
    ...downloads.map(task => ({
      kind: "download" as const,
      task,
      id: `download:${task.id}`,
      updatedAt: task.updatedAt,
      active: isSpeechDownloadActive(task),
      status: (isSpeechDownloadActive(task) ? "active" : task.progress.status) as ActivityFilter,
    })),
  ];
  return items
    .filter(item => filter === "all" || item.status === filter)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.kind === "generation" && b.kind === "generation" && a.active && b.active) {
        const rank = { running: 0, queued: 1, waiting: 2 };
        const statusOrder =
          rank[a.job.status as keyof typeof rank] - rank[b.job.status as keyof typeof rank];
        if (statusOrder) return statusOrder;
        if (a.job.status === "queued") return a.job.createdAt.localeCompare(b.job.createdAt);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function visibleActivityItems(items: ActivityItem[], showAll: boolean): ActivityItem[] {
  if (showAll) return items;
  let ended = 0;
  return items.filter(item => item.active || ++ended <= 3);
}
