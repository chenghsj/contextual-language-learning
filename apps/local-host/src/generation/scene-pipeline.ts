import { randomUUID } from "node:crypto";
import {
  CandidateBatchSchema, ContextualSceneContentSchema, FinalSelectionSchema, LearningDocumentSchema, StudySceneContentSchema, StudySceneV3Schema,
  chunkCues, normalizeLearningCues, type CandidateScene, type JobSummary, type SubtitleCue, type StudyScene, type StudySceneV3,
} from "@immersive/core";
import type { PipelineDependencies } from "./pipeline";
import { generateWithAgent } from "../agents";
import { candidatePrompt, contextualScenePrompt, selectionPrompt, studyScenePrompt } from "./scene-prompts";
import { toMarkdown } from "./markdown";

function assertRunning(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Generation interrupted");
}

function normalizeExpression(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
  chunk: SubtitleCue[], candidate: { cueIds: string[]; focusExpressions: string[]; learningGoal: string },
  chunkIndex: number, candidateIndex: number,
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
    if (!expressionCueIds(rows.map(row => row!.cue), exact).length) {
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
  chunk: SubtitleCue[], raw: unknown, chunkIndex: number,
): CandidateScene[] {
  const parsed = CandidateBatchSchema.parse(raw);
  const result: CandidateScene[] = [];
  const occupied = new Set<string>();
  for (const [index, candidate] of parsed.candidates.entries()) {
    const validated = validatedCandidate(chunk, candidate, chunkIndex, index);
    if (validated.cueIds.some(id => occupied.has(id))) continue;
    for (const id of validated.cueIds) occupied.add(id);
    result.push(validated);
  }
  return result;
}

export function chooseFinalScenes(
  raw: unknown, candidates: CandidateScene[], request: {
    profile: { sceneCount: number; maxNewVocabulary: number };
  }, allCues: SubtitleCue[],
): CandidateScene[] {
  const { selectedCandidateIds } = FinalSelectionSchema.parse(raw);
  const lookup = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const usedCues = new Set<string>();
  const usedExpressions = new Set<string>();
  const chosen: CandidateScene[] = [];
  const limit = Math.min(request.profile.sceneCount, request.profile.maxNewVocabulary);
  let remaining = request.profile.maxNewVocabulary;
  for (const id of selectedCandidateIds) {
    const candidate = lookup.get(id);
    if (!candidate) throw new Error("AI selected an unknown scene ID");
    if (chosen.some(scene => scene.id === candidate.id)) throw new Error("AI selected the same scene twice");
    if (candidate.cueIds.some(cue => usedCues.has(cue))) continue;
    const fresh = candidate.focusExpressions.filter(expression =>
      !usedExpressions.has(normalizeExpression(expression).toLocaleLowerCase()));
    if (!fresh.length) continue;
    if (chosen.length >= limit || remaining < 1) break;
    const focusExpressions = fresh.slice(0, Math.min(2, remaining));
    chosen.push({ ...candidate, focusExpressions });
    remaining -= focusExpressions.length;
    candidate.cueIds.forEach(cue => usedCues.add(cue));
    focusExpressions.forEach(expression => usedExpressions.add(normalizeExpression(expression).toLocaleLowerCase()));
  }
  const order = new Map(allCues.map((cue, index) => [cue.id, index]));
  chosen.sort((a, b) => (order.get(a.cueIds[0]) ?? Infinity) - (order.get(b.cueIds[0]) ?? Infinity));
  if (!chosen.length) throw new Error("No suitable dialogue scenes were selected. Try a different video or learning level.");
  return chosen;
}

export function assembleStudyScene(
  candidate: CandidateScene, cues: SubtitleCue[], raw: unknown, vocabularyLimit: number, exerciseLimit: number,
): StudyScene {
  const content = StudySceneContentSchema.parse(raw);
  if (content.vocabulary.length > vocabularyLimit || content.exercises.length > exerciseLimit) {
    throw new Error("Generated scene exceeds its allocated learning budget");
  }
  const cueIds = candidate.cueIds;
  const expected = new Set(cueIds);
  if (content.translations.length !== cueIds.length ||
      content.translations.some((translation, index) =>
        translation.cueId !== cueIds[index] || !expected.has(translation.cueId))) {
    throw new Error("Scene translations must reference every selected cue exactly once and in order");
  }
  for (const word of content.vocabulary) {
    if (!candidate.focusExpressions.some(focus => normalizeExpression(focus) === normalizeExpression(word.expression))) {
      throw new Error("AI introduced a vocabulary item outside the selected focus expressions");
    }
  }
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  const selected = cueIds.map(id => byId.get(id));
  if (selected.some(cue => !cue)) throw new Error("Selected source subtitles no longer exist");
  const focusCueIds: string[] = [];
  for (const expression of candidate.focusExpressions) {
    const matched = expressionCueIds(selected.map(cue => cue!), expression);
    if (!matched.length) throw new Error("Focus expression is no longer present in the original transcript");
    if (!focusCueIds.includes(matched[0])) focusCueIds.push(matched[0]);
  }
  const timed = selected.every(cue => cue!.startMs !== null && cue!.endMs !== null);
  const startMs = timed ? Math.min(...selected.map(cue => cue!.startMs!)) : null;
  const endMs = timed ? Math.max(...selected.map(cue => cue!.endMs!)) : null;
  return {
    ...content, id: randomUUID(), learningGoal: candidate.learningGoal,
    cueIds, focusCueIds, startMs, endMs,
  };
}

/** Reject model-provided source references or examples that contradict the canonical scene. */
export function assembleContextualScene(
  candidate: CandidateScene, cues: SubtitleCue[], raw: unknown, vocabularyLimit: number, exampleCount: number,
): StudySceneV3 {
  const content = ContextualSceneContentSchema.parse(raw);
  if (content.focusItems.length !== candidate.focusExpressions.length ||
      content.focusItems.length > vocabularyLimit) {
    throw new Error("Contextual scene must explain each selected focus expression exactly once");
  }
  if (content.translations.length !== candidate.cueIds.length ||
      content.translations.some((item, index) => item.cueId !== candidate.cueIds[index])) {
    throw new Error("Scene translations must reference every selected cue exactly once and in order");
  }
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  const selected = candidate.cueIds.map(id => byId.get(id));
  if (selected.some(cue => !cue)) throw new Error("Selected source subtitles no longer exist");
  const original = selected.map(cue => cue!);
  const inScene = new Set(candidate.cueIds);
  const focusCueIds: string[] = [];
  for (const [index, item] of content.focusItems.entries()) {
    if (normalizeExpression(item.expression) !== normalizeExpression(candidate.focusExpressions[index])) {
      throw new Error("Contextual expression must match the selected source phrase in order");
    }
    const actual = expressionCueIds(original, item.expression);
    if (!actual.length || actual.length !== item.sourceCueIds.length ||
        actual.some((id, position) => id !== item.sourceCueIds[position])) {
      throw new Error("Contextual expression source cue IDs do not match the original transcript");
    }
    if (!focusCueIds.includes(actual[0])) focusCueIds.push(actual[0]);
    if (item.contextCueIds.some(id => !inScene.has(id)) ||
        (candidate.cueIds.length > 1 && !item.contextCueIds.some(id => !actual.includes(id)))) {
      throw new Error("Context evidence must reference real neighboring dialogue cues");
    }
    if (item.wordNotes.some(word =>
        !normalizeExpression(item.expression).includes(normalizeExpression(word.surface)))) {
      throw new Error("Word notes must use surface forms from the selected focus expression");
    }
    if (item.examples.length !== exampleCount) {
      throw new Error("Contextual example count does not match the lesson setting");
    }
    const situations = item.examples.map(example => normalizeExpression(example.situation).toLowerCase());
    if (new Set(situations).size !== situations.length || item.examples.some(example =>
        !example.dialogue.some(line => normalizeExpression(line.text).includes(normalizeExpression(item.expression))))) {
      throw new Error("Contextual examples must use the focus expression in distinct situations");
    }
  }
  const timed = original.every(cue => cue.startMs !== null && cue.endMs !== null);
  return StudySceneV3Schema.parse({
    ...content, id: randomUUID(), learningGoal: candidate.learningGoal,
    cueIds: candidate.cueIds, focusCueIds,
    startMs: timed ? Math.min(...original.map(cue => cue.startMs!)) : null,
    endMs: timed ? Math.max(...original.map(cue => cue.endMs!)) : null,
    vocabulary: content.focusItems.map(item => ({
      expression: item.expression, meaning: item.meaning, explanation: item.contextExplanation,
      example: item.examples[0].dialogue.find(line =>
        normalizeExpression(line.text).includes(normalizeExpression(item.expression)))?.text ?? "",
    })),
    insights: [], exercises: [],
  });
}

export async function runSceneGenerationPipeline(
  jobId: string, deps: PipelineDependencies, signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
) {
  const { storage } = deps;
  const generate = deps.generateSection ?? generateWithAgent;
  let job = await storage.jobs.get(jobId);
  if (!job || job.summary.status !== "running" || !job.scenePlan) {
    throw new Error("Scene job is not in the running state");
  }
  const chunks = chunkCues(job.request.cues);
  const contextual = job.request.lessonFormat === "contextual-v3";
  const plan = job.scenePlan;
  if (plan.candidateChunks.length > chunks.length) throw new Error("Saved candidate checkpoint exceeds transcript");

  const existing = await storage.documents.get(jobId);
  if (existing) {
    if (job.summary.completed !== job.summary.total || existing.schemaVersion !== (contextual ? 3 : 2)) {
      throw new Error("Existing document conflicts with an incomplete scene job");
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

  for (let index = plan.candidateChunks.length; index < chunks.length; index++) {
    assertRunning(signal);
    const normalized = normalizeLearningCues(chunks[index]);
    const raw = normalized.length
      ? await (deps.generateCandidates ?? generate)(
          job.request.agent, candidatePrompt(job.request, normalized, index, chunks.length), signal)
      : { candidates: [] };
    assertRunning(signal);
    const candidates = validateCandidateBatch(normalized, raw, index);
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (!current.scenePlan || current.summary.status !== "running" ||
          current.scenePlan.candidateChunks.length !== index) {
        throw new Error("Scene candidate checkpoint changed during generation");
      }
      return {
        ...current, scenePlan: {
          ...current.scenePlan, candidateChunks: [...current.scenePlan.candidateChunks, candidates],
        },
        summary: {
          ...current.summary, completed: index + 1, updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }
  assertRunning(signal);
  if (!job.scenePlan!.selected) {
    const candidates = job.scenePlan!.candidateChunks.flat();
    if (!candidates.length) throw new Error("No learnable dialogue scenes were found in this transcript");
    const raw = await (deps.generateSelection ?? generate)(
      job.request.agent, selectionPrompt(job.request, candidates, job.request.cues), signal,
    );
    assertRunning(signal);
    const selected = chooseFinalScenes(raw, candidates, job.request, job.request.cues);
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (current.summary.status !== "running" || !current.scenePlan ||
          current.scenePlan.selected || current.scenePlan.candidateChunks.length !== chunks.length) {
        throw new Error("Scene selection checkpoint changed during generation");
      }
      return {
        ...current, scenePlan: { ...current.scenePlan, selected },
        summary: {
          ...current.summary, completed: chunks.length + 1,
          total: chunks.length + 1 + selected.length, updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }

  const selected = job.scenePlan!.selected!;
  const allCues = new Map(job.request.cues.map(cue => [cue.id, cue]));
  for (let index = job.sections.length; index < selected.length; index++) {
    assertRunning(signal);
    const candidate = selected[index];
    const cues = candidate.cueIds.map(id => allCues.get(id)!);
    const usedVocabulary = job.sections.reduce((sum, section) => sum + section.vocabulary.length, 0);
    const usedExercises = job.sections.reduce((sum, section) => sum + section.exercises.length, 0);
    const vocabularyBudget = Math.min(candidate.focusExpressions.length,
      job.request.profile.maxNewVocabulary - usedVocabulary);
    const exerciseBudget = Math.min(1, job.request.profile.exerciseCount - usedExercises);
    const exampleCount = job.request.profile.contextualExampleCount ?? 2;
    const raw = await generate(job.request.agent,
      contextual ? contextualScenePrompt(job.request, candidate, cues, vocabularyBudget, exampleCount)
        : studyScenePrompt(job.request, candidate, cues, vocabularyBudget, exerciseBudget), signal);
    assertRunning(signal);
    const section = contextual
      ? assembleContextualScene(candidate, job.request.cues, raw, vocabularyBudget, exampleCount)
      : assembleStudyScene(candidate, job.request.cues, raw, vocabularyBudget, exerciseBudget);
    job = await storage.jobs.update(jobId, current => {
      assertRunning(signal);
      if (current.summary.status !== "running" || !current.scenePlan?.selected ||
          current.sections.length !== index) {
        throw new Error("Scene content checkpoint changed during generation");
      }
      return {
        ...current, sections: [...current.sections, section],
        summary: {
          ...current.summary, completed: chunks.length + 2 + index,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    onProgress(job.summary);
  }
  assertRunning(signal);
  const document = LearningDocumentSchema.parse({
    id: job.summary.id, schemaVersion: contextual ? 3 : 2, createdAt: job.summary.createdAt,
    source: job.request.source, profile: job.request.profile, generation: job.request.agent,
    cues: job.request.cues, sections: job.sections,
  });
  if (document.schemaVersion !== (contextual ? 3 : 2)) throw new Error("Scene generation created an unexpected document version");
  const vocabulary = document.sections.reduce((sum, scene) => sum + scene.vocabulary.length, 0);
  const exercises = document.sections.reduce((sum, scene) => sum + scene.exercises.length, 0);
  if (vocabulary > job.request.profile.maxNewVocabulary ||
      exercises > job.request.profile.exerciseCount ||
      document.sections.length > job.request.profile.sceneCount) {
    throw new Error("Final lesson exceeds the configured video-wide learning budget");
  }
  await storage.documents.save(document, toMarkdown(document));
  const finished = await storage.jobs.update(jobId, current => {
    if (current.summary.status !== "running" || signal.aborted) {
      throw new Error("Job was interrupted while saving its document");
    }
    return {
      ...current, summary: {
        ...current.summary, status: "completed", documentId: document.id,
        updatedAt: new Date().toISOString(), ownerPid: undefined,
      },
    };
  });
  onProgress(finished.summary);
  return document;
}
