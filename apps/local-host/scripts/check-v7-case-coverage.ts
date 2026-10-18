/** Offline evidence gate. This verifies test coverage, not native linguistic correctness. */
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
  if (source.name === "normal-transfer") {
    if (!["c1", "c2", "c3", "c4"].every(id => selected.has(id)))
      throw new Error("Normal case did not retain complete dialogue: " + path);
    const response = units.filter(u => u.cueIds.includes("c4"));
    if (response.some(u => u.decision !== "basic_only" || u.pointIds.length || u.chunks?.length))
      throw new Error("Simple response has filler teaching: " + path);
    if (!doc.reusableItems.length) throw new Error("No transferable target: " + path);
  } else {
    if (units.filter(u => u.cueIds.includes("c2")).length < 2)
      throw new Error("Within-cue topic/quote boundary not exercised: " + path);
    const unclear = /\[\?{2,}\]|悪いない/u;
    if (!units.some(u => unclear.test(sourceSpanText(u.sourceSpans, doc.cues))))
      throw new Error("Unclear source was not selected: " + path);
    for (const point of doc.points)
      if (unclear.test(sourceSpanText(point.sourceSpans, doc.cues)))
        throw new Error("Unclear source became a teaching target: " + path);
    for (const item of doc.reusableItems)
      if (item.sourceForms.some(f => unclear.test(f.text)))
        throw new Error("Unclear source became a reusable target: " + path);
  }
  console.log(JSON.stringify({ case: doc.source.title, id: doc.id, coverage: "passed", path }));
}
