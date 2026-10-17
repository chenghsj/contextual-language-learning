import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
  validateTeachingBatch,
  validateLearningDocumentV7,
  type GenerationRequest,
  type TeachingInput,
} from "../src/index";
export function pointsFixture() {
  const f = JSON.parse(
    readFileSync(new URL("./learning-points.fixture.json", import.meta.url), "utf8"),
  );
  f.input.scene.id = randomUUID();
  f.output.sceneId = f.input.scene.id;
  const request: GenerationRequest = {
    id: randomUUID(),
    outputSchemaVersion: 7,
    source: { platform: "import", title: "Time and reference" },
    agent: { provider: "openai", modelId: "offline" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 2,
      contextualExampleCount: 1,
      enabledExplanations: ["vocabulary", "grammar", "usage"],
      emphasizedExplanations: ["grammar"],
    },
    cues: f.input.sourceWindow.map((c: object, i: number) => ({
      ...c,
      startMs: i * 2000,
      endMs: i * 2000 + 1800,
    })),
  };
  const input: TeachingInput = {
    ...f.input,
    scene: { ...f.input.scene, learningValue: "Time relationships", opportunities: [] },
    sourceWindow: request.cues,
    existingReusableItems: [],
  };
  const result = validateTeachingBatch(f.output, input, request.profile, "batch");
  const document = validateLearningDocumentV7({
    schemaVersion: 7,
    id: request.id,
    createdAt: "2026-10-09T00:00:00.000Z",
    source: request.source,
    profile: request.profile,
    generation: request.agent,
    execution: {
      workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
      promptVersion: LEARNING_POINTS_PROMPT_VERSION,
      schemaVersion: "7",
      languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
      qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
      levelStrategyVersion: LEVEL_STRATEGY_VERSION,
      inputFingerprint: "0".repeat(64),
      provider: request.agent.provider,
      modelId: request.agent.modelId,
      contextWindow: 128000,
      maxOutputTokens: 8192,
      chunkPlan: [request.cues.map(c => c.id)],
      calls: [],
    },
    cues: request.cues,
    sections: [result.section],
    points: result.points,
    reusableItems: result.reusableItems,
  });
  return { request, input, raw: f.output, result, document };
}
/** Synthetic Host-authored metadata for transport/export fixtures. */
export function withReadingDiagnostics(document: import("../src/schema").LearningDocumentV7) {
  const copy = structuredClone(document);
  const scene = copy.sections[0],
    item = copy.reusableItems[0];
  copy.execution = {
    workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
    promptVersion: LEARNING_POINTS_PROMPT_VERSION,
    schemaVersion: "7",
    languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
    qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
    levelStrategyVersion: "learning-level-strategies-1",
    inputFingerprint: "0".repeat(64),
    provider: copy.generation.provider,
    modelId: copy.generation.modelId,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    chunkPlan: [copy.cues.map(c => c.id)],
    calls: [],
    pronunciationDiagnostics: [
      {
        id: "s0:source",
        batchId: "s0",
        sceneId: scene.id,
        path: "/pronunciations/0",
        cueId: scene.cueIds[0],
        code: "invalid_reading",
        action: "omitted",
      },
      {
        id: "s0:example",
        batchId: "s0",
        sceneId: scene.id,
        path: "/reusableItems/0/examples/0/dialogue/0/pronunciation",
        itemId: item.id,
        exampleIndex: 0,
        lineIndex: 0,
        code: "empty_annotation",
        action: "omitted",
      },
    ],
  };
  return copy;
}
