import assert from "node:assert/strict";
import test from "node:test";
import type { JobSummary, SpeechDownloadTask } from "@contextual/core";
import { activityItems, visibleActivityItems } from "./activity-items";

const at = (minute: number) => `2026-10-21T00:${String(minute).padStart(2, "0")}:00.000Z`;
const job = (id: string, status: JobSummary["status"], minute: number) =>
  ({
    id,
    status,
    createdAt: at(minute),
    updatedAt: at(minute),
  }) as JobSummary;
const download = (id: string, status: SpeechDownloadTask["progress"]["status"], minute: number) =>
  ({
    id,
    createdAt: at(minute),
    updatedAt: at(minute),
    voice: { id: `siri:${id}`, name: id, language: "en-US" },
    progress:
      status === "failed"
        ? { status, endedAt: at(minute), reason: "rejected" }
        : status === "completed"
          ? { status, endedAt: at(minute) }
          : status === "cancelled"
            ? { status, endedAt: at(minute), shared: false }
            : { status },
    observation: { kind: "fresh", checkedAt: at(minute) },
  }) as SpeechDownloadTask;

test("active downloads and generations appear ahead of a shared three-record history window", () => {
  const jobs = [
    job("same", "running", 1),
    job("job-old", "completed", 2),
    job("job-new", "failed", 6),
  ];
  const downloads = [
    download("same", "waiting-system", 4),
    download("voice-old", "cancelled", 1),
    download("voice-new", "completed", 5),
    download("voice-latest", "failed", 7),
  ];
  const items = activityItems(jobs, downloads, "all");
  assert.deepEqual(
    visibleActivityItems(items, false).map(item => item.id),
    [
      "download:same",
      "generation:same",
      "download:voice-latest",
      "generation:job-new",
      "download:voice-new",
    ],
  );
  assert.equal(visibleActivityItems(items, true).length, 7);
  assert.deepEqual(
    activityItems(jobs, downloads, "failed").map(item => item.id),
    ["download:voice-latest", "generation:job-new"],
  );
  assert.deepEqual(
    activityItems(jobs, downloads, "active").map(item => item.id),
    ["download:same", "generation:same"],
  );
});
