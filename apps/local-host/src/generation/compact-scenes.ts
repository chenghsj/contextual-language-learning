import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SourceUtteranceSchema,
  TeachingBatchOutputSchema,
  spanCueIds,
  validateCandidate,
  validateReferences,
  uniqueIds,
  contiguousIds,
  validateTeachingBatch,
  prepareTeachingBatch,
  explanationPreferences,
  CompactSceneSourceSchema,
  type GenerationRequest,
  type TeachingInput,
  type PronunciationDiagnostic,
} from "@contextual/core";

export const COMPACT_SCENE_EXPERIMENT_VERSION = "compact-scenes-experiment-1";
export const CompactSceneSchema = CompactSceneSourceSchema;
export type CompactScene = z.infer<typeof CompactSceneSchema>;
const CompactCandidates = z
  .object({
    status: z.literal("complete"),
    splitAfterCueId: z.null().optional(),
    candidates: z.array(
      z
        .object({
          firstCueId: z.string(),
          lastCueId: z.string(),
          contextCueIds: z.array(z.string()),
          learningValue: z.string().min(1).max(1500),
        })
        .strict(),
    ),
  })
  .strict();
export function readCompactCandidates(
  raw: unknown,
  request: GenerationRequest,
  primary: string[],
  sourceIds: string[],
): CompactScene[] {
  return CompactCandidates.parse(raw).candidates.map(c => {
    if (!primary.includes(c.firstCueId)) throw new Error("Candidate must start in primary window");
    const first = sourceIds.indexOf(c.firstCueId),
      last = sourceIds.indexOf(c.lastCueId);
    if (first < 0 || last < first) throw new Error("Invalid candidate source interval");
    validateReferences(c.contextCueIds, sourceIds, "Invalid candidate context");
    const dialogueCueIds = sourceIds.slice(first, last + 1);
    contiguousIds(dialogueCueIds, request.cues);
    return {
      id: randomUUID(),
      dialogueCueIds,
      contextCueIds: c.contextCueIds,
      learningValue: c.learningValue,
    };
  });
}
export function readCompactSelection(
  raw: unknown,
  pool: CompactScene[],
  request: GenerationRequest,
) {
  const { selectedCandidateIds: ids } = z
    .object({ selectedCandidateIds: z.array(z.string()).max(request.profile.sceneCount) })
    .strict()
    .parse(raw);
  validateReferences(
    ids,
    pool.map(s => s.id),
    "Invalid selected candidate ID",
  );
  const scenes = ids.map(id => pool.find(s => s.id === id)!);
  uniqueIds(
    scenes.flatMap(s => s.dialogueCueIds),
    "Overlapping selected scenes",
  );
  const starts = scenes.map(s => request.cues.findIndex(c => c.id === s.dialogueCueIds[0]));
  if (starts.some((n, i) => i > 0 && n <= starts[i - 1]))
    throw new Error("Scenes must follow source order");
  return scenes;
}
const SceneOutput = TeachingBatchOutputSchema.extend({
  sourceUnits: z.array(SourceUtteranceSchema.omit({ cueIds: true }).strict()).min(1),
}).strict();
/** Validate the new one-call contract through the existing complete teaching/source validators. */
export function readCompleteScene(raw: unknown, scene: CompactScene, request: GenerationRequest) {
  const { sourceUnits, ...teaching } = SceneOutput.parse(raw);
  uniqueIds(
    sourceUnits.map(u => u.id),
    "Duplicate source unit ID",
  );
  const ids = new Map(sourceUnits.map(u => [u.id, randomUUID()]));
  const unitId = (id: string) => {
    const value = ids.get(id);
    if (!value) throw new Error("Unknown source unit ID");
    return value;
  };
  const evidence = new Set([...scene.dialogueCueIds, ...scene.contextCueIds]);
  const input: TeachingInput = {
    scene: validateCandidate(
      {
        ...scene,
        opportunities: [],
        utterances: sourceUnits.map(u => ({
          ...u,
          id: unitId(u.id),
          cueIds: spanCueIds(u.sourceSpans),
        })),
      },
      scene.dialogueCueIds,
      request.cues,
      request.profile,
    ),
    requiredUtteranceIds: sourceUnits.map(u => unitId(u.id)),
    sourceWindow: request.cues.filter(c => evidence.has(c.id)),
    existingPoints: [],
    existingReusableItems: [],
  };
  const remapped = {
    ...teaching,
    utterances: teaching.utterances.map(u => ({ ...u, id: unitId(u.id) })),
    points: teaching.points.map(p => ({ ...p, utteranceIds: p.utteranceIds.map(unitId) })),
  };
  const namespace = `${scene.id}:complete`;
  const omittedReadings: PronunciationDiagnostic[] = [];
  if (remapped.pronunciations) {
    if (!explanationPreferences(request.profile).enabled.includes("pronunciation"))
      throw new Error("disabled_category: pronunciation");
    validateReferences(
      remapped.pronunciations.map(p => p.cueId),
      scene.dialogueCueIds,
      "Invalid pronunciation source reference",
    );
    const aligned = remapped.pronunciations.filter((p, index) => {
      if (
        p.segments.map(s => s.text).join("") ===
        request.cues.find(c => c.id === p.cueId)!.originalText
      )
        return true;
      omittedReadings.push({
        id: `${namespace}:source:${p.cueId}:annotation_alignment`,
        batchId: namespace,
        sceneId: scene.id,
        cueId: p.cueId,
        path: `/pronunciations/${index}`,
        code: "annotation_alignment",
        action: "omitted",
      });
      return false;
    });
    remapped.pronunciations = aligned.length ? aligned : undefined;
  }
  const prepared = prepareTeachingBatch(remapped, input, request.profile, namespace);
  const result = validateTeachingBatch(prepared.safeOutput, input, request.profile, namespace);
  return {
    input,
    result,
    diagnostics: [
      ...omittedReadings,
      ...prepared.diagnostics.map(d => ({
        ...d,
        action: d.action === "pending" ? ("omitted" as const) : d.action,
      })),
    ],
  };
}
