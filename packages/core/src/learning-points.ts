import { hasUncertaintyDisclosure } from "./source-uncertainty";
import { QualityRiskSchema } from "./quality";
import {
  graphemeBoundaries,
  validateUnitCoverage,
  spanCueIds,
  sourceSpanText,
  assertContainedSpans,
} from "./source-units";
import type { LearningCandidate } from "./jobs";
import {
  LearningDocumentV7Schema,
  LearningSceneV7Schema,
  LearningPointSchema,
  ReusableItemSchema,
  UtteranceTeachingSchema,
  CuePronunciationSchema,
  PronunciationSegmentSchema,
  StudyTranslationSchema,
  type LearningDocumentV7,
  type LearningPoint,
  type ReusableItem,
  type LearningProfile,
  type SubtitleCue,
  type LearningSceneV7,
} from "./schema";
import { z } from "zod";
import { validPronunciationReading } from "./pronunciation-reading";
import type { PronunciationDiagnostic } from "./execution";
import { explanationPreferences, type SourceSpan } from "./explanations";

export const TeachingBatchOutputSchema = z
  .object({
    risks: z.array(QualityRiskSchema).max(100).default([]),
    status: z.literal("complete"),
    sceneId: z.string(),
    title: z.string().min(1).max(180),
    context: z
      .object({ text: z.string().min(1).max(3000), evidenceCueIds: z.array(z.string()) })
      .strict(),
    translations: z.array(StudyTranslationSchema),
    utterances: z.array(UtteranceTeachingSchema).min(1),
    points: z.array(LearningPointSchema),
    reusableItems: z.array(ReusableItemSchema),
    pronunciations: z.array(CuePronunciationSchema).optional(),
  })
  .strict();
export const TeachingSplitSchema = z
  .object({
    status: z.literal("needs_split"),
    sceneId: z.string(),
    utteranceGroups: z.array(z.array(z.string()).min(1)).min(2),
  })
  .strict();
export const TeachingBlockedSchema = z
  .object({
    status: z.literal("blocked"),
    sceneId: z.string(),
    reason: z.literal("single_utterance_exceeds_budget"),
    utteranceIds: z.array(z.string()).length(1),
  })
  .strict();
export type TeachingBatchOutput = z.infer<typeof TeachingBatchOutputSchema>;
export type TeachingInput = {
  scene: LearningCandidate;
  requiredUtteranceIds: string[];
  sourceWindow: SubtitleCue[];
  existingPoints: LearningPoint[];
  existingReusableItems: ReusableItem[];
};
function fail(message: string): never {
  throw new Error(message);
}
export function exactIds(
  actual: readonly string[],
  expected: readonly string[],
  description: string,
) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(description);
}
export function uniqueIds(ids: readonly string[], description: string) {
  if (new Set(ids).size !== ids.length) fail(description);
}
export function validateReferences(
  ids: readonly string[],
  allowed: readonly string[],
  description: string,
) {
  uniqueIds(ids, description);
  if (ids.some(id => !allowed.includes(id))) fail(description);
}
export function validateSpans(
  spans: SourceSpan[],
  cues: SubtitleCue[],
  allowed: string[],
  ordered = true,
) {
  if (!spans.length) fail("invalid_span: empty spans");
  let previousIndex = -1,
    previousEnd = 0;
  for (const span of spans) {
    const index = cues.findIndex(c => c.id === span.cueId),
      text = cues[index]?.originalText;
    if (
      text === undefined ||
      !allowed.includes(span.cueId) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > text.length
    )
      fail(
        `invalid_span: ${JSON.stringify(span)} outside original source ${JSON.stringify({ text, utf16Length: text?.length })}. Use exclusive UTF-16 offsets or omit unreliable optional spans/chunks.`,
      );
    const boundaries = graphemeBoundaries(text);
    if (!boundaries.has(span.start) || !boundaries.has(span.end))
      fail("invalid_span: split Unicode grapheme cluster");
    if (ordered && (index < previousIndex || (index === previousIndex && span.start < previousEnd)))
      fail("invalid_span: overlapping or out of order");
    previousIndex = index;
    previousEnd = span.end;
  }
}
export function contiguousIds(ids: string[], cues: SubtitleCue[]) {
  if (!ids.length) fail("invalid_source_reference: empty source");
  const first = cues.findIndex(c => c.id === ids[0]);
  if (first < 0 || ids.some((id, i) => cues[first + i]?.id !== id))
    fail("invalid_source_reference: source must be contiguous and ordered");
}
export function validateCandidate(
  candidate: LearningCandidate,
  primaryIds: string[],
  source: SubtitleCue[],
  profile: LearningProfile,
) {
  contiguousIds(candidate.dialogueCueIds, source);
  if (!primaryIds.includes(candidate.dialogueCueIds[0]))
    fail("invalid_source_reference: candidate must start in primary window");
  validateReferences(
    candidate.contextCueIds,
    source.map(c => c.id),
    "invalid_source_reference: candidate context",
  );
  validateUnitCoverage(candidate.utterances, candidate.dialogueCueIds, source);
  uniqueIds(
    candidate.utterances.map(u => u.id),
    "duplicate_local_id: utterance",
  );
  const enabled = explanationPreferences(profile).enabled;
  for (const hint of candidate.opportunities) {
    if (!enabled.includes(hint.category)) fail("disabled_category: candidate opportunity");
    validateReferences(
      hint.sourceCueIds,
      candidate.dialogueCueIds,
      "invalid_source_reference: candidate opportunity",
    );
  }
  return candidate;
}
function validatePronunciations(
  pronunciations: LearningSceneV7["pronunciations"],
  cues: SubtitleCue[],
  assigned: string[],
  enabled: boolean,
) {
  if (!enabled && pronunciations !== undefined) fail("disabled_category: pronunciation");
  uniqueIds(pronunciations?.map(p => p.cueId) ?? [], "duplicate pronunciation");
  for (const item of pronunciations ?? []) {
    if (!assigned.includes(item.cueId))
      fail(
        `invalid_source_reference: pronunciation cue ${JSON.stringify(item.cueId)} is not assigned`,
      );
    const expected = cues.find(c => c.id === item.cueId)?.originalText;
    const actual = item.segments.map(s => s.text).join("");
    if (actual !== expected)
      fail(
        `invalid pronunciation alignment: cue ${JSON.stringify(item.cueId)}, expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}. Segment text must concatenate exactly to the unchanged cue.`,
      );
  }
}
function validateTeachingBatchInternal(
  raw: unknown,
  input: TeachingInput,
  profile: LearningProfile,
  namespace: string,
  checkReadings = true,
  checkTeaching = true,
) {
  const output = TeachingBatchOutputSchema.parse(raw);
  if (output.sceneId !== input.scene.id) fail("invalid_source_reference: scene ID");
  const assigned = input.requiredUtteranceIds.map(
    id => input.scene.utterances.find(u => u.id === id) ?? fail("Unknown assigned utterance"),
  );
  exactIds(
    output.utterances.map(u => u.id),
    input.requiredUtteranceIds,
    "missing_utterance: exact assigned coverage required",
  );
  const assignedCues = [...new Set(assigned.flatMap(u => u.cueIds))],
    windowIds = input.sourceWindow.map(c => c.id);
  exactIds(
    output.translations.map(t => t.cueId),
    assignedCues,
    "missing_utterance: translation coverage",
  );
  validateReferences(
    output.context.evidenceCueIds,
    windowIds,
    "invalid_source_reference: scene evidence",
  );
  const enabled = explanationPreferences(profile).enabled;
  uniqueIds(
    [
      ...output.points.map(p => p.id),
      ...output.reusableItems.map(i => i.id),
      ...output.utterances.flatMap(u => (u.chunks ?? []).map(c => c.id)),
    ],
    "duplicate_local_id",
  );
  const oldIds = input.existingPoints.map(p => p.id),
    newIds = output.points.map(p => p.id);
  if (newIds.some(id => oldIds.includes(id)))
    fail("duplicate_local_id: collides with existing point");
  for (const u of output.utterances) {
    validateReferences(u.contextCueIds, windowIds, "invalid_source_reference: utterance context");
    validateReferences(u.pointIds, [...oldIds, ...newIds], "invalid_point_reference");
    if ((u.decision === "explained") !== u.pointIds.length > 0)
      fail("invalid_point_reference: utterance decision");
    if (!enabled.includes("chunks") && u.chunks !== undefined) fail("disabled_category: chunks");
    const chunkIds = u.chunks?.map(c => c.id) ?? [];
    uniqueIds(chunkIds, "duplicate_local_id: chunk");
    validateSpansAcrossChunks(
      u.chunks ?? [],
      input.sourceWindow,
      assigned.find(a => a.id === u.id)!.cueIds,
    );
    assertContainedSpans(
      (u.chunks ?? []).flatMap(c => c.spans),
      assigned.find(a => a.id === u.id)!.sourceSpans,
    );
    if (checkTeaching)
      for (const chunk of u.chunks ?? []) {
        const text = chunk.spans
          .map(span =>
            input.sourceWindow
              .find(c => c.id === span.cueId)!
              .originalText.slice(span.start, span.end),
          )
          .join("");
        if (!/[\p{L}\p{N}]/u.test(text))
          fail(
            "invalid_chunk: whitespace or punctuation is not a meaningful understanding segment",
          );
        // Conservative lexical guard, not a morphological parser. Old files bypass it.
        // If boundaries are uncertain the model can omit chunks without losing teaching.
        for (const span of chunk.spans) {
          const source = input.sourceWindow.find(c => c.id === span.cueId)!.originalText;
          if (
            profile.targetLanguage === "ja" &&
            /[っッ]$/u.test(source.slice(span.start, span.end)) &&
            /[\p{L}]/u.test(source[span.end] ?? "")
          )
            fail(
              "invalid_chunk: Japanese inflection ends mid-word; preserve the full form or omit chunks",
            );
          const words = new Intl.Segmenter(profile.targetLanguage, { granularity: "word" }).segment(
            source,
          );
          for (const word of words) {
            if (!word.isWordLike) continue;
            if (
              [span.start, span.end].some(
                offset => offset > word.index && offset < word.index + word.segment.length,
              )
            )
              fail(
                `invalid_chunk: ${span.cueId} ${span.start}:${span.end} cuts inside ${JSON.stringify(word.segment)}; preserve whole words or omit unreliable chunks`,
              );
          }
        }
      }
    for (const id of u.pointIds) {
      const p =
        output.points.find(p => p.id === id) ?? input.existingPoints.find(p => p.id === id)!;
      if (!enabled.includes(p.category)) fail("disabled_category: referenced point");
      if (newIds.includes(id) && !p.utteranceIds.includes(u.id))
        fail("invalid_point_reference: reciprocal association");
    }
  }
  for (const p of output.points) {
    if (checkTeaching && p.presentation === undefined)
      fail("missing_presentation: new learning points require core or extended");
    if (!enabled.includes(p.category)) fail("disabled_category: point");
    validateReferences(
      p.utteranceIds,
      input.requiredUtteranceIds,
      "invalid_point_reference: point utterances",
    );
    const pointCues = assigned.filter(u => p.utteranceIds.includes(u.id)).flatMap(u => u.cueIds);
    validateReferences(p.sourceCueIds, pointCues, "invalid_source_reference: point source");
    if (!p.sourceCueIds.length) fail("invalid_source_reference: point needs source");
    validateReferences(p.contextCueIds, windowIds, "invalid_source_reference: point context");
    validateSpans(p.sourceSpans, input.sourceWindow, p.sourceCueIds);
    exactIds(
      spanCueIds(p.sourceSpans),
      p.sourceCueIds,
      "Point cue IDs must derive from source spans",
    );
    assertContainedSpans(
      p.sourceSpans,
      assigned.filter(u => p.utteranceIds.includes(u.id)).flatMap(u => u.sourceSpans),
    );
    if (
      p.utteranceIds.some(id => !output.utterances.find(u => u.id === id)?.pointIds.includes(p.id))
    )
      fail("invalid_point_reference: orphan point");
  }
  for (const item of output.reusableItems) {
    // This is a narrow batch-generation guard, not a general morphology parser.
    // Persisted compatible lessons keep the validation rules they were saved with.
    if (
      checkTeaching &&
      profile.targetLanguage === "ja" &&
      item.kind === "frame" &&
      typeof item.pattern === "string" &&
      /\[\s*(?:動詞(?:的)?て形|Vて形|verb\s+te[- ]form)(?:\s*省略[「『]?い[」』]?)?\s*\]\s*(?:[+＋]\s*)?[てで]た/iu.test(
        item.pattern,
      )
    )
      fail(
        `invalid_construction: frame ${item.id} appends a second て/で after a complete te-form slot. Reconstruct [動詞て形]いた, then omit only auxiliary い to obtain [動詞て形]た. Check both 話していた→話してた and 読んでいた→読んでた. Preserve exact source and examples.`,
      );
    if (
      profile.targetLanguage === "ja" &&
      item.kind === "frame" &&
      typeof item.pattern === "string" &&
      /\[\s*(?:動詞(?:的)?て形|Vて形|verb\s+te[- ]form)\s*\]\s*(?:[+＋]\s*)?ても/iu.test(
        item.pattern,
      )
    )
      fail(
        `invalid_construction: frame ${item.id} repeats て after a complete te-form slot. Use [動詞て形]も, not [動詞て形]ても; substituting 練習して must produce 練習しても, not 練習してても. Preserve the exact source and example.`,
      );
    validateReferences(item.pointIds, newIds, "invalid_point_reference: new reusable item");
    const pointCues = output.points
      .filter(p => item.pointIds.includes(p.id))
      .flatMap(p => p.sourceCueIds);
    uniqueIds(
      item.sourceForms.map(f => JSON.stringify(f)),
      "Duplicate source forms",
    );
    for (const form of item.sourceForms) {
      validateReferences(form.cueIds, pointCues, "invalid_source_reference: reusable form");
      validateSpans(form.sourceSpans, input.sourceWindow, form.cueIds);
      exactIds(
        spanCueIds(form.sourceSpans),
        form.cueIds,
        "Form cue IDs must derive from source spans",
      );
      const parents = assigned
        .filter(u =>
          output.points.some(p => item.pointIds.includes(p.id) && p.utteranceIds.includes(u.id)),
        )
        .flatMap(u => u.sourceSpans);
      assertContainedSpans(form.sourceSpans, parents);
      const joined = sourceSpanText(form.sourceSpans, input.sourceWindow),
        spaced = sourceSpanText(form.sourceSpans, input.sourceWindow, " ");
      if (form.text !== joined && form.text !== spaced) {
        let hint = "";
        if (form.sourceSpans.length === 1) {
          const span = form.sourceSpans[0];
          const cue = input.sourceWindow.find(c => c.id === span.cueId)!;
          const end = span.start + form.text.length;
          if (
            cue.originalText.slice(span.start, end) === form.text &&
            graphemeBoundaries(cue.originalText).has(end)
          ) {
            try {
              assertContainedSpans([{ ...span, end }], parents);
              hint = ` The exact source text at this start has UTF-16 end ${end} (exclusive); correct the range, not the source text.`;
            } catch {
              /* No hint outside the associated immutable units. */
            }
          }
        }
        fail(
          `invalid_source_reference: item ${item.id} source form ${JSON.stringify(form.text)} does not match ${JSON.stringify(joined)} or ${JSON.stringify(spaced)} sliced from ${JSON.stringify(form.sourceSpans)}.${hint}`,
        );
      }
    }
    if (item.examples.length !== profile.contextualExampleCount) fail("example_count_mismatch");
    uniqueIds(
      item.examples.map(e => e.situation.trim().toLocaleLowerCase()),
      "duplicate example situation",
    );
    for (const e of item.examples) {
      if (!e.dialogue[e.targetLineIndex]?.text.includes(e.targetText))
        fail(
          `invalid_example_target: item ${item.id}, targetLineIndex ${e.targetLineIndex}, targetText ${JSON.stringify(e.targetText)} is not in ${JSON.stringify(e.dialogue[e.targetLineIndex]?.text)}. Index is zero-based; copy an exact substring from the selected dialogue line.`,
        );
      if (item.kind === "expression" && !item.sourceForms.some(f => f.text === e.targetText))
        fail(
          `invalid_example_target: expression ${item.id} target ${JSON.stringify(e.targetText)} must reproduce one exact source form ${JSON.stringify(item.sourceForms.map(f => f.text))}. Use a frame with a separate pattern only when variable morphology is taught; otherwise preserve the exact expression.`,
        );
      for (const line of e.dialogue) {
        if (!enabled.includes("pronunciation") && line.pronunciation !== undefined)
          fail("disabled_category: example pronunciation");
        if (line.pronunciation && line.pronunciation.map(s => s.text).join("") !== line.text)
          fail(
            `invalid pronunciation alignment: example item ${JSON.stringify(item.id)}, expected ${JSON.stringify(line.text)}, actual ${JSON.stringify(line.pronunciation.map(s => s.text).join(""))}. Preserve exact spacing and punctuation.`,
          );
      }
    }
  }
  const annotations = [
    ...(output.pronunciations?.map(p => p.segments) ?? []),
    ...output.reusableItems.flatMap(i =>
      i.examples.flatMap(e => e.dialogue.flatMap(l => (l.pronunciation ? [l.pronunciation] : []))),
    ),
  ];
  for (const segments of checkReadings ? annotations : []) {
    if (!segments.some(s => s.reading))
      fail(
        `Pronunciation annotation for ${JSON.stringify(segments.map(s => s.text).join(""))} has no reliable reading. Omit this whole annotation instead of returning segments with no readings.`,
      );
    for (const segment of segments)
      if (segment.reading) {
        const r = segment.reading;
        const valid = validPronunciationReading(r, profile.targetLanguage);
        if (!valid)
          fail(
            `Invalid pronunciation writing system for ${profile.targetLanguage}: ${JSON.stringify(r)}. Japanese readings use hiragana; Korean readings Hangul; zh-TW Zhuyin; zh-CN tone-marked Hanyu Pinyin; other languages slash-delimited IPA. Omit uncertain readings.`,
          );
      }
  }
  validatePronunciations(
    output.pronunciations,
    input.sourceWindow,
    assignedCues,
    enabled.includes("pronunciation"),
  );
  const stableId = (id: string) => (namespace ? `${namespace}:${id}` : id);
  const pointId = (id: string) => (newIds.includes(id) ? stableId(id) : id);
  const points = output.points.map(p => ({ ...p, id: pointId(p.id) }));
  const reusableItems = output.reusableItems.map(i => ({
    ...i,
    id: stableId(i.id),
    pointIds: i.pointIds.map(pointId),
  }));
  const source = input.sourceWindow.filter(c => assignedCues.includes(c.id));
  const timed = source.every(c => c.startMs !== null && c.endMs !== null);
  const section = LearningSceneV7Schema.parse({
    id: input.scene.id,
    cueIds: assignedCues,
    contextCueIds: input.scene.contextCueIds,
    startMs: timed ? Math.min(...source.map(c => c.startMs!)) : null,
    endMs: timed ? Math.max(...source.map(c => c.endMs!)) : null,
    title: output.title,
    context: output.context,
    translations: output.translations,
    pronunciations: output.pronunciations,
    utterances: output.utterances.map((u, i) => ({
      ...u,
      cueIds: assigned[i].cueIds,
      sourceSpans: assigned[i].sourceSpans,
      pointIds: u.pointIds.map(pointId),
      chunks: u.chunks?.map(c => ({ ...c, id: stableId(c.id) })),
    })),
  });
  return { section, points, reusableItems };
}
function validateSpansAcrossChunks(
  chunks: { spans: SourceSpan[] }[],
  cues: SubtitleCue[],
  allowed: string[],
) {
  if (chunks.length)
    validateSpans(
      chunks.flatMap(c => c.spans),
      cues,
      allowed,
    );
}
export function validateLearningDocumentV7(value: unknown): LearningDocumentV7 {
  const doc = LearningDocumentV7Schema.parse(value),
    cues = doc.cues;
  uniqueIds(
    cues.map(c => c.id),
    "Duplicate source cue IDs",
  );
  uniqueIds(
    doc.sections.map(s => s.id),
    "Duplicate scene IDs",
  );
  uniqueIds(
    doc.sections.flatMap(s => s.cueIds),
    "Overlapping scene dialogue",
  );
  uniqueIds(
    doc.sections.flatMap(s => s.utterances.map(u => u.id)),
    "Duplicate utterance IDs",
  );
  uniqueIds(
    [
      ...doc.points.map(p => p.id),
      ...doc.reusableItems.map(i => i.id),
      ...doc.sections.flatMap(s => s.utterances.flatMap(u => (u.chunks ?? []).map(c => c.id))),
    ],
    "Duplicate teaching IDs",
  );
  uniqueIds(
    doc.execution?.pronunciationDiagnostics?.map(d => d.id) ?? [],
    "Duplicate pronunciation diagnostics",
  );
  for (const d of doc.execution?.pronunciationDiagnostics ?? []) {
    const scene = doc.sections.find(s => s.id === d.sceneId);
    if (!scene || d.action === "pending") fail("Invalid pronunciation diagnostic scene or outcome");
    if (d.cueId && (!scene.cueIds.includes(d.cueId) || d.itemId))
      fail("Invalid pronunciation diagnostic cue");
    if (d.itemId) {
      const item = doc.reusableItems.find(i => i.id === d.itemId);
      if (
        !item ||
        !item.pointIds.some(id => scene.utterances.some(u => u.pointIds.includes(id))) ||
        d.exampleIndex === undefined ||
        d.lineIndex === undefined ||
        !item.examples[d.exampleIndex]?.dialogue[d.lineIndex]
      )
        fail("Invalid pronunciation diagnostic example");
    }
    if (!d.cueId && !d.itemId) fail("Missing pronunciation diagnostic target");
  }
  if (doc.sections.length > doc.profile.sceneCount) fail("Scene limit exceeded");
  const ordered = [...doc.sections].sort(
    (a, b) => cues.findIndex(c => c.id === a.cueIds[0]) - cues.findIndex(c => c.id === b.cueIds[0]),
  );
  exactIds(
    doc.sections.map(s => s.id),
    ordered.map(s => s.id),
    "Scenes must follow source order",
  );
  validateReferences(
    Object.keys(doc.playbackOverrides ?? {}),
    doc.sections.flatMap(s => s.cueIds),
    "Invalid calibrated cue reference",
  );
  validateReferences(
    Object.keys(doc.scenePlaybackOverrides ?? {}),
    doc.sections.map(s => s.id),
    "Invalid calibrated scene reference",
  );
  for (const scene of doc.sections) {
    contiguousIds(scene.cueIds, cues);
    validateReferences(
      scene.contextCueIds,
      cues.map(c => c.id),
      "invalid_source_reference: scene context",
    );
    const source = scene.cueIds.map(id => cues.find(c => c.id === id)!);
    const timed = source.every(c => c.startMs !== null && c.endMs !== null);
    if (
      scene.startMs !== (timed ? Math.min(...source.map(c => c.startMs!)) : null) ||
      scene.endMs !== (timed ? Math.max(...source.map(c => c.endMs!)) : null)
    )
      fail("Scene timing differs from canonical source");
    validateUnitCoverage(scene.utterances, scene.cueIds, cues);
    // Reuse the exact batch validator on the final graph; all points are already stable.
    const localPoints = doc.points.filter(p =>
      p.utteranceIds.some(id => scene.utterances.some(u => u.id === id)),
    );
    const sourceWindow = cues;
    const candidate = {
      id: scene.id,
      dialogueCueIds: scene.cueIds,
      contextCueIds: scene.contextCueIds,
      utterances: scene.utterances.map(u => ({
        id: u.id,
        cueIds: u.cueIds,
        sourceSpans: u.sourceSpans,
      })),
      learningValue: "validated",
      opportunities: [],
    };
    validateTeachingBatchInternal(
      {
        status: "complete",
        risks: [],
        sceneId: scene.id,
        title: scene.title,
        context: scene.context,
        translations: scene.translations,
        pronunciations: scene.pronunciations,
        utterances: scene.utterances.map(({ cueIds, sourceSpans, ...u }) => u),
        points: [],
        reusableItems: [],
      },
      {
        scene: candidate,
        requiredUtteranceIds: scene.utterances.map(u => u.id),
        sourceWindow,
        existingPoints: doc.points,
        existingReusableItems: doc.reusableItems,
      },
      doc.profile,
      "",
      true,
      false,
    );
    for (const p of localPoints) {
      validateReferences(
        p.utteranceIds,
        doc.sections.flatMap(s => s.utterances.map(u => u.id)),
        "invalid_point_reference",
      );
      const allowed = doc.sections.flatMap(s =>
        s.utterances.filter(u => p.utteranceIds.includes(u.id)).flatMap(u => u.cueIds),
      );
      validateReferences(p.sourceCueIds, allowed, "invalid_source_reference");
      validateReferences(
        p.contextCueIds,
        cues.map(c => c.id),
        "invalid_source_reference",
      );
      validateSpans(p.sourceSpans, cues, p.sourceCueIds);
      exactIds(
        spanCueIds(p.sourceSpans),
        p.sourceCueIds,
        "Point cue IDs must derive from source spans",
      );
      assertContainedSpans(
        p.sourceSpans,
        doc.sections
          .flatMap(s => s.utterances)
          .filter(u => p.utteranceIds.includes(u.id))
          .flatMap(u => u.sourceSpans),
      );
      if (
        p.utteranceIds.some(
          id =>
            !doc.sections
              .flatMap(s => s.utterances)
              .find(u => u.id === id)
              ?.pointIds.includes(p.id),
        )
      )
        fail("invalid_point_reference: orphan association");
    }
  }
  for (const p of doc.points)
    if (!doc.sections.some(s => s.utterances.some(u => u.pointIds.includes(p.id))))
      fail("Orphan learning point");
  // Validate every reusable item against its source points using a synthetic single full-source assignment.
  if (doc.reusableItems.length) {
    const scene = doc.sections[0];
    const utterances = doc.sections.flatMap(s => s.utterances);
    validateTeachingBatchInternal(
      {
        status: "complete",
        risks: [],
        sceneId: scene.id,
        title: scene.title,
        context: scene.context,
        translations: [...new Set(utterances.flatMap(u => u.cueIds))].map(id => ({
          cueId: id,
          text: "validated",
        })),
        utterances: utterances.map(({ cueIds, sourceSpans, ...u }) => u),
        points: doc.points,
        reusableItems: doc.reusableItems,
      },
      {
        scene: {
          id: scene.id,
          dialogueCueIds: utterances.flatMap(u => u.cueIds),
          contextCueIds: [],
          utterances,
          learningValue: "validated",
          opportunities: [],
        },
        requiredUtteranceIds: utterances.map(u => u.id),
        sourceWindow: cues,
        existingPoints: [],
        existingReusableItems: [],
      },
      doc.profile,
      "",
      true,
      false,
    );
  }
  return doc;
}

/** Strict persisted-document validation never normalizes or discards annotations. */
export function validateTeachingBatch(
  raw: unknown,
  input: TeachingInput,
  profile: LearningProfile,
  namespace: string,
) {
  return validateTeachingBatchInternal(raw, input, profile, namespace);
}
export function normalizeReading(reading: string, language: LearningProfile["targetLanguage"]) {
  let result = reading.normalize("NFC").trim();
  if (language === "ja")
    result = result
      .replace(/[\u30a1-\u30f6\u30fd-\u30fe]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .normalize("NFC");
  return result;
}
function validReading(reading: string, language: LearningProfile["targetLanguage"]) {
  return validPronunciationReading(reading, language);
}
type Annotation = {
  path: string;
  segments: z.infer<typeof PronunciationSegmentSchema>[];
  cueId?: string;
  itemId?: string;
  exampleIndex?: number;
  lineIndex?: number;
};
function annotationsIn(output: z.infer<typeof TeachingBatchOutputSchema>): Annotation[] {
  return [
    ...(output.pronunciations ?? []).map((p, i) => ({
      path: `/pronunciations/${i}`,
      segments: p.segments,
      cueId: p.cueId,
    })),
    ...output.reusableItems.flatMap((item, i) =>
      item.examples.flatMap((example, e) =>
        example.dialogue.flatMap((line, l) =>
          line.pronunciation
            ? [
                {
                  path: `/reusableItems/${i}/examples/${e}/dialogue/${l}/pronunciation`,
                  segments: line.pronunciation,
                  itemId: item.id,
                  exampleIndex: e,
                  lineIndex: l,
                },
              ]
            : [],
        ),
      ),
    ),
  ];
}
function rawAnnotations(output: any): { path: string; segments: any }[] {
  if (!output || typeof output !== "object") return [];
  const result: { path: string; segments: any }[] = [];
  if (Array.isArray(output.pronunciations))
    output.pronunciations.forEach((p: any, i: number) => {
      if (Array.isArray(p?.segments))
        result.push({ path: `/pronunciations/${i}`, segments: p.segments });
    });
  if (Array.isArray(output.reusableItems))
    output.reusableItems.forEach((item: any, i: number) => {
      if (Array.isArray(item?.examples))
        item.examples.forEach((e: any, j: number) => {
          if (Array.isArray(e?.dialogue))
            e.dialogue.forEach((l: any, k: number) => {
              if (Array.isArray(l?.pronunciation))
                result.push({
                  path: `/reusableItems/${i}/examples/${j}/dialogue/${k}/pronunciation`,
                  segments: l.pronunciation,
                });
            });
        });
    });
  return result;
}
function replaceAnnotation(
  output: z.infer<typeof TeachingBatchOutputSchema>,
  path: string,
  segments: z.infer<typeof PronunciationSegmentSchema>[] | undefined,
) {
  const source = /^\/pronunciations\/(\d+)$/.exec(path);
  if (source) {
    if (segments) output.pronunciations![Number(source[1])].segments = segments;
    else output.pronunciations![Number(source[1])] = undefined as never;
    return;
  }
  const example = /^\/reusableItems\/(\d+)\/examples\/(\d+)\/dialogue\/(\d+)\/pronunciation$/.exec(
    path,
  );
  if (!example) throw new Error("Unknown pronunciation target");
  const line =
    output.reusableItems[Number(example[1])].examples[Number(example[2])].dialogue[
      Number(example[3])
    ];
  if (segments) line.pronunciation = segments;
  else delete line.pronunciation;
}
function compactAnnotations(output: z.infer<typeof TeachingBatchOutputSchema>) {
  if (output.pronunciations) {
    output.pronunciations = output.pronunciations.filter(Boolean);
    if (!output.pronunciations.length) delete output.pronunciations;
  }
}
/** Align only a verbatim, uniquely located form inside its already-fixed associated units. */
function alignExactSourceForms(
  output: z.infer<typeof TeachingBatchOutputSchema>,
  input: TeachingInput,
) {
  const corrections: {
    itemId: string;
    formIndex: number;
    before: SourceSpan;
    after: SourceSpan;
  }[] = [];
  const same = (a: SourceSpan, b: SourceSpan) =>
    a.cueId === b.cueId && a.start === b.start && a.end === b.end;
  output.reusableItems.forEach((item, itemIndex) => {
    const points = output.points.filter(p => item.pointIds.includes(p.id));
    const parents = input.scene.utterances
      .filter(
        u =>
          input.requiredUtteranceIds.includes(u.id) &&
          points.some(p => p.utteranceIds.includes(u.id)),
      )
      .flatMap(u => u.sourceSpans);
    item.sourceForms.forEach((form, formIndex) => {
      if (form.sourceSpans.length !== 1 || form.cueIds.length !== 1) return;
      const before = form.sourceSpans[0];
      if (form.cueIds[0] !== before.cueId) return;
      const cue = input.sourceWindow.find(c => c.id === before.cueId);
      if (!cue || cue.originalText.slice(before.start, before.end) === form.text) return;
      const boundaries = graphemeBoundaries(cue.originalText),
        candidates: SourceSpan[] = [];
      for (
        let start = cue.originalText.indexOf(form.text);
        start >= 0;
        start = cue.originalText.indexOf(form.text, start + 1)
      ) {
        const span = { cueId: cue.id, start, end: start + form.text.length };
        if (!boundaries.has(span.start) || !boundaries.has(span.end)) continue;
        try {
          assertContainedSpans([span], parents);
          candidates.push(span);
        } catch {
          /* Unassociated source is not a repair candidate. */
        }
      }
      if (candidates.length !== 1) return;
      const after = candidates[0],
        changedPointIndexes: number[] = [];
      form.sourceSpans = [{ ...after }];
      output.points.forEach((point, pointIndex) => {
        if (!item.pointIds.includes(point.id) || !point.sourceSpans.some(s => same(s, before)))
          return;
        point.sourceSpans = point.sourceSpans.map(s => (same(s, before) ? { ...after } : s));
        changedPointIndexes.push(pointIndex);
      });
      for (const risk of output.risks) {
        if (
          risk.path.startsWith(`/reusableItems/${itemIndex}/sourceForms/${formIndex}/`) ||
          changedPointIndexes.some(i => risk.path.startsWith(`/points/${i}/`))
        )
          risk.sourceSpans = risk.sourceSpans.map(s => (same(s, before) ? { ...after } : s));
      }
      corrections.push({ itemId: item.id, formIndex, before: { ...before }, after: { ...after } });
    });
  });
  return corrections;
}
/** Check all source/structure invariants before allowing optional reading degradation. */
export function prepareTeachingBatch(
  raw: unknown,
  input: TeachingInput,
  profile: LearningProfile,
  namespace: string,
  batchId = namespace,
) {
  const copy = structuredClone(raw);
  if (
    copy &&
    typeof copy === "object" &&
    Array.isArray((copy as { reusableItems?: unknown }).reusableItems)
  )
    (copy as { reusableItems: any[]; risks?: any[] }).reusableItems.forEach((item, i) => {
      if (item?.kind !== "expression" || item.pattern !== "") return;
      delete item.pattern;
      const path = `/reusableItems/${i}/pattern`;
      for (const risk of Array.isArray((copy as { risks?: unknown }).risks)
        ? (copy as { risks: any[] }).risks
        : [])
        if (risk?.path === path) risk.path = `/reusableItems/${i}/kind`;
    });
  const changes: { path: string; segmentIndex: number; code: PronunciationDiagnostic["code"] }[] =
    [];
  for (const annotation of rawAnnotations(copy))
    annotation.segments.forEach((s: any, i: number) => {
      if (typeof s?.reading !== "string") return;
      const reading = normalizeReading(s.reading, profile.targetLanguage);
      if (!reading) {
        delete s.reading;
        changes.push({
          path: annotation.path,
          segmentIndex: i,
          // Silent punctuation/spacing needs no phonetic annotation or paid repair.
          code:
            typeof s.text === "string" && /^[\p{P}\p{Z}\s]+$/u.test(s.text)
              ? "reading_normalized"
              : "empty_reading",
        });
      } else if (reading !== s.reading) {
        s.reading = reading;
        changes.push({ path: annotation.path, segmentIndex: i, code: "reading_normalized" });
      }
    });
  const output = TeachingBatchOutputSchema.parse(copy);
  const sourceSpanCorrections = alignExactSourceForms(output, input);
  const omittedExampleAnnotations = new Set<string>();
  const alignmentDiagnostics: PronunciationDiagnostic[] = [];
  // Optional AI-example readings may be omitted without changing the example.
  // Source-cue annotations and all other evidence/reference checks remain strict.
  output.reusableItems.forEach((item, i) =>
    item.examples.forEach((example, e) =>
      example.dialogue.forEach((line, l) => {
        if (!line.pronunciation || line.pronunciation.map(s => s.text).join("") === line.text)
          return;
        const path = `/reusableItems/${i}/examples/${e}/dialogue/${l}/pronunciation`;
        omittedExampleAnnotations.add(path);
        delete line.pronunciation;
        alignmentDiagnostics.push({
          id: `${batchId}:${path}:all:annotation_alignment`,
          batchId,
          sceneId: input.scene.id,
          path,
          itemId: namespace ? `${namespace}:${item.id}` : item.id,
          exampleIndex: e,
          lineIndex: l,
          code: "annotation_alignment",
          action: "omitted",
        });
        for (const risk of output.risks)
          if (risk.path === path || risk.path.startsWith(path + "/"))
            risk.path = path.slice(0, -"/pronunciation".length) + "/text";
      }),
    ),
  );
  const omittedChunkUtteranceIds: string[] = [];
  try {
    validateTeachingBatchInternal(output, input, profile, namespace, false);
  } catch (error) {
    // First prove that the failure is confined to optional segmentation. Then
    // restore valid fragments instead of discarding every chunk in this batch.
    const withoutChunks = structuredClone(output);
    for (const utterance of withoutChunks.utterances) {
      if (utterance.chunks !== undefined) {
        delete utterance.chunks;
      }
    }
    if (!output.utterances.some(u => u.chunks !== undefined)) throw error;
    validateTeachingBatchInternal(withoutChunks, input, profile, namespace, false);
    for (const [index, original] of output.utterances.entries()) {
      if (!original.chunks) continue;
      const utterance = withoutChunks.utterances[index];
      for (const chunk of original.chunks) {
        const accepted = utterance.chunks;
        utterance.chunks = [...(accepted ?? []), chunk];
        try {
          validateTeachingBatchInternal(withoutChunks, input, profile, namespace, false);
        } catch {
          if (accepted) utterance.chunks = accepted;
          else delete utterance.chunks;
          if (!omittedChunkUtteranceIds.includes(original.id))
            omittedChunkUtteranceIds.push(original.id);
        }
      }
    }
    output.utterances = withoutChunks.utterances;
  }
  const annotations = annotationsIn(output);
  const diagnostics: PronunciationDiagnostic[] = [...alignmentDiagnostics];
  // Respect uncertainty explicitly disclosed by the model, without inferring a
  // replacement word or reading. Only exact source tokens followed by a caveat count.
  const uncertainTokens = new Map<string, Set<string>>();
  const markUncertain = (text: string, cueIds: string[]) => {
    for (const match of text.matchAll(
      /(?:「([^」\n]{1,100})」|“([^”\n]{1,100})”|"([^"\n]{1,100})"|‘([^’\n]{1,100})’|«([^»\n]{1,100})»|„([^“\n]{1,100})“|『([^』\n]{1,100})』)\s*[（(]([^）)\n]{1,100})[）)]/gu,
    )) {
      if (!hasUncertaintyDisclosure(match[8])) continue;
      const token = match.slice(1, 8).find(t => t !== undefined)!;
      for (const id of cueIds) {
        const tokens = uncertainTokens.get(id) ?? new Set<string>();
        tokens.add(token);
        uncertainTokens.set(id, tokens);
      }
    }
  };
  output.translations.forEach(t => markUncertain(t.text, [t.cueId]));
  output.utterances.forEach(u => {
    const ids = input.scene.utterances.find(assigned => assigned.id === u.id)!.cueIds;
    markUncertain(u.meaning, ids);
    markUncertain(u.contextExplanation, ids);
  });
  for (const annotation of annotations) {
    if (!annotation.cueId) continue; // AI examples have their own invented, established names.
    const source = input.sourceWindow.find(c => c.id === annotation.cueId)!.originalText;
    const ranges = [...(uncertainTokens.get(annotation.cueId) ?? [])].flatMap(token => {
      const matches: { start: number; end: number }[] = [];
      for (
        let start = source.indexOf(token);
        start >= 0;
        start = source.indexOf(token, start + token.length)
      )
        matches.push({ start, end: start + token.length });
      return matches;
    });
    let offset = 0;
    annotation.segments.forEach((segment, segmentIndex) => {
      const start = offset;
      offset += segment.text.length;
      if (!segment.reading || !ranges.some(r => start < r.end && offset > r.start)) return;
      delete segment.reading;
      diagnostics.push({
        id: `${batchId}:${annotation.path}:${segmentIndex}:source_uncertain`,
        batchId,
        sceneId: input.scene.id,
        path: annotation.path,
        cueId: annotation.cueId,
        segmentIndex,
        code: "invalid_reading",
        action: "omitted",
      });
    });
  }
  const diagnostic = (
    a: Annotation,
    code: PronunciationDiagnostic["code"],
    segmentIndex?: number,
  ) => {
    diagnostics.push({
      id: `${batchId}:${a.path}:${segmentIndex ?? "all"}:${code}`,
      batchId,
      sceneId: input.scene.id,
      path: a.path,
      cueId: a.cueId,
      itemId: a.itemId ? (namespace ? `${namespace}:${a.itemId}` : a.itemId) : undefined,
      exampleIndex: a.exampleIndex,
      lineIndex: a.lineIndex,
      segmentIndex,
      code,
      action: code === "reading_normalized" ? "normalized" : "pending",
    });
  };
  for (const c of changes.filter(c => !omittedExampleAnnotations.has(c.path)))
    diagnostic(
      annotations.find(a => a.path === c.path)!,
      c.code,
      c.segmentIndex,
    );
  const safeOutput = structuredClone(output);
  const targets: Annotation[] = [];
  for (const a of annotations) {
    const segments: z.infer<typeof PronunciationSegmentSchema>[] = a.segments.map((s, i) => {
      if (s.reading && !validReading(s.reading, profile.targetLanguage)) {
        diagnostic(a, "invalid_reading", i);
        const { reading, ...rest } = s;
        return rest;
      }
      return { ...s };
    });
    if (
      !segments.some(s => s.reading) &&
      diagnostics.some(d => d.path === a.path && d.action === "omitted")
    ) {
      replaceAnnotation(safeOutput, a.path, undefined);
      continue;
    }
    if (
      !segments.some(s => s.reading) &&
      !diagnostics.some(d => d.path === a.path && d.action === "pending")
    )
      diagnostic(a, "empty_annotation");
    if (diagnostics.some(d => d.path === a.path && d.action === "pending")) {
      targets.push(a);
      replaceAnnotation(safeOutput, a.path, segments.some(s => s.reading) ? segments : undefined);
    }
  }
  compactAnnotations(safeOutput);
  validateTeachingBatch(safeOutput, input, profile, namespace);
  return {
    output,
    safeOutput,
    targets,
    diagnostics,
    omittedChunkUtteranceIds,
    sourceSpanCorrections,
  };
}
const PronunciationRepairSchema = z
  .object({
    annotations: z.array(
      z
        .object({
          path: z.string(),
          segments: z.array(PronunciationSegmentSchema).min(1).max(100).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export function applyPronunciationRepair(
  output: z.infer<typeof TeachingBatchOutputSchema>,
  targets: readonly string[],
  raw: unknown,
) {
  const patch = PronunciationRepairSchema.parse(raw);
  uniqueIds(
    patch.annotations.map(a => a.path),
    "Duplicate pronunciation repair target",
  );
  exactIds(
    patch.annotations.map(a => a.path),
    targets,
    "Pronunciation repair target coverage",
  );
  const result = structuredClone(output),
    existing = annotationsIn(output);
  for (const a of patch.annotations) {
    const before = existing.find(e => e.path === a.path);
    if (!before) fail("Unknown pronunciation repair target");
    if (
      a.segments &&
      a.segments.map(s => s.text).join("") !== before.segments.map(s => s.text).join("")
    )
      fail("Invalid pronunciation repair alignment");
    replaceAnnotation(result, a.path, a.segments ?? before.segments.map(({ reading, ...s }) => s));
  }
  compactAnnotations(result);
  return result;
}
