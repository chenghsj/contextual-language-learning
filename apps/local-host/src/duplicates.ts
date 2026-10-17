import { createHash } from "node:crypto";
import {
  netflixWatchId,
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
  youtubeTimeLink,
  type DuplicateMatch,
  type GenerationRequest,
  type LearningDocument,
  type SubtitleCue,
  type VideoSource,
} from "@contextual/core";
import type { StoragePorts } from "./storage/ports";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export function transcriptKey(cues: SubtitleCue[]): string {
  return hash(
    JSON.stringify(
      cues.map(cue => [cue.startMs, cue.endMs, cue.originalText, ...(cue.ruby ? [cue.ruby] : [])]),
    ),
  );
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
    } catch {
      /* invalid optional source URL is rejected by the schema */
    }
  }
  return hash("import:" + transcriptKey(cues));
}

export function videoFolderName(source: VideoSource, cues: SubtitleCue[]): string {
  return videoFolderNameFromKey(source.title, sourceKey(source, cues));
}

export function videoFolderNameFromKey(sourceTitle: string, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid video source key");
  const title = sourceTitle
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  let safeTitle = "";
  let characters = 0;
  for (const character of title) {
    if (characters >= 72 || Buffer.byteLength(safeTitle + character, "utf8") > 180) break;
    safeTitle += character;
    characters++;
  }
  safeTitle = safeTitle.trim() || "Untitled video";
  return safeTitle + "--" + key.slice(0, 16);
}

export function settingsKey(
  request: Pick<GenerationRequest, "profile" | "agent"> & {
    outputSchemaVersion?: 7;
    workflowVersion?: string;
    promptVersion?: string;
    languageStrategyVersion?: string;
    levelStrategyVersion?: string;
    qualityStrategyVersion?: string;
  },
): string {
  return hash(
    JSON.stringify({
      ...(request.outputSchemaVersion === 7
        ? {
            schemaVersion: 7,
            workflowVersion: request.workflowVersion ?? LEARNING_POINTS_WORKFLOW_VERSION,
            promptVersion: request.promptVersion ?? LEARNING_POINTS_PROMPT_VERSION,
            languageStrategyVersion: request.languageStrategyVersion ?? LANGUAGE_STRATEGY_VERSION,
            levelStrategyVersion: request.levelStrategyVersion ?? LEVEL_STRATEGY_VERSION,
            qualityStrategyVersion: request.qualityStrategyVersion ?? QUALITY_STRATEGY_VERSION,
          }
        : {}),
      profile: request.profile,
      agent: {
        provider: request.agent.provider,
        modelId: request.agent.modelId,
        ...(request.agent.thinkingLevel ? { thinkingLevel: request.agent.thinkingLevel } : {}),
      },
    }),
  );
}

export function requestKey(request: GenerationRequest): string {
  return hash(JSON.stringify(request));
}

export async function findLocalDuplicates(
  request: GenerationRequest,
  storage: StoragePorts,
): Promise<DuplicateMatch[]> {
  const expectedSource = sourceKey(request.source, request.cues);
  const expectedTranscript = transcriptKey(request.cues);
  const expectedSettings = settingsKey(request);
  const documents = await storage.documents.list(5000);
  const jobs = await storage.jobs.listRecords();
  const byId = new Map(jobs.map(job => [job.id, job]));
  const matches: DuplicateMatch[] = [];
  for (const document of documents) {
    if (
      sourceKey(document.source, document.cues) !== expectedSource &&
      transcriptKey(document.cues) !== expectedTranscript
    )
      continue;
    const job = byId.get(document.id);
    matches.push({
      documentId: document.id,
      title: document.source.title,
      createdAt: document.createdAt,
      destination: job?.publication?.location ?? "本地教材庫",
      exactSettings:
        settingsKey({
          profile: document.profile,
          agent: document.generation,
          ...(document.schemaVersion === 7
            ? {
                outputSchemaVersion: 7,
                workflowVersion: document.execution?.workflowVersion,
                promptVersion: document.execution?.promptVersion,
                languageStrategyVersion: document.execution?.languageStrategyVersion,
                levelStrategyVersion: document.execution?.levelStrategyVersion,
                qualityStrategyVersion: document.execution?.qualityStrategyVersion,
              }
            : {}),
        }) === expectedSettings &&
        transcriptKey(document.cues) === expectedTranscript &&
        JSON.stringify(
          document.analysisRange && [document.analysisRange.startMs, document.analysisRange.endMs],
        ) ===
          JSON.stringify(
            request.analysisRange && [request.analysisRange.startMs, request.analysisRange.endMs],
          ),
      local: true,
      ...(job?.status ? { jobStatus: job.status } : {}),
    });
  }
  for (const summary of jobs) {
    if (matches.some(item => item.documentId === summary.id)) continue;
    if (summary.status === "cancelled") continue;
    const job = await storage.jobs.get(summary.id);
    if (
      !job ||
      (sourceKey(job.request.source, job.request.cues) !== expectedSource &&
        transcriptKey(job.request.cues) !== expectedTranscript)
    )
      continue;
    matches.push({
      documentId: summary.id,
      title: summary.sourceTitle,
      createdAt: summary.createdAt,
      destination:
        job.request.destination?.kind === "drive" ? "Google Drive（待完成）" : "本地任務",
      exactSettings:
        settingsKey({
          ...job.request,
          ...(job.schemaVersion === 5
            ? {
                workflowVersion: job.execution?.workflowVersion,
                promptVersion: job.execution?.promptVersion,
                languageStrategyVersion: job.execution?.languageStrategyVersion,
                levelStrategyVersion: job.execution?.levelStrategyVersion,
                qualityStrategyVersion: job.execution?.qualityStrategyVersion,
              }
            : {}),
        }) === expectedSettings &&
        transcriptKey(job.request.cues) === expectedTranscript &&
        JSON.stringify(
          job.request.analysisRange && [
            job.request.analysisRange.startMs,
            job.request.analysisRange.endMs,
          ],
        ) ===
          JSON.stringify(
            request.analysisRange && [request.analysisRange.startMs, request.analysisRange.endMs],
          ),
      local: false,
      jobStatus: summary.status,
    });
  }
  return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
}
