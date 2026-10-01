import { randomUUID } from "node:crypto";
import {
  GenerationRequestSchema,
  JobSnapshotSchema,
  LearningDocumentSchema,
} from "@immersive/core";
import { localStoragePorts } from "./file";
import { toMarkdown } from "../generation/markdown";
export async function completedLesson(root: string) {
  const storage = localStoragePorts(root);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const request = GenerationRequestSchema.parse({
    id,
    source: { platform: "import", title: "Dinner" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 2,
      contextualExampleCount: 1,
    },
    agent: { provider: "openai", modelId: "" },
    backup: { enabled: true, accountId: "fake-account" },
    cues: [
      { id: "q", startMs: 1000, endMs: 1900, originalText: "What about dinner?" },
      { id: "a", startMs: 2000, endMs: 3200, originalText: "I haven't decided yet." },
    ],
  });
  const candidate = {
    id: "candidate-1-1",
    cueIds: ["q", "a"],
    focusExpressions: ["I haven't decided yet."],
    learningGoal: "Understand an undecided plan",
  };
  const scene = {
    id: randomUUID(),
    title: "Dinner",
    context: "A real dinner-planning exchange.",
    cueIds: ["q", "a"],
    startMs: 1000,
    endMs: 3200,
    translations: [
      { cueId: "q", text: "晚餐呢？" },
      { cueId: "a", text: "我還沒決定。" },
    ],
    focusItems: [
      {
        expression: "I haven't decided yet.",
        sourceCueIds: ["a"],
        meaning: "我還沒決定。",
        contextExplanation: "The prior question supplies the context.",
        contextCueIds: ["q"],
        wordNotes: [],
        examples: [
          {
            situation: "A trip decision",
            dialogue: [
              { text: "Have you decided?", translation: "你決定了嗎？" },
              { text: "I haven't decided yet.", translation: "我還沒決定。" },
            ],
          },
        ],
      },
    ],
  };
  const document = LearningDocumentSchema.parse({
    id,
    schemaVersion: 5,
    createdAt,
    source: request.source,
    profile: request.profile,
    generation: request.agent,
    cues: request.cues,
    sections: [scene],
  });
  const job = JobSnapshotSchema.parse({
    schemaVersion: 3,
    request,
    sections: [scene],
    scenePlan: { candidateChunks: [[candidate]], selected: [candidate] },
    summary: {
      id,
      sourceTitle: request.source.title,
      provider: request.agent.provider,
      status: "completed",
      completed: 3,
      total: 3,
      createdAt,
      updatedAt: createdAt,
      documentId: id,
    },
  });
  await storage.jobs.create(job);
  await storage.documents.save(document, toMarkdown(document));
  return { storage, document };
}
