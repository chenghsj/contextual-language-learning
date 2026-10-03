import { randomUUID } from "node:crypto";
import {
  CandidateBatchSchema,
  ContextualSceneContentSchema,
  ContextualSceneSchema,
  FinalSelectionSchema,
  LearningDocumentSchema,
  chunkCues,
  normalizeLearningCues,
  type CandidateScene,
  type ContextualScene,
  type JobSummary,
  type LearningLanguage,
  type PronunciationSegment,
  type SubtitleCue,
} from "@immersive/core";
import type { PipelineDependencies } from "./pipeline";
import { generatePiText } from "../agents/pi";
import { parseAgentJson } from "../agents/json";
import { generateWithAgent } from "../agents";
import { candidatePrompt, contextualScenePrompt, selectionPrompt } from "./scene-prompts";
import { toMarkdown } from "./markdown";

function assertRunning(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Generation interrupted");
}

function normalizeExpression(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function alignedReading(
  segments: PronunciationSegment[] | undefined,
  original: string,
  language: LearningLanguage,
): PronunciationSegment[] | undefined {
  if (!segments || segments.map(segment => segment.text).join("") !== original) return undefined;
  const cleaned: PronunciationSegment[] = segments.map(segment => {
    const reading = segment.reading?.trim();
    const valid =
      reading &&
      (language === "ja"
        ? /^[\u3040-\u309fー\s。、!?！？]+$/u.test(reading)
        : language === "ko"
          ? /^[\uac00-\ud7a3\s.,!?！？]+$/u.test(reading)
          : /^\/.+\/$/u.test(reading));
    return valid ? { ...segment, reading } : { text: segment.text };
  });
  return cleaned.some(segment => segment.reading) ? cleaned : undefined;
}

/** Resolve an exact phrase to original cue IDs, even when the words span adjacent cues. */
function expressionCueIds(cues: readonly SubtitleCue[], expression: string): string[] {
  const rows = cues.map(cue => normalizeExpression(cue.originalText));
  const dialogue = rows.join(" ");
  const normalized = normalizeExpression(expression);
  const start = dialogue.indexOf(normalized);
  if (start < 0) return [];
  const end = start + normalized.length;
  let offset = 0;
  const ids: string[] = [];
  rows.forEach((text, index) => {
    const rowEnd = offset + text.length;
    if (start < rowEnd && end > offset) ids.push(cues[index].id);
    offset = rowEnd + 1;
  });
  return ids;
}

function validatedCandidate(
  chunk: SubtitleCue[],
  candidate: { cueIds: string[]; focusExpressions: string[]; learningGoal: string },
  chunkIndex: number,
  candidateIndex: number,
): CandidateScene {
  const byId = new Map(chunk.map((cue, index) => [cue.id, { cue, index }]));
  const rows = candidate.cueIds.map(id => byId.get(id));
  if (rows.some(row => !row)) throw new Error("AI selected a cue outside its source chunk");
  const indexes = rows.map(row => row!.index);
  if (indexes.some((index, i) => i > 0 && index <= indexes[i - 1])) {
    throw new Error("AI selected duplicate or out-of-order cues");
  }
  const first = rows[0]!.cue;
  const last = rows[rows.length - 1]!.cue;
  if (first.startMs !== null && last.endMs !== null && last.endMs - first.startMs > 60_000) {
    throw new Error("AI selected a scene longer than one minute");
  }
  for (const expression of candidate.focusExpressions) {
    const exact = normalizeExpression(expression);
    if (
      !expressionCueIds(
        rows.map(row => row!.cue),
        exact,
      ).length
    ) {
      throw new Error("AI focus expression is not present in the selected subtitle cues");
    }
  }
  return {
    id: "candidate-" + (chunkIndex + 1) + "-" + (candidateIndex + 1),
    cueIds: candidate.cueIds,
    focusExpressions: candidate.focusExpressions,
    learningGoal: candidate.learningGoal,
  };
}

/** Only source-backed candidates may become scenes. Never accept model timestamps. */
export function validateCandidateBatch(
  chunk: SubtitleCue[],
  raw: unknown,
  chunkIndex: number,
): CandidateScene[] {
  const parsed = CandidateBatchSchema.parse(raw);
  const result: CandidateScene[] = [];
  const occupied = new Set<string>();
  for (const [index, candidate] of parsed.candidates.entries()) {
    const validated = validatedCandidate(chunk, candidate, chunkIndex, index);
    // A context explanation needs a real source line outside its focus phrase.
    // Reject unusable candidates before writing the candidate/selection checkpoint.
    const selected = validated.cueIds.map(id => chunk.find(cue => cue.id === id)!);
    if (
      validated.focusExpressions.some(
        expression => expressionCueIds(selected, expression).length >= validated.cueIds.length,
      )
    )
      continue;
    if (validated.cueIds.some(id => occupied.has(id))) continue;
    for (const id of validated.cueIds) occupied.add(id);
    result.push(validated);
  }
  return result;
}

export function chooseFinalScenes(
  raw: unknown,
  candidates: CandidateScene[],
  request: {
    profile: { sceneCount: number };
  },
  allCues: SubtitleCue[],
): CandidateScene[] {
  const { selectedCandidateIds } = FinalSelectionSchema.parse(raw);
  const lookup = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const usedCues = new Set<string>();
  const usedExpressions = new Set<string>();
  const chosen: CandidateScene[] = [];
  const limit = request.profile.sceneCount;
  let remaining = request.profile.sceneCount * 2;
  for (const id of selectedCandidateIds) {
    const candidate = lookup.get(id);
    if (!candidate) throw new Error("AI selected an unknown scene ID");
    if (chosen.some(scene => scene.id === candidate.id))
      throw new Error("AI selected the same scene twice");
    if (candidate.cueIds.some(cue => usedCues.has(cue))) continue;
    const fresh = candidate.focusExpressions.filter(
      expression => !usedExpressions.has(normalizeExpression(expression).toLocaleLowerCase()),
    );
    if (!fresh.length) continue;
    if (chosen.length >= limit || remaining < 1) break;
    const focusExpressions = fresh.slice(0, Math.min(2, remaining));
    chosen.push({ ...candidate, focusExpressions });
    remaining -= focusExpressions.length;
    candidate.cueIds.forEach(cue => usedCues.add(cue));
    focusExpressions.forEach(expression =>
      usedExpressions.add(normalizeExpression(expression).toLocaleLowerCase()),
    );
  }
  const order = new Map(allCues.map((cue, index) => [cue.id, index]));
  chosen.sort(
    (a, b) => (order.get(a.cueIds[0]) ?? Infinity) - (order.get(b.cueIds[0]) ?? Infinity),
  );
  if (!chosen.length)
    throw new Error(
      "No suitable dialogue scenes were selected. Try a different video or learning level.",
    );
  return chosen;
}

/** Reject model-provided source references or examples that contradict the canonical scene. */
export function assembleContextualScene(
  candidate: CandidateScene,
  cues: SubtitleCue[],
  raw: unknown,
  vocabularyLimit: number,
  exampleCount: number,
  language: LearningLanguage = "en",
): ContextualScene {
  const content = ContextualSceneContentSchema.parse(raw);
  if (
    content.focusItems.length !== candidate.focusExpressions.length ||
    content.focusItems.length > vocabularyLimit
  ) {
    throw new Error("Contextual scene must explain each selected focus expression exactly once");
  }
  if (
    content.translations.length !== candidate.cueIds.length ||
    content.translations.some((item, index) => item.cueId !== candidate.cueIds[index])
  ) {
    throw new Error(
      "Scene translations must reference every selected cue exactly once and in order",
    );
  }
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  const selected = candidate.cueIds.map(id => byId.get(id));
  if (selected.some(cue => !cue)) throw new Error("Selected source subtitles no longer exist");
  const original = selected.map(cue => cue!);
  const pronouncedCueIds = new Set<string>();
  const pronunciations = content.pronunciations?.flatMap(item => {
    const cue = original.find(source => source.id === item.cueId);
    if (!cue || pronouncedCueIds.has(item.cueId)) return [];
    const segments = alignedReading(item.segments, cue.originalText, language);
    if (!segments) return [];
    pronouncedCueIds.add(item.cueId);
    return [{ cueId: item.cueId, segments }];
  });
  const focusItems = content.focusItems.map(item => ({
    ...item,
    examples: item.examples.map(example => ({
      ...example,
      dialogue: example.dialogue.map(line => ({
        ...line,
        pronunciation: alignedReading(line.pronunciation, line.text, language),
      })),
    })),
  }));
  const inScene = new Set(candidate.cueIds);
  for (const [index, item] of content.focusItems.entries()) {
    if (
      normalizeExpression(item.expression) !==
      normalizeExpression(candidate.focusExpressions[index])
    ) {
      throw new Error("Contextual expression must match the selected source phrase in order");
    }
    const actual = expressionCueIds(original, item.expression);
    if (
      !actual.length ||
      actual.length !== item.sourceCueIds.length ||
      actual.some((id, position) => id !== item.sourceCueIds[position])
    ) {
      throw new Error("Contextual expression source cue IDs do not match the original transcript");
    }
    if (
      item.contextCueIds.some(id => !inScene.has(id)) ||
      (candidate.cueIds.length > 1 && !item.contextCueIds.some(id => !actual.includes(id)))
    ) {
      throw new Error("Context evidence must reference real neighboring dialogue cues");
    }
    if (
      item.wordNotes.some(
        word => !normalizeExpression(item.expression).includes(normalizeExpression(word.surface)),
      )
    ) {
      throw new Error("Word notes must use surface forms from the selected focus expression");
    }
    if (item.examples.length !== exampleCount) {
      throw new Error("Contextual example count does not match the lesson setting");
    }
    const situations = item.examples.map(example =>
      normalizeExpression(example.situation).toLowerCase(),
    );
    if (
      new Set(situations).size !== situations.length ||
      item.examples.some(
        example =>
          !example.dialogue.some(line =>
            normalizeExpression(line.text).includes(normalizeExpression(item.expression)),
          ),
      )
    ) {
      throw new Error("Contextual examples must use the focus expression in distinct situations");
    }
  }
  const timed = original.every(cue => cue.startMs !== null && cue.endMs !== null);
  return ContextualSceneSchema.parse({
    ...content,
    pronunciations,
    focusItems,
    id: randomUUID(),
    cueIds: candidate.cueIds,
    startMs: timed ? Math.min(...original.map(cue => cue.startMs!)) : null,
    endMs: timed ? Math.max(...original.map(cue => cue.endMs!)) : null,
  });
}

export async function runSceneGenerationPipeline(
  jobId: string,
  deps: PipelineDependencies,
  signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
) {
  const { storage } = deps;
  const generate =
    deps.generateSection ??
    (async (agent, prompt, abort) => {
      const saved = await storage.jobs.get(jobId);
      if (!saved?.execution) return generateWithAgent(agent, prompt, abort);
      const execution = saved.execution;
      const result = await generatePiText(
        { ...agent, provider: execution.provider, modelId: execution.modelId },
        prompt,
        abort,
        {
          format: "json",
          step: `${saved.summary.phase ?? "generation"}-${saved.summary.completed}`,
        },
      );
      if (result.call.provider !== execution.provider || result.call.modelId !== execution.modelId)
        throw new Error("Actual model differs from the pinned model");
      await storage.jobs.update(jobId, current => ({
        ...current,
        execution: { ...current.execution!, calls: [...current.execution!.calls, result.call] },
      }));
      return parseAgentJson(result.text, "Pi");
    });
  let job = await storage.jobs.get(jobId);
  if (!job || job.summary.status !== "running" || !job.scenePlan) {
    throw new Error("Scene job is not in the running state");
  }
  async function reportPhase(
    phase: "analyzing" | "selecting" | "creating" | "saving",
  ): Promise<void> {
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (current.summary.status !== "running") throw new Error("Job was interrupted");
      return { ...current, summary: { ...current.summary, phase } };
    });
    onProgress(job.summary);
  }
  const chunks = chunkCues(job.request.cues);
  const plan = job.scenePlan;
  if (plan.candidateChunks.length > chunks.length)
    throw new Error("Saved candidate checkpoint exceeds transcript");

  if (plan.candidateChunks.length < chunks.length) await reportPhase("analyzing");
  for (let index = plan.candidateChunks.length; index < chunks.length; index++) {
    assertRunning(signal);
    const normalized = normalizeLearningCues(chunks[index]);
    const raw = normalized.length
      ? await (deps.generateCandidates ?? generate)(
          job.request.agent,
          candidatePrompt(job.request, normalized, index, chunks.length),
          signal,
        )
      : { candidates: [] };
    assertRunning(signal);
    const candidates = validateCandidateBatch(normalized, raw, index);
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (
        !current.scenePlan ||
        current.summary.status !== "running" ||
        current.scenePlan.candidateChunks.length !== index
      ) {
        throw new Error("Scene candidate checkpoint changed during generation");
      }
      return {
        ...current,
        scenePlan: {
          ...current.scenePlan,
          candidateChunks: [...current.scenePlan.candidateChunks, candidates],
        },
        summary: {
          ...current.summary,
          phase: "analyzing",
          completed: index + 1,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }
  assertRunning(signal);
  if (!job.scenePlan!.selected) {
    await reportPhase("selecting");
    const candidates = job.scenePlan!.candidateChunks.flat();
    if (!candidates.length)
      throw new Error("No learnable dialogue scenes were found in this transcript");
    const raw = await (deps.generateSelection ?? generate)(
      job.request.agent,
      selectionPrompt(job.request, candidates, job.request.cues),
      signal,
    );
    assertRunning(signal);
    const selected = chooseFinalScenes(raw, candidates, job.request, job.request.cues);
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (
        current.summary.status !== "running" ||
        !current.scenePlan ||
        current.scenePlan.selected ||
        current.scenePlan.candidateChunks.length !== chunks.length
      ) {
        throw new Error("Scene selection checkpoint changed during generation");
      }
      return {
        ...current,
        scenePlan: { ...current.scenePlan, selected },
        summary: {
          ...current.summary,
          phase: "selecting",
          completed: chunks.length + 1,
          total: chunks.length + 1 + selected.length,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }

  const selected = job.scenePlan!.selected!;
  const allCues = new Map(job.request.cues.map(cue => [cue.id, cue]));
  if (job.sections.length < selected.length) await reportPhase("creating");
  for (let index = job.sections.length; index < selected.length; index++) {
    assertRunning(signal);
    const candidate = selected[index];
    const cues = candidate.cueIds.map(id => allCues.get(id)!);
    const usedVocabulary = job.sections.reduce(
      (sum, section) => sum + section.focusItems.length,
      0,
    );
    const vocabularyBudget = Math.min(
      candidate.focusExpressions.length,
      job.request.profile.sceneCount * 2 - usedVocabulary,
    );
    const exampleCount = job.request.profile.contextualExampleCount;
    let section: ContextualScene | undefined;
    // A failed saved scene must not discard completed sections. Retry only
    // the current scene when an agent's evidence IDs violate source grounding.
    const allowedNeighbors = candidate.focusExpressions
      .slice(0, vocabularyBudget)
      .map(expression => {
        const focusIds = new Set(expressionCueIds(cues, expression));
        return { expression, cueIds: candidate.cueIds.filter(id => !focusIds.has(id)) };
      });
    if (allowedNeighbors.some(item => !item.cueIds.length)) {
      throw new Error(
        "Selected scene lacks real neighboring dialogue for its focus expression. Choose a longer source-backed scene.",
      );
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        contextualScenePrompt(job.request, candidate, cues, vocabularyBudget, exampleCount) +
        (attempt === 0
          ? ""
          : "\nVALIDATION REPAIR: Previous JSON failed source-evidence validation. " +
            "Return the complete corrected scene JSON. For each focus expression, contextCueIds MUST " +
            "include at least one of its actual neighboring cue IDs from this allowed list: " +
            JSON.stringify(allowedNeighbors) +
            ". Only reference these original cue IDs; never invent dialogue.");
      const raw = await generate(job.request.agent, prompt, signal);
      assertRunning(signal);
      try {
        section = assembleContextualScene(
          candidate,
          job.request.cues,
          raw,
          vocabularyBudget,
          exampleCount,
          job.request.profile.targetLanguage,
        );
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Context evidence must reference real neighboring dialogue cues")
        )
          throw error;
        if (attempt === 1) {
          throw new Error(
            "Context evidence is still invalid after one targeted retry: " + error.message,
          );
        }
      }
    }
    if (!section) throw new Error("Scene generation returned no validated content");
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (
        current.summary.status !== "running" ||
        !current.scenePlan?.selected ||
        current.sections.length !== index
      ) {
        throw new Error("Scene content checkpoint changed during generation");
      }
      return {
        ...current,
        sections: [...current.sections, section],
        summary: {
          ...current.summary,
          phase: "creating",
          completed: chunks.length + 2 + index,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }
  assertRunning(signal);
  await reportPhase("saving");
  const document = LearningDocumentSchema.parse({
    id: job.summary.id,
    schemaVersion: 5,
    createdAt: job.summary.createdAt,
    source: job.request.source,
    profile: job.request.profile,
    generation: job.execution
      ? { ...job.request.agent, provider: job.execution.provider, modelId: job.execution.modelId }
      : job.request.agent,
    execution: job.execution,
    analysisRange: job.request.analysisRange,
    cues: job.request.cues,
    sections: job.sections,
  });
  const vocabulary = document.sections.reduce((sum, scene) => sum + scene.focusItems.length, 0);
  if (
    vocabulary > job.request.profile.sceneCount * 2 ||
    document.sections.length > job.request.profile.sceneCount
  ) {
    throw new Error("Final lesson exceeds the configured video-wide learning budget");
  }
  // A crash can happen after the canonical document was saved but before the
  // completed status was checkpointed. Resume is idempotent only for the exact
  // same validated content; a conflicting saved document is never overwritten.
  const existingDocument = await storage.documents.get(document.id);
  if (existingDocument) {
    if (JSON.stringify(existingDocument) !== JSON.stringify(document)) {
      throw new Error("Saved document conflicts with the resumed V5 checkpoint");
    }
  } else {
    await storage.documents.save(document, toMarkdown(document));
  }
  const finished = await storage.jobs.update(jobId, current => {
    if (current.summary.status !== "running" || signal.aborted) {
      throw new Error("Job was interrupted while saving its document");
    }
    return {
      ...current,
      summary: {
        ...current.summary,
        status: "completed",
        documentId: document.id,
        updatedAt: new Date().toISOString(),
        ownerPid: undefined,
      },
    };
  });
  onProgress(finished.summary);
  return document;
}
