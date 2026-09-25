import type { LearningDocument } from "./schema";

/** Saved canonical V2 documents retain the complete transcript for source recovery.
 * A user-facing export only needs cues referenced by the curated scenes.
 * V1 exports remain unchanged so existing documents keep their original shape. */
export function compactStudyExport(doc: LearningDocument): LearningDocument {
  if (doc.schemaVersion === 1) return doc;
  const selected = new Set(doc.sections.flatMap(scene => scene.cueIds));
  return { ...doc, cues: doc.cues.filter(cue => selected.has(cue.id)) };
}
