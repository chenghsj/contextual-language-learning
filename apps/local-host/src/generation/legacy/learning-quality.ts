/** Historical offline diagnostics only. The active pipeline does not import this module. */
import { applyQualityPatch } from "./quality-patch";
import { createHash } from "node:crypto";
import {
  QualityReviewSchema,
  QualityRiskSchema,
  TeachingBatchOutputSchema,
  assertContainedSpans,
  validateTeachingBatch,
  validateSpans,
  spanCueIds,
  type QualityCheckpoint,
  type QualityRisk,
  type QualityReview,
  type TeachingInput,
  type GenerationRequest,
  type TeachingBatchOutput,
} from "@contextual/core";
import { learningPointsPrompts } from "../learning-points-prompts";

/** A received but unusable paid answer is a failure even if cancellation races parsing. */
export class CompletedQualityResponseError extends Error {}

export const qualityHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function field(root: unknown, path: string): unknown {
  if (!path.startsWith("/")) throw new Error("Quality location must be a JSON pointer");
  return path
    .slice(1)
    .split("/")
    .reduce<unknown>((value, key) => {
      const decoded = key.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!value || typeof value !== "object" || !Object.hasOwn(value, decoded))
        throw new Error("Unknown quality field " + path);
      return (value as Record<string, unknown>)[decoded];
    }, root);
}
function validateRisks(risks: QualityRisk[], draft: unknown, input: TeachingInput) {
  for (const risk of risks) {
    const unit = input.scene.utterances.find(
      u => u.id === risk.unitId && input.requiredUtteranceIds.includes(u.id),
    );
    if (!unit) throw new Error("Quality risk refers to unassigned unit");
    field(draft, risk.path);
    validateSpans(risk.sourceSpans, input.sourceWindow, spanCueIds(risk.sourceSpans));
    assertContainedSpans(risk.sourceSpans, unit.sourceSpans);
  }
}
export function validateQualityReview(
  raw: unknown,
  draft: unknown,
  input: TeachingInput,
): QualityReview {
  const review = QualityReviewSchema.parse(raw);
  for (const issue of review.issues) {
    field(draft, issue.path);
    validateSpans(issue.sourceSpans, input.sourceWindow, spanCueIds(issue.sourceSpans));
    const teaching = draft as TeachingBatchOutput;
    const contextIds = new Set([
      ...input.scene.contextCueIds,
      ...teaching.context.evidenceCueIds,
      ...teaching.utterances.flatMap(u => u.contextCueIds),
      ...teaching.points.flatMap(p => p.contextCueIds),
    ]);
    assertContainedSpans(issue.sourceSpans, [
      ...input.scene.utterances
        .filter(u => input.requiredUtteranceIds.includes(u.id))
        .flatMap(u => u.sourceSpans),
      ...input.sourceWindow
        .filter(c => contextIds.has(c.id))
        .map(c => ({ cueId: c.id, start: 0, end: c.originalText.length })),
    ]);
  }
  return review;
}
/** Narrow source/claim signals. A frame, context, or advanced level alone is never a trigger. */
export function qualityRisks(
  draft: TeachingBatchOutput,
  input: TeachingInput,
  language: GenerationRequest["profile"]["targetLanguage"],
): QualityRisk[] {
  const risks: QualityRisk[] = [...draft.risks];
  const assigned = input.scene.utterances.filter(u => input.requiredUtteranceIds.includes(u.id));
  const add = (
    type: QualityRisk["type"],
    unit: (typeof assigned)[number],
    path: string,
    description: string,
  ) => risks.push({ type, unitId: unit.id, path, sourceSpans: unit.sourceSpans, description });
  const sceneClaim =
    /指著|畫面|見面|互動|出發時間|打斷|叫住|延誤|驚訝|感到(?:生氣|傷心|焦慮)|故意|actual intonation|(?:surprised|angry) speaker|並(?:請|要求|反問|詢問)|隨後(?:提出|請求)|接著(?:提出|請求)/iu;
  for (const [path, text] of [
    ["/title", draft.title],
    ["/context/text", draft.context.text],
  ])
    if (sceneClaim.test(text))
      add(
        "context_inference",
        assigned[0],
        path,
        "Potential ungrounded emotion, causality or linking separate turns to one speaker; verify this specific field against source.",
      );
  if (
    language === "ja" &&
    input.sourceWindow.some(
      c =>
        input.scene.contextCueIds.includes(c.id) && /あなたはその[。…\s]*$/u.test(c.originalText),
    )
  )
    add(
      "source_uncertainty",
      assigned[0],
      "/context/text",
      "Context contains an unfinished あなたはその clause; do not complete or quote an invented conclusion.",
    );
  for (const [i, u] of draft.utterances.entries()) {
    const unit = assigned.find(a => a.id === u.id)!;
    const source = unit.sourceSpans
      .map(s => input.sourceWindow.find(c => c.id === s.cueId)!.originalText.slice(s.start, s.end))
      .join("");
    const explanation = [
      u.meaning,
      u.contextExplanation,
      ...draft.points
        .filter(p => p.utteranceIds.includes(u.id))
        .flatMap(p => [p.title, p.explanation]),
    ].join("\n");
    if (
      language === "ja" &&
      /下に見て/u.test(source) &&
      !/俺|私|僕|自分/u.test(source) &&
      /(?:看扁|瞧不起|看不起)我|被對方|自我懷疑/u.test(explanation)
    )
      add(
        "reference_uncertainty",
        unit,
        `/utterances/${i}/meaning`,
        "The source does not identify who looks down on whom; do not fill the object as the speaker based on another unlabeled turn.",
      );
    if (
      language === "ja" &&
      /ちゃった|ちゃって|てしま/u.test(source) &&
      /不小心|非本意|自責|後悔/u.test(explanation)
    )
      add(
        "context_inference",
        unit,
        `/utterances/${i}/meaning`,
        "This ending alone does not prove an accidental action or self-blame. Verify any claim about this source; qualified general possibilities are distinct.",
      );
    if (
      /\[\?{2,}\]|原文不明|字幕.{0,6}(?:不明|損壞)|unclear source|unintelligible/iu.test(
        source + "\n" + explanation,
      )
    )
      add(
        "source_uncertainty",
        unit,
        `/utterances/${i}/meaning`,
        "Teaching acknowledges uncertain source; check all dependent claims.",
      );
    if (
      /指著|畫面|字跡|打斷|叫住|延誤|突發|插進|上揚語調|實際(?:語調|重音)|故意(?:曲解|諷刺)|角色.{0,5}(?:動機|意圖)|actual intonation|speaker intends/iu.test(
        explanation,
      )
    )
      add(
        "context_inference",
        unit,
        `/utterances/${i}/meaning`,
        "Potential claim about delivery or motivation without audio evidence.",
      );
    if (
      language === "es" &&
      /\bdime\b/iu.test(source) &&
      /(?:加上|添加|寫上).{0,6}重音(?:符號|符)/u.test(explanation)
    )
      add(
        "construction_example",
        unit,
        `/utterances/${i}/meaning`,
        "Dime has no orthographic accent; verify claims about adding a written accent when attaching me.",
      );
    if (language === "ja" && /\[動詞て形\].{0,2}(?:た[／/]だ|だ)/u.test(explanation))
      add(
        "construction_example",
        unit,
        `/utterances/${i}/meaning`,
        "Check the whole て/で form slot; deleting い in ていた/でいた must not add a second voiced past suffix.",
      );
    if (language === "pt" && /過去完成式/u.test(explanation))
      add(
        "construction_example",
        unit,
        `/utterances/${i}/meaning`,
        "Check completed-past terminology against pluperfect; these are distinct constructions.",
      );
    // Explicit quote markers; ordinary conditionals/constructions are not risky by themselves.
    if (/[「」『』“”«»„‟"]/u.test(source))
      add(
        "reported_role",
        unit,
        `/utterances/${i}/meaning`,
        "Quoted speech may change whose stance is being explained.",
      );
    const specialized: Partial<Record<typeof language, RegExp>> = {
      ja: /悪いない|ごこご|満件|赤服|たくなっちゃ|(?:と言|って言).{0,20}(?:母|父|先生)/u,
      ko: /(?:다고|라고).{0,5}(?:했|말했)|것 같.*(?:누가|그)/u,
      "zh-TW": /他說|她說|據說|原文不明/u,
      "zh-CN": /他说|她说|据说|原文不明/u,
    };
    if (specialized[language]?.test(source))
      add(
        "construction_example",
        unit,
        `/utterances/${i}/meaning`,
        "Language-specific uncertainty, contraction or reported-role case.",
      );
  }
  const seen = new Map<string, string>();
  function inspect(value: unknown, path: string) {
    if (
      typeof value === "string" &&
      value.trim().length >= 24 &&
      !/\/(id|cueId|unitId|type|path|reading|text)$/.test(path)
    ) {
      const key = value.trim();
      const old = seen.get(key);
      if (old) {
        const unit = assigned[0];
        add("usage_generalization", unit, path, "Exactly repeated teaching field " + old);
      } else seen.set(key, path);
    } else if (Array.isArray(value)) value.forEach((v, i) => inspect(v, path + "/" + i));
    else if (value && typeof value === "object")
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "risks",
              "id",
              "sceneId",
              "cueId",
              "unitId",
              "cueIds",
              "utteranceIds",
              "sourceCueIds",
              "contextCueIds",
              "pointIds",
              "evidenceCueIds",
              "sourceSpans",
              "spans",
              "sourceForms",
            ].includes(k),
        )
        .forEach(([k, v]) => inspect(v, path + "/" + k));
  }
  inspect(draft, "");
  const unique = [...new Map(risks.map(r => [JSON.stringify(r), r])).values()].map(r =>
    QualityRiskSchema.parse(r),
  );
  validateRisks(unique, draft, input);
  return unique;
}
export function checkQualityCheckpoint(
  q: QualityCheckpoint,
  input: TeachingInput,
  request: GenerationRequest,
  namespace: string,
) {
  if (qualityHash({ input, profile: request.profile, agent: request.agent }) !== q.inputHash)
    throw new Error("Quality frozen input hash mismatch");
  if (qualityHash(q.draft) !== q.draftHash) throw new Error("Quality draft hash mismatch");
  validateTeachingBatch(q.draft, input, request.profile, namespace);
  validateRisks(q.risks, q.originalDraft ?? q.draft, input);
  if (q.originalDraft && qualityHash(q.originalDraft) !== q.originalDraftHash)
    throw new Error("Original quality draft hash mismatch");
  if (q.phase === "accepted" && q.risks.length && !q.review)
    throw new Error("Accepted risky draft is missing a completed review");
  if (q.phase === "accepted" && (q.recheck ?? q.review)?.issues.some(i => i.severity === "error"))
    throw new Error("Accepted draft has unresolved major issues");
  if (
    q.review &&
    (qualityHash(q.review) !== q.reviewHash || q.reviewDraftHash !== q.originalDraftHash)
  )
    throw new Error("Quality review hash mismatch");
  if (q.recheck && (qualityHash(q.recheck) !== q.recheckHash || q.recheckDraftHash !== q.draftHash))
    throw new Error("Quality recheck hash mismatch");
}
export async function runBatchQuality(options: {
  draft: unknown;
  saved?: QualityCheckpoint;
  input: TeachingInput;
  request: GenerationRequest;
  namespace: string;
  persist: (q: QualityCheckpoint) => Promise<void>;
  generate: (prompt: string, step: string) => Promise<unknown>;
  signal: AbortSignal;
  batchId: string;
  budget: number;
}) {
  const { input, request, namespace, persist, generate, signal, batchId, budget } = options;
  let q: QualityCheckpoint;
  if (options.saved) {
    q = options.saved;
    checkQualityCheckpoint(q, input, request, namespace);
  } else {
    const draft = TeachingBatchOutputSchema.parse(options.draft);
    const risks = qualityRisks(draft, input, request.profile.targetLanguage);
    const hash = qualityHash(draft);
    q = {
      draft,
      originalDraft: draft,
      draftHash: hash,
      inputHash: qualityHash({ input, profile: request.profile, agent: request.agent }),
      originalDraftHash: hash,
      risks,
      phase: risks.length ? "review_pending" : "accepted",
      repairEligible: true,
    };
    await persist(q);
  }
  const save = async (change: Partial<QualityCheckpoint>) => {
    q = { ...q, ...change };
    await persist(q);
  };
  const block = async (message: string): Promise<never> => {
    await save({ phase: "blocked", repairEligible: false, diagnostic: message.slice(0, 12000) });
    throw new Error(message);
  };
  if (q.phase === "blocked") throw new Error("Quality blocked: " + q.diagnostic);
  if (q.phase.endsWith("_started"))
    return block(
      "Unresolved prior quality request; paid output may have been lost. Regenerate this task instead of replaying it.",
    );
  const prompts = learningPointsPrompts();
  const reviewPrompt = (recheck: boolean) => {
    const ids = new Set(
      TeachingBatchOutputSchema.parse(q.draft).utterances.flatMap(u => u.pointIds),
    );
    return prompts.pointsQualityPrompt(
      request,
      input,
      q.draft,
      recheck
        ? qualityRisks(
            TeachingBatchOutputSchema.parse(q.draft),
            input,
            request.profile.targetLanguage,
          )
        : q.risks,
      input.existingPoints.filter(p => ids.has(p.id)),
      budget,
      recheck,
    );
  };
  const call = async (
    pending: QualityCheckpoint["phase"],
    started: QualityCheckpoint["phase"],
    prompt: string,
    step: string,
  ) => {
    await save({ phase: started });
    try {
      return await generate(prompt, step);
    } catch (e) {
      if (e instanceof CompletedQualityResponseError)
        return block("Invalid completed quality response: " + String(e));
      if (signal.aborted) {
        await save({
          phase: pending,
          ...(pending === "repair_pending" ? { repairEligible: true } : {}),
        });
        throw e;
      }
      return block("Quality request could not complete: " + String(e));
    }
  };
  if (q.phase === "review_pending") {
    const raw = await call(
      "review_pending",
      "review_started",
      reviewPrompt(false),
      batchId + "-quality-review",
    );
    let review: QualityReview;
    try {
      review = validateQualityReview(raw, q.draft, input);
    } catch (e) {
      return block("Invalid quality review: " + String(e));
    }
    const errors = review.issues.filter(i => i.severity === "error");
    const boundary = errors.some(i => i.type === "unit_boundary");
    await save({
      review,
      reviewHash: qualityHash(review),
      reviewDraftHash: q.draftHash,
      phase: boundary ? "blocked" : errors.length ? "repair_pending" : "accepted",
      ...(boundary
        ? {
            repairEligible: false,
            diagnostic: "Fixed unit boundary is incorrect; regenerate grouping.",
          }
        : {}),
    });
    if (boundary) throw new Error("Fixed unit boundary is incorrect; regenerate grouping.");
  }
  if (q.phase === "repair_pending") {
    if (!q.repairEligible) return block("Quality repair allowance exhausted");
    await save({ repairEligible: false });
    const raw = await call(
      "repair_pending",
      "repair_started",
      prompts.pointsQualityRepairPrompt(request, input, q.draft, q.review!.issues, budget),
      batchId + "-quality-repair",
    );
    await save({ repairPatch: raw });
    let draft: TeachingBatchOutput;
    try {
      draft = applyQualityPatch(q.draft, raw);
      validateTeachingBatch(draft, input, request.profile, namespace);
      qualityRisks(draft, input, request.profile.targetLanguage);
    } catch (e) {
      return block("Quality repair failed structure validation: " + String(e));
    }
    await save({ draft, draftHash: qualityHash(draft), phase: "recheck_pending" });
  }
  if (q.phase === "recheck_pending") {
    const raw = await call(
      "recheck_pending",
      "recheck_started",
      reviewPrompt(true),
      batchId + "-quality-recheck",
    );
    let recheck: QualityReview;
    try {
      recheck = validateQualityReview(raw, q.draft, input);
    } catch (e) {
      return block("Invalid quality recheck: " + String(e));
    }
    await save({
      recheck,
      recheckHash: qualityHash(recheck),
      recheckDraftHash: q.draftHash,
      phase: recheck.issues.some(i => i.severity === "error") ? "blocked" : "accepted",
      diagnostic: recheck.issues.some(i => i.severity === "error")
        ? "Major issues remain after one repair"
        : undefined,
    });
  }
  if (q.phase !== "accepted") throw new Error("Quality blocked: " + q.diagnostic);
  return {
    draft: q.draft,
    checkpoint: q,
    result: validateTeachingBatch(q.draft, input, request.profile, namespace),
  };
}
