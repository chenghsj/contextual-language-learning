import {
  exactIds,
  validateLearningDocumentV7,
  learningDocumentToMarkdown,
  type JobSummary,
  type LearningDocumentV7,
} from "@contextual/core";
import type { PipelineDependencies } from "./pipeline";
import { createLearningExecution } from "./learning-execution";
import { analyzeCandidates } from "./learning-candidates";
import { selectScenes } from "./learning-selection";
import { teachBatches } from "./learning-teaching";

/** Orchestrate stages; each stage shares the same model identity and checkpoint writer. */
export async function runLearningPointsPipeline(
  jobId: string,
  deps: PipelineDependencies,
  signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
): Promise<LearningDocumentV7> {
  const execution = await createLearningExecution(jobId, deps, signal, onProgress);
  try {
    await analyzeCandidates(execution);
    await selectScenes(execution);
    await teachBatches(execution);
    let job = execution.job;
    const { update } = execution;
    const results = job.learningPlan.batches.map(b => b.result!);
    const points = results
      .flatMap(r => r.points)
      .map(p => ({ ...p, utteranceIds: [...p.utteranceIds] }));
    const sections = job.learningPlan.selected!.map(scene => {
      const parts = results.filter(r => r.section.id === scene.id).map(r => r.section),
        first = parts[0];
      if (!first) throw new Error("Missing scene teaching result");
      const source = job.request.cues.filter(c => scene.dialogueCueIds.includes(c.id)),
        timed = source.every(c => c.startMs !== null && c.endMs !== null);
      const merged = {
        ...first,
        cueIds: scene.dialogueCueIds,
        startMs: timed ? Math.min(...source.map(c => c.startMs!)) : null,
        endMs: timed ? Math.max(...source.map(c => c.endMs!)) : null,
        translations: parts.flatMap(p => p.translations),
        utterances: parts.flatMap(p => p.utterances),
        pronunciations: parts.some(p => p.pronunciations)
          ? parts.flatMap(p => p.pronunciations ?? [])
          : undefined,
      };
      exactIds(
        merged.utterances.map(u => u.id),
        scene.utterances.map(u => u.id),
        "Missing utterance after batch merge",
      );
      return merged;
    });
    for (const u of sections.flatMap(s => s.utterances))
      for (const id of u.pointIds) {
        const p = points.find(p => p.id === id);
        if (p && !p.utteranceIds.includes(u.id)) p.utteranceIds.push(u.id);
      }
    await update(j => ({ ...j, sections, summary: { ...j.summary, phase: "saving" } }));
    job = execution.job;
    const document = validateLearningDocumentV7({
      schemaVersion: 7,
      id: job.summary.id,
      createdAt: job.summary.createdAt,
      source: job.request.source,
      profile: job.request.profile,
      generation: job.execution
        ? { ...job.request.agent, provider: job.execution.provider, modelId: job.execution.modelId }
        : job.request.agent,
      execution: job.execution,
      analysisRange: job.request.analysisRange,
      cues: job.request.cues,
      sections,
      points,
      reusableItems: results.flatMap(r => r.reusableItems),
    });
    const existing = await deps.storage.documents.get(document.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(document))
      throw new Error("Saved document conflicts with resumed V7 checkpoint");
    if (!existing)
      await deps.storage.documents.save(document, learningDocumentToMarkdown(document));
    await update(j => ({
      ...j,
      summary: { ...j.summary, status: "completed", documentId: document.id, ownerPid: undefined },
    }));
    return document;
  } finally {
    execution.close();
  }
}
