import type { LearningDocument, PronunciationSegment } from "./schema";

function safeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_[\]#<>])/g, "\\$1");
}

function pronunciationText(segments: PronunciationSegment[]): string {
  return segments.map(segment => safeMarkdown(segment.text) +
    (segment.reading ? " (" + safeMarkdown(segment.reading) + ")" : "")).join("");
}

/** One canonical Markdown representation is shared by the Native Host, Drive backup and extension download. */
export function learningDocumentToMarkdown(doc: LearningDocument): string {
  const parts = [
    "# " + safeMarkdown(doc.source.title), "",
    "Target: " + doc.profile.targetLanguage + " · Level: " + doc.profile.level,
    "Teaching language: " + doc.profile.instructionLanguage, "",
  ];
  for (const section of doc.sections) {
    parts.push("## " + safeMarkdown(section.title), "", safeMarkdown(section.context), "");
    for (const id of section.cueIds) {
      const cue = doc.cues.find(item => item.id === id);
      if (!cue) continue;
      const time = cue.startMs === null ? "" : "[" + Math.floor(cue.startMs / 1000) + "s] ";
      const translation = "translations" in section
        ? section.translations.find(item => item.cueId === id)?.text : undefined;
      parts.push("> " + time + safeMarkdown(cue.originalText));
      if ("pronunciations" in section) {
        const reading = section.pronunciations?.find(item => item.cueId === id);
        if (reading) parts.push("> Pronunciation: " + pronunciationText(reading.segments));
      }
      if (translation) parts.push("> " + safeMarkdown(translation));
    }
    if ("focusItems" in section) {
      parts.push("", "### Focus expressions", "");
      for (const focus of section.focusItems) {
        parts.push("#### " + safeMarkdown(focus.expression),
          "", safeMarkdown(focus.meaning), "", safeMarkdown(focus.contextExplanation),
          "", "Evidence cues: " + focus.contextCueIds.map(safeMarkdown).join(", "), "");
        if (focus.wordNotes.length) parts.push("**Word notes**", "");
        for (const note of focus.wordNotes) parts.push("- **" + safeMarkdown(note.surface) +
          "** — " + safeMarkdown(note.meaning) + ": " + safeMarkdown(note.explanation));
        parts.push("", "**AI-created contextual examples**", "");
        for (const example of focus.examples) {
          parts.push("- " + safeMarkdown(example.situation));
          for (const line of example.dialogue) {
            parts.push("  - " + safeMarkdown(line.text) + " — " + safeMarkdown(line.translation));
            if (line.pronunciation) parts.push("    - Pronunciation: " + pronunciationText(line.pronunciation));
          }
        }
        parts.push("");
      }
      continue;
    }
    parts.push("", "### Vocabulary", "");
    for (const word of section.vocabulary) {
      parts.push("- **" + safeMarkdown(word.expression) + "** — " +
        safeMarkdown(word.meaning) + ": " + safeMarkdown(word.explanation));
    }
    parts.push("", "### Insights", "");
    for (const insight of section.insights) parts.push("- " + safeMarkdown(insight));
    parts.push("", "### Practice", "");
    for (const exercise of section.exercises) {
      parts.push("- " + safeMarkdown(exercise.question) + "\n  - Answer: " + safeMarkdown(exercise.answer));
    }
    parts.push("");
  }
  if (doc.schemaVersion === 3 && doc.playbackOverrides &&
      Object.keys(doc.playbackOverrides).length > 0) {
    parts.push("## User-calibrated playback (original subtitle times unchanged)", "");
    for (const cue of doc.cues) {
      const window = doc.playbackOverrides[cue.id];
      if (!window) continue;
      parts.push("- " + safeMarkdown(cue.id) + ": " + window.startMs + "–" + window.endMs + " ms");
    }
    parts.push("");
  }
  if (doc.schemaVersion === 3 && doc.scenePlaybackOverrides &&
      Object.keys(doc.scenePlaybackOverrides).length > 0) {
    parts.push("## User-calibrated scene playback (original source times unchanged)", "");
    for (const scene of doc.sections) {
      const window = doc.scenePlaybackOverrides[scene.id];
      if (!window) continue;
      parts.push("- " + safeMarkdown(scene.title) + " (" + safeMarkdown(scene.id) + "): " +
        window.startMs + "–" + window.endMs + " ms");
    }
    parts.push("");
  }
  return parts.join("\n");
}

/** Saved canonical V2/V3 documents retain the complete transcript for source recovery.
 * A user-facing export only needs cues referenced by the curated scenes.
 * V1 exports remain unchanged so existing documents keep their original shape. */
export function compactStudyExport(doc: LearningDocument): LearningDocument {
  if (doc.schemaVersion === 1) return doc;
  const selected = new Set(doc.sections.flatMap(scene => scene.cueIds));
  return { ...doc, cues: doc.cues.filter(cue => selected.has(cue.id)) };
}
