import type { LearningDocument, PronunciationSegment } from "./schema";

function safeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_[\]#<>])/g, "\\$1");
}

function pronunciationText(segments: PronunciationSegment[]): string {
  return segments
    .map(
      segment =>
        safeMarkdown(segment.text) +
        (segment.reading ? " (" + safeMarkdown(segment.reading) + ")" : ""),
    )
    .join("");
}

/** One canonical Markdown representation is shared by the Native Host, Drive backup and extension download. */
export function learningDocumentToMarkdown(doc: LearningDocument): string {
  const parts = [
    "# " + safeMarkdown(doc.source.title),
    "",
    "Target: " + doc.profile.targetLanguage + " · Level: " + doc.profile.level,
    "Teaching language: " + doc.profile.instructionLanguage,
    "",
  ];
  for (const section of doc.sections) {
    parts.push("## " + safeMarkdown(section.title), "", safeMarkdown(section.context), "");
    for (const id of section.cueIds) {
      const cue = doc.cues.find(item => item.id === id);
      if (!cue) continue;
      const time = cue.startMs === null ? "" : "[" + Math.floor(cue.startMs / 1000) + "s] ";
      const translation = section.translations.find(item => item.cueId === id)?.text;
      parts.push("> " + time + safeMarkdown(cue.originalText));
      const reading = section.pronunciations?.find(item => item.cueId === id);
      if (reading) parts.push("> Pronunciation: " + pronunciationText(reading.segments));
      if (translation) parts.push("> " + safeMarkdown(translation));
    }
    parts.push("", "### Focus expressions", "");
    for (const focus of section.focusItems) {
      parts.push(
        "#### " + safeMarkdown(focus.expression),
        "",
        safeMarkdown(focus.meaning),
        "",
        safeMarkdown(focus.contextExplanation),
        "",
        "Evidence cues: " + focus.contextCueIds.map(safeMarkdown).join(", "),
        "",
      );
      if (focus.wordNotes.length) parts.push("**Word notes**", "");
      for (const note of focus.wordNotes)
        parts.push(
          "- **" +
            safeMarkdown(note.surface) +
            "** — " +
            safeMarkdown(note.meaning) +
            ": " +
            safeMarkdown(note.explanation),
        );
      parts.push("", "**AI-created contextual examples**", "");
      for (const example of focus.examples) {
        parts.push("- " + safeMarkdown(example.situation));
        for (const line of example.dialogue) {
          parts.push("  - " + safeMarkdown(line.text) + " — " + safeMarkdown(line.translation));
          if (line.pronunciation)
            parts.push("    - Pronunciation: " + pronunciationText(line.pronunciation));
        }
      }
      parts.push("");
    }
    parts.push("");
  }
  if (doc.playbackOverrides && Object.keys(doc.playbackOverrides).length > 0) {
    parts.push("## User-calibrated playback (original subtitle times unchanged)", "");
    for (const cue of doc.cues) {
      const window = doc.playbackOverrides[cue.id];
      if (!window) continue;
      parts.push("- " + safeMarkdown(cue.id) + ": " + window.startMs + "–" + window.endMs + " ms");
    }
    parts.push("");
  }
  if (doc.scenePlaybackOverrides && Object.keys(doc.scenePlaybackOverrides).length > 0) {
    parts.push("## User-calibrated scene playback (original source times unchanged)", "");
    for (const scene of doc.sections) {
      const window = doc.scenePlaybackOverrides[scene.id];
      if (!window) continue;
      parts.push(
        "- " +
          safeMarkdown(scene.title) +
          " (" +
          safeMarkdown(scene.id) +
          "): " +
          window.startMs +
          "–" +
          window.endMs +
          " ms",
      );
    }
    parts.push("");
  }
  return parts.join("\n");
}

/** The canonical document retains the full source transcript for recovery. */
export function compactStudyExport(doc: LearningDocument): LearningDocument {
  const selected = new Set(doc.sections.flatMap(scene => scene.cueIds));
  return { ...doc, cues: doc.cues.filter(cue => selected.has(cue.id)) };
}
