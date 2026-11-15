/** Offline coverage observations. Optional teaching choices are not correctness failures. */
import { readFile } from "node:fs/promises";
import { validateLearningDocumentV7, sourceSpanText } from "@contextual/core";
import { qualityV7Cases } from "./quality-v7-cases";
const paths = process.argv.slice(2);
for (const path of paths) {
  const doc = validateLearningDocumentV7(JSON.parse(await readFile(path, "utf8")));
  const source = qualityV7Cases.find(c => `${c.language}-${c.name}-automatic` === doc.source.title);
  if (!source) throw new Error("Unknown fixed case: " + doc.source.title);
  if (JSON.stringify(doc.cues.map(c => c.originalText)) !== JSON.stringify(source.lines))
    throw new Error("Case source differs from current fixture: " + path);
  const units = doc.sections.flatMap(s => s.utterances);
  const selected = new Set(units.flatMap(u => u.cueIds));
  const completeDialogueSelected = source.lines.every((_, index) => selected.has(`c${index + 1}`));
  const observations: Record<string, boolean | number> = {
    completeDialogueSelected,
    reusableTargets: doc.reusableItems.length,
  };
  if (source.name === "normal-transfer") {
    const response = units.filter(u => u.cueIds.includes("c4"));
    observations.responseTeachingObserved = response.some(
      u => u.pointIds.length > 0 || (u.chunks?.length ?? 0) > 0,
    );
  } else {
    observations.withinCueBoundaryExercised =
      units.filter(u => u.cueIds.includes("c2")).length >= 2;
    const unclear = /\[\?{2,}\]|悪いない/u;
    observations.unclearSourceSelected = units.some(u =>
      unclear.test(sourceSpanText(u.sourceSpans, doc.cues)),
    );
    for (const point of doc.points)
      if (unclear.test(sourceSpanText(point.sourceSpans, doc.cues)))
        throw new Error("Unclear source became a teaching target: " + path);
    for (const item of doc.reusableItems)
      if (item.sourceForms.some(f => unclear.test(f.text)))
        throw new Error("Unclear source became a reusable target: " + path);
  }
  const exercised =
    source.name === "normal-transfer"
      ? completeDialogueSelected
      : completeDialogueSelected &&
        observations.withinCueBoundaryExercised &&
        observations.unclearSourceSelected;
  console.log(
    JSON.stringify({
      case: doc.source.title,
      id: doc.id,
      coverage: exercised ? "exercised" : "not_exercised",
      observations,
      path,
    }),
  );
}
