import { createHash } from "node:crypto";
import {
  netflixWatchId, youtubeTimeLink, type DuplicateMatch,
  type GenerationRequest, type LearningDocument, type SubtitleCue, type VideoSource,
} from "@immersive/core";
import type { StoragePorts } from "./storage/ports";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export function transcriptKey(cues: SubtitleCue[]): string {
  return hash(JSON.stringify(cues.map(cue => [cue.startMs, cue.endMs, cue.originalText])));
}

export function sourceKey(source: VideoSource, cues: SubtitleCue[]): string {
  if (source.url) {
    const youtubeId = youtubeTimeLink(source.url, 0)?.match(/[?&]v=([^&]+)/)?.[1];
    if (youtubeId) return hash("youtube:" + youtubeId);
    const netflixId = netflixWatchId(source.url);
    if (netflixId) return hash("netflix:" + netflixId);
    try {
      const url = new URL(source.url);
      const identifier = source.platform + ":" + url.origin + url.pathname + url.search;
      if (source.platform !== "import") return hash(identifier);
    } catch { /* invalid optional source URL is rejected by the schema */ }
  }
  return hash("import:" + transcriptKey(cues));
}

export function settingsKey(request: Pick<GenerationRequest, "profile" | "agent">): string {
  return hash(JSON.stringify({
    profile: request.profile,
    agent: { provider: request.agent.provider, modelId: request.agent.modelId },
  }));
}

export function requestKey(request: GenerationRequest): string {
  return hash(JSON.stringify(request));
}

export async function findLocalDuplicates(request: GenerationRequest, storage: StoragePorts): Promise<DuplicateMatch[]> {
  const expectedSource = sourceKey(request.source, request.cues);
  const expectedTranscript = transcriptKey(request.cues);
  const expectedSettings = settingsKey(request);
  const documents = await storage.documents.list(5000);
  const jobs = await storage.jobs.list(5000);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const matches: DuplicateMatch[] = [];
  for (const document of documents) {
    if (sourceKey(document.source, document.cues) !== expectedSource &&
      transcriptKey(document.cues) !== expectedTranscript) continue;
    const job = byId.get(document.id);
    matches.push({
      documentId: document.id, title: document.source.title, createdAt: document.createdAt,
      destination: job?.publication?.location ?? "本地教材庫",
      exactSettings: settingsKey({ profile: document.profile, agent: document.generation }) === expectedSettings,
      local: true, ...(job?.status ? { jobStatus: job.status } : {}),
    });
  }
  for (const summary of jobs) {
    if (matches.some(item => item.documentId === summary.id)) continue;
    if (summary.status === "cancelled") continue;
    const job = await storage.jobs.get(summary.id);
    if (!job || (sourceKey(job.request.source, job.request.cues) !== expectedSource &&
      transcriptKey(job.request.cues) !== expectedTranscript)) continue;
    matches.push({
      documentId: summary.id, title: summary.sourceTitle, createdAt: summary.createdAt,
      destination: job.request.destination?.kind === "drive" ? "Google Drive（待完成）" : "本地任務",
      exactSettings: settingsKey(job.request) === expectedSettings,
      local: false, jobStatus: summary.status,
    });
  }
  return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}
