import type { LearningDocument } from "@immersive/core";

function safeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_[\]#<>])/g, "\\$1");
}

export function toMarkdown(doc: LearningDocument): string {
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
      const translation = "translations" in section ? section.translations.find(item => item.cueId === id)?.text : undefined;
      parts.push("> " + time + safeMarkdown(cue.originalText));
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
  return parts.join("\n");
}
