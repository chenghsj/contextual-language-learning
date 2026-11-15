import type { LearningDocument, PronunciationSegment } from "./schema";
import { explanationPreferences } from "./explanations";
import { findExpressionOccurrences } from "./expression-occurrences";
import { subtitlePronunciationSegments } from "./subtitle-ruby";
import { readerPresentation } from "./reader-model";
import { UNRESTRICTED_LEVEL } from "./languages";

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
  return learningPointsMarkdown(doc);
}

/** The canonical document retains the full source transcript for recovery. */
export function compactStudyExport<T extends LearningDocument>(doc: T): T {
  // Presentation filtering must never discard source cues from the JSON backup.
  return { ...doc, cues: [...doc.cues] };
}

function learningPointsMarkdown(doc: import("./schema").LearningDocumentV7): string {
  const diagnostics = doc.execution?.pronunciationDiagnostics ?? [];
  const warnings = diagnostics.filter(d => d.action === "omitted");

  const parts = [
    "# " + safeMarkdown(doc.source.title),
    "",
    `V7 · ${doc.profile.targetLanguage} · ${doc.profile.level === UNRESTRICTED_LEVEL ? "Unrestricted" : doc.profile.level}`,
    `Teaching language: ${doc.profile.instructionLanguage}`,
    "",
  ];
  if (warnings.length)
    parts.push(
      "## Reading gaps",
      "",
      ...[...new Map(warnings.map(d => [d.batchId + ":" + d.path, d])).values()].map(
        d =>
          `- Some readings unavailable: ${safeMarkdown(d.cueId ?? d.itemId ?? d.batchId)} · ${d.code}`,
      ),
      "",
    );
  for (const scene of doc.sections) {
    parts.push("## " + safeMarkdown(scene.title), "", safeMarkdown(scene.context.text), "");
    const view = readerPresentation(doc, scene);
    for (const group of view.groups) {
      for (const id of group.sourceCueIds) {
        const cue = doc.cues.find(c => c.id === id)!;
        parts.push("> " + safeMarkdown(cue.originalText));
        parts.push("> " + safeMarkdown(scene.translations.find(t => t.cueId === id)!.text));
        const reading = subtitlePronunciationSegments(
          cue,
          scene.pronunciations?.find(p => p.cueId === id)?.segments,
        );
        if (reading) parts.push("> Pronunciation: " + pronunciationText(reading));
      }
      for (const u of group.analyses) {
        if (group.analyses.length > 1 && u.title)
          parts.push("", "### " + safeMarkdown(u.title), "");
        for (const basic of u.basics ?? []) {
          if (basic.meaning) parts.push("", safeMarkdown(basic.meaning));
          if (basic.contextExplanation) parts.push("", safeMarkdown(basic.contextExplanation));
        }
        parts.push("");
        for (const chunk of u.chunks ?? [])
          parts.push(
            "- **" +
              safeMarkdown(
                chunk.spans
                  .map(s =>
                    doc.cues.find(c => c.id === s.cueId)!.originalText.slice(s.start, s.end),
                  )
                  .join(" "),
              ) +
              "** — " +
              safeMarkdown(chunk.meaning) +
              (chunk.role ? " · " + safeMarkdown(chunk.role) : ""),
          );
        for (const p of u.notes) {
          parts.push(
            "- " +
              (p.presentation === "extended" ? "Further explanation" : "Core explanation") +
              ": **" +
              safeMarkdown(p.title) +
              "** — " +
              safeMarkdown(p.explanation),
          );
        }
        for (const item of u.focusIndexes.map(i => view.focusItems[i])) {
          parts.push(
            "",
            "### " + safeMarkdown(item.pattern ?? item.sourceForms!.map(f => f.text).join(" / ")),
            "",
          );
          if (item.kind === "frame") parts.push("Frame (not a source quote)", "");
          for (const form of item.sourceForms ?? []) {
            parts.push(
              "Source form: " + safeMarkdown(form.text),
              "",
              "Occurrences of this source form in saved subtitles:",
            );
            for (const o of findExpressionOccurrences(
              doc.cues,
              form.text,
              doc.profile.targetLanguage,
            ))
              parts.push(
                "- " +
                  (o.startMs === null ? "Untimed" : Math.floor(o.startMs / 1000) + "s") +
                  ": " +
                  o.cueIds
                    .map(id => safeMarkdown(doc.cues.find(c => c.id === id)!.originalText))
                    .join(" "),
              );
          }
          parts.push("", "AI-created contextual examples:");
          for (const e of item.examples) {
            parts.push("- " + safeMarkdown(e.situation));
            for (const line of e.dialogue) {
              parts.push("  - " + safeMarkdown(line.text) + " — " + safeMarkdown(line.translation));
              if (line.pronunciation)
                parts.push("    - Pronunciation: " + pronunciationText(line.pronunciation));
            }
          }
        }
        parts.push("");
      }
    }
  }
  for (const [label, overrides] of [
    ["User-calibrated playback", doc.playbackOverrides],
    ["User-calibrated scene playback", doc.scenePlaybackOverrides],
  ] as const) {
    if (overrides && Object.keys(overrides).length) {
      parts.push("## " + label + " (original source times unchanged)", "");
      for (const [id, r] of Object.entries(overrides))
        parts.push(`- ${safeMarkdown(id)}: ${r.startMs}–${r.endMs} ms`);
      parts.push("");
    }
  }
  return parts.join("\n");
}
