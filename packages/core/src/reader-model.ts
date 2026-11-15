import { hasUncertaintyDisclosure } from "./source-uncertainty";
import type { LearningSceneV7, LearningDocument, ReusableItem } from "./schema";
type LearningUtterance = LearningSceneV7["utterances"][number];
export type ReaderDocument = Pick<LearningDocument, "cues" | "points" | "reusableItems"> & {
  execution?: Pick<
    NonNullable<LearningDocument["execution"]>,
    "pointEquivalenceGroups" | "itemEquivalenceGroups" | "pronunciationDiagnostics"
  >;
};
const equivalentId = (id: string, groups: string[][] = []) =>
  groups.find(g => g.includes(id))?.[0] ?? id;
import type { ExplanationType, SourceSpan } from "./explanations";
/** Display fields assembled exclusively from the current lesson format. */
export type ReaderItem = {
  expression: string;
  sourceCueIds: string[];
  meaning: string;
  contextExplanation: string;
  contextCueIds: string[];
  wordNotes: { surface: string; meaning: string; explanation: string }[];
  examples: ReusableItem["examples"];
  id?: string;
  kind?: "expression" | "frame";
  sourceForms?: ReusableItem["sourceForms"];
  pattern?: string;
  pointIds?: string[];
};
export type ReaderNote = {
  id: string;
  type: ExplanationType;
  title: string;
  explanation: string;
  chunkIds?: string[];
  presentation: "core" | "extended";
  sourceSpans?: SourceSpan[];
};
/** Only identical source ranges establish a chunk association. No text guessing. */
export function exactChunkIds(
  spans: SourceSpan[] | undefined,
  chunks: LearningUtterance["chunks"],
) {
  const key = (ranges: SourceSpan[]) =>
    ranges
      .map(s => `${s.cueId}:${s.start}:${s.end}`)
      .sort()
      .join("|");
  return spans?.length
    ? (chunks?.filter(c => key(c.spans) === key(spans)).map(c => c.id) ?? [])
    : [];
}
export type ReaderAnalysis = {
  id: string;
  title?: string;
  sourceCueIds: string[];
  sourceSpans: SourceSpan[];
  chunks?: LearningUtterance["chunks"];
  notes: ReaderNote[];
  itemChunkIds: Record<number, string[]>;
  focusIndexes: number[];
  basics?: { meaning: string; contextExplanation: string }[];
};
export type ReaderScene = Omit<LearningSceneV7, "context" | "utterances"> & {
  context: string;
  focusItems: ReaderItem[];
  analyses: ReaderAnalysis[];
};
/** Complete source coverage does not imply that every unit needs a teaching UI. */
export function hasUtteranceExplanation(utterance: LearningUtterance): boolean {
  return !!(
    utterance.meaning.trim() ||
    utterance.contextExplanation.trim() ||
    utterance.pointIds.length ||
    utterance.chunks?.length
  );
}

export type ReaderGroup = {
  id: string;
  sourceCueIds: string[];
  anchorCueId: string;
  analyses: ReaderAnalysis[];
};

/** Display-only normalization. Never removes fields from the saved document.
 * Deduplication is local to one source unit; uncertainty is always explicit.
 */
export function readerPresentation(
  document: ReaderDocument,
  source: LearningSceneV7,
  translationVisible = true,
): ReaderScene & { groups: ReaderGroup[] } {
  const scene = readerScene(document, source);
  const cueIndex = (id: string) => source.cueIds.indexOf(id);
  const sourceText = (spans: SourceSpan[]) => {
    const ordered = [...spans].sort(
      (a, b) => cueIndex(a.cueId) - cueIndex(b.cueId) || a.start - b.start,
    );
    return ordered
      .map((span, i) => {
        const previous = ordered[i - 1];
        const separator = !previous
          ? ""
          : previous.cueId !== span.cueId
            ? " "
            : previous.end === span.start
              ? ""
              : " … ";
        return (
          separator +
          document.cues.find(c => c.id === span.cueId)!.originalText.slice(span.start, span.end)
        );
      })
      .join("")
      .trim();
  };
  const analyses = scene.analyses
    .map(analysis => {
      const translations = analysis.sourceCueIds.map(
        id => source.translations.find(t => t.cueId === id)?.text.trim() ?? "",
      );
      const seen = new Set(translationVisible ? [...translations, translations.join(" ")] : []);
      const unique = (text: string | undefined) => {
        const key = text?.trim() ?? "";
        if (!key) return "";
        // An uncertainty disclosure is needed at each affected claim, even when repeated.
        const uncertain = hasUncertaintyDisclosure(key);
        if (!uncertain && seen.has(key)) return "";
        seen.add(key);
        return key;
      };
      const basics = analysis.basics
        ?.map(b => ({
          meaning: unique(b.meaning),
          contextExplanation: unique(b.contextExplanation),
        }))
        .filter(b => b.meaning || b.contextExplanation);
      const chunks = analysis.chunks
        ?.map(c => ({
          ...c,
          meaning: unique(c.meaning),
          role: unique(c.role),
        }))
        .filter(c => c.meaning || c.role);
      const notes = [...analysis.notes]
        .sort(
          (a, b) => Number(a.presentation === "extended") - Number(b.presentation === "extended"),
        )
        .filter((n, i, all) => all.findIndex(other => other.id === n.id) === i)
        .map(n => ({ ...n, explanation: unique(n.explanation) }))
        .filter(n => n.explanation);
      return { ...analysis, title: sourceText(analysis.sourceSpans), basics, chunks, notes };
    })
    .filter(
      a =>
        a.basics?.length ||
        a.chunks?.length ||
        a.notes.length ||
        a.focusIndexes.some(i => scene.focusItems[i].examples.length),
    );
  // Build connected components from ALL source units, including units without
  // explanations, so shared and cross-cue source is emitted once in every view.
  const groups: ReaderGroup[] = [];
  for (const u of source.utterances) {
    const touching = groups.filter(g => g.sourceCueIds.some(id => u.cueIds.includes(id)));
    const ids = new Set([...u.cueIds, ...touching.flatMap(g => g.sourceCueIds)]);
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    const sourceCueIds = source.cueIds.filter(id => ids.has(id));
    groups.push({
      id: sourceCueIds[0],
      sourceCueIds,
      anchorCueId: sourceCueIds.at(-1)!,
      analyses: [],
    });
  }
  groups.sort((a, b) => cueIndex(a.sourceCueIds[0]) - cueIndex(b.sourceCueIds[0]));
  for (const group of groups) {
    group.analyses = analyses
      .filter(a => a.sourceCueIds.some(id => group.sourceCueIds.includes(id)))
      .sort((a, b) => {
        const first = (unit: ReaderAnalysis) =>
          [...unit.sourceSpans].sort(
            (x, y) => cueIndex(x.cueId) - cueIndex(y.cueId) || x.start - y.start,
          )[0];
        const x = first(a),
          y = first(b);
        return cueIndex(x.cueId) - cueIndex(y.cueId) || x.start - y.start;
      });
  }
  return { ...scene, analyses, groups };
}
/** Presentation only. Never serialize this adapter as a learning document. */
export function readerScene(document: ReaderDocument, source: LearningSceneV7): ReaderScene {
  const items = document.reusableItems.filter(item =>
    item.pointIds.some(id => source.utterances.some(u => u.pointIds.includes(id))),
  );
  const focusItems: ReaderItem[] = items.map(item => ({
    id: item.id,
    pointIds: item.pointIds,
    expression: item.pattern ?? item.sourceForms.map(f => f.text).join(" / "),
    sourceCueIds: [...new Set(item.sourceForms.flatMap(f => f.cueIds))],
    meaning: "",
    contextExplanation: "",
    contextCueIds: [],
    wordNotes: [],
    examples:
      document.reusableItems.find(
        i => i.id === equivalentId(item.id, document.execution?.itemEquivalenceGroups),
      )?.examples ?? item.examples,
    kind: item.kind,
    pattern: item.pattern,
    sourceForms: item.sourceForms,
  }));
  return {
    ...source,
    context: source.context.text,
    focusItems,
    analyses: source.utterances.filter(hasUtteranceExplanation).map(u => ({
      id: u.id,
      sourceCueIds: u.cueIds,
      sourceSpans: u.sourceSpans,
      chunks: u.chunks,
      basics: [{ meaning: u.meaning, contextExplanation: u.contextExplanation }],
      itemChunkIds: Object.fromEntries(
        items.map((item, index) => [
          index,
          [
            ...new Set(
              item.pointIds.flatMap(id =>
                exactChunkIds(document.points.find(p => p.id === id)?.sourceSpans, u.chunks),
              ),
            ),
          ],
        ]),
      ),
      focusIndexes: items.flatMap((item, i) =>
        item.pointIds.some(id => u.pointIds.includes(id)) ? [i] : [],
      ),
      notes: [...new Set(u.pointIds)].map(id => {
        const p = document.points.find(p => p.id === id);
        if (!p) throw new Error("Missing learning point");
        const canonical =
          document.points.find(
            point => point.id === equivalentId(p.id, document.execution?.pointEquivalenceGroups),
          ) ?? p;
        return {
          id: canonical.id,
          type: p.category,
          title: canonical.title,
          explanation: canonical.explanation,
          presentation: p.presentation ?? "core",
          sourceSpans: p.sourceSpans,
          chunkIds: exactChunkIds(p.sourceSpans, u.chunks),
        };
      }),
    })),
  };
}
