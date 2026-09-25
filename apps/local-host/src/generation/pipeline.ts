import { randomUUID } from "node:crypto";
import {
  chunkCues, LearningDocumentSchema, SectionContentSchema,
  type AgentSettings, type JobSnapshot, type JobSummary, type LearningDocument,
} from "@immersive/core";
import type { StoragePorts } from "../storage/ports";
import { generateWithAgent } from "../agents";
import { toMarkdown } from "./markdown";
import { sectionPrompt } from "./prompt";

export type SectionGenerator = (agent: AgentSettings, prompt: string, signal: AbortSignal) => Promise<unknown>;

export interface PipelineDependencies {
  storage: StoragePorts;
  generateSection?: SectionGenerator;
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Generation interrupted");
}

/** Plan -> generate -> validate -> checkpoint -> assemble -> persist. Each stage has a testable boundary. */
export async function runGenerationPipeline(
  jobId: string, deps: PipelineDependencies, signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
): Promise<LearningDocument> {
  const { storage } = deps;
  const generate = deps.generateSection ?? generateWithAgent;
  let job = await storage.jobs.get(jobId);
  if (!job || job.summary.status !== "running") throw new Error("Job is not in the running state");
  const chunks = chunkCues(job.request.cues);
  if (chunks.length !== job.summary.total) throw new Error("Saved job plan does not match its transcript");

  // A crash may occur after the final document is saved but before its job state is committed.
  const existing = await storage.documents.get(jobId);
  if (existing) {
    if (job.summary.completed !== job.summary.total) {
      throw new Error("Existing document conflicts with an incomplete job; manual repair is required");
    }
    const finished = await storage.jobs.update(jobId, current => ({
      ...current, summary: {
        ...current.summary, status: "completed", documentId: existing.id,
        updatedAt: new Date().toISOString(), ownerPid: undefined,
      },
    }));
    onProgress(finished.summary);
    return existing;
  }

  for (let index = job.summary.completed; index < chunks.length; index += 1) {
    checkSignal(signal);
    const cues = chunks[index];
    const priorContext = job.sections.slice(-2).map(section => section.context).join("\n");
    const raw = await generate(job.request.agent, sectionPrompt(job.request, cues, index, chunks.length, priorContext), signal);
    checkSignal(signal);
    const content = SectionContentSchema.parse(raw);
    if (content.vocabulary.length > job.request.profile.maxNewVocabulary ||
      content.exercises.length > job.request.profile.exerciseCount) {
      throw new Error("Generated section exceeds the configured learning load");
    }
    const section = {
      ...content, id: randomUUID(), cueIds: cues.map(cue => cue.id),
      startMs: cues[0].startMs, endMs: cues[cues.length - 1].endMs,
    };
    job = await storage.jobs.update(jobId, current => {
      checkSignal(signal);
      if (current.summary.status !== "running" || current.summary.completed !== index) {
        throw new Error("Job changed while generating; refusing to overwrite its checkpoint");
      }
      return {
        ...current, sections: [...current.sections, section],
        summary: {
          ...current.summary, completed: index + 1,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }
  checkSignal(signal);
  const doc = LearningDocumentSchema.parse({
    id: job.summary.id, schemaVersion: 1, createdAt: job.summary.createdAt,
    source: job.request.source, profile: job.request.profile, generation: job.request.agent,
    cues: job.request.cues, sections: job.sections,
  });
  await storage.documents.save(doc, toMarkdown(doc));
  // A cancelled job never transitions back to completed, even if cancellation races disk I/O.
  const finished = await storage.jobs.update(jobId, current => {
    if (current.summary.status !== "running" || signal.aborted) {
      throw new Error("Job was interrupted while saving its document");
    }
    return {
      ...current, summary: {
        ...current.summary, status: "completed", documentId: doc.id,
        updatedAt: new Date().toISOString(), ownerPid: undefined,
      },
    };
  });
  onProgress(finished.summary);
  return doc;
}
