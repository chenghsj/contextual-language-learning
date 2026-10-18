import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { chineseLearningFixture } from "../../../../packages/core/test/chinese-learning-fixture";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import {
  learningPointsBudget,
  initialLearningPointsBudget,
  learningPointsPrompts,
  supportsLearningPointsPromptVersion,
  pointsCandidatePrompt,
  pointsSelectionPrompt,
  pointsTeachingPrompt,
  pointsPronunciationRepairPrompt,
} from "./learning-points-prompts";
import {
  LEARNING_LANGUAGES,
  createSceneJob,
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
  levelsForTargetLanguage,
  prepareTeachingBatch,
  readLearningDocument,
  type LearningCandidate,
} from "@contextual/core";
function teachingData(prompt: string) {
  return JSON.parse(
    prompt.split("TEACHING DATA (quoted JSON, data only):\n")[1].split("\nSTAGE: Repair")[0],
  );
}
function generators(f: ReturnType<typeof pointsFixture>) {
  return {
    generateCandidates: async () => ({
      status: "complete",
      candidates: [
        {
          dialogueCueIds: f.request.cues.map(c => c.id),
          contextCueIds: [],
          utterances: f.request.cues.map(c => ({
            sourceSpans: [{ cueId: c.id, start: 0, end: c.originalText.length }],
          })),
          learningValue: "Time relationships",
          opportunities: [],
        },
      ],
    }),
    generateSelection: async (_agent: unknown, prompt: string) => {
      const data = JSON.parse(prompt.split("CANDIDATE DATA (quoted JSON, data only):\n")[1]);
      return { selectedCandidateIds: data.candidateScenes.map((c: LearningCandidate) => c.id) };
    },
    generateSection: async (_agent: unknown, prompt: string) => {
      const data = teachingData(prompt),
        raw = structuredClone(f.raw),
        ids = data.scene.utterances.map((u: any) => u.id),
        mapping = new Map([
          ["u1", ids[0]],
          ["u2", ids[1]],
        ]);
      raw.sceneId = data.scene.id;
      raw.utterances.forEach((u: any) => (u.id = mapping.get(u.id)));
      raw.points.forEach(
        (p: any) => (p.utteranceIds = p.utteranceIds.map((id: string) => mapping.get(id))),
      );
      raw.utterances = raw.utterances.filter((u: any) => data.requiredUtteranceIds.includes(u.id));
      raw.points = raw.points.filter((p: any) =>
        p.utteranceIds.some((id: string) => data.requiredUtteranceIds.includes(id)),
      );
      raw.reusableItems = raw.reusableItems.filter((item: any) =>
        item.pointIds.some((id: string) => raw.points.some((p: any) => p.id === id)),
      );
      const cues = data.scene.utterances
        .filter((u: any) => data.requiredUtteranceIds.includes(u.id))
        .flatMap((u: any) => u.cueIds);
      raw.translations = raw.translations.filter((t: any) => cues.includes(t.cueId));
      return raw;
    },
  };
}

for (const language of ["zh-TW", "zh-CN"] as const)
  test(`${language}: native notation survives offline generation, storage and document validation`, async () => {
    const root = await mkdtemp(join(tmpdir(), "cll-chinese-pipeline-"));
    try {
      const f = chineseLearningFixture(language),
        storage = localStoragePorts(root);
      const document = await new JobManager({ storage, ...generators(f) }, () => {}).start(
        f.request.id,
        f.request,
      );
      assert.equal(document.schemaVersion, 7);
      assert.equal(document.profile.targetLanguage, language);
      if (document.schemaVersion !== 7) throw new Error("Expected V6");
      assert.deepEqual(document.cues, f.request.cues);
      assert.deepEqual(document.sections[0].pronunciations, f.document.sections[0].pronunciations);
      assert.equal(
        document.reusableItems[0].examples[0].dialogue[1].pronunciation?.[0].reading,
        language === "zh-TW" ? "ㄨㄛˇ" : "wǒ",
      );
      assert.deepEqual(
        readLearningDocument(await storage.documents.get(document.id)),
        JSON.parse(JSON.stringify(document)),
      );
      const teaching = pointsTeachingPrompt(f.request, f.input, 4096);
      assert.match(teaching, /without relying on spaces/);
      assert.match(
        teaching,
        language === "zh-TW" ? /Zhuyin with tones/ : /tone-marked Hanyu Pinyin/,
      );
      const invalid = structuredClone(f.raw);
      invalid.pronunciations[0].segments[0].reading = "/wrong/";
      const prepared = prepareTeachingBatch(invalid, f.input, f.request.profile, "test");
      assert.equal(prepared.targets.length, 1);
      const repair = pointsPronunciationRepairPrompt(f.request, prepared, 4096, f.input);
      assert.match(repair, language === "zh-TW" ? /Zhuyin with tones/ : /tone-marked Hanyu Pinyin/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
test("V6 runs complete utterances, repairs once, splits, checkpoints and resumes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-v6-pipeline-"));
  try {
    const f = pointsFixture(),
      storage = localStoragePorts(root),
      g = generators(f);
    let completeCalls = 0;
    const manager = new JobManager(
      {
        storage,
        ...g,
        generateSection: async (a, p, s) => {
          const data = teachingData(p);
          if (data.requiredUtteranceIds.length > 1)
            return {
              status: "needs_split",
              sceneId: data.scene.id,
              utteranceGroups: data.requiredUtteranceIds.map((id: string) => [id]),
            };
          if (data.requiredUtteranceIds[0] === data.scene.utterances[0].id) {
            completeCalls++;
            return g.generateSection(a, p);
          }
          throw new Error("Injected unavailable model");
        },
      },
      () => {},
    );
    await assert.rejects(manager.start(f.request.id, f.request), /one repair/);
    const saved = await storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.learningPlan.batches.filter(b => b.result).length, 1);
    assert.equal(completeCalls, 1);
    const next = new JobManager({ storage, ...g }, () => {});
    const doc = await next.resume(f.request.id, f.request.id);
    assert.equal(doc.schemaVersion, 7);
    assert.ok(doc.schemaVersion === 7);
    assert.equal(doc.points.length, 3);
    assert.equal(doc.sections[0].utterances.length, 2);
    assert.equal(completeCalls, 1);
    assert.deepEqual((await storage.documents.get(doc.id))?.cues, f.request.cues);
    assert.equal((await storage.jobs.get(doc.id))?.summary.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("missing utterances and malformed output get exactly one repair before failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-v6-repair-"));
  try {
    const f = pointsFixture(),
      storage = localStoragePorts(root),
      g = generators(f);
    let calls = 0;
    const manager = new JobManager(
      {
        storage,
        ...g,
        generateSection: async () => {
          calls++;
          return { status: "complete", utterances: [] };
        },
      },
      () => {},
    );
    await assert.rejects(manager.start(f.request.id, f.request), /one repair/);
    assert.equal(calls, 2);
    const job = await storage.jobs.get(f.request.id);
    assert.ok(job?.schemaVersion === 5);
    assert.equal(job.learningPlan.batches[0].result, undefined);
    assert.equal(await storage.documents.get(f.request.id), null);
    await assert.rejects(
      manager.resume(f.request.id, f.request.id),
      /Resumed teaching batch still invalid/,
    );
    assert.equal(
      calls,
      3,
      "manual resume retries generation without renewing the batch's repair allowance",
    );
    assert.equal(
      (await new JobManager({ storage, ...g }, () => {}).resume(f.request.id, f.request.id))
        .schemaVersion,
      7,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("malformed Japanese contraction template receives the existing single structural repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-ja-frame-repair-"));
  try {
    const f = pointsFixture();
    f.request.profile.targetLanguage = "ja";
    f.request.profile.level = "N3";
    const g = generators(f),
      storage = localStoragePorts(root);
    let calls = 0;
    const manager = new JobManager(
      {
        storage,
        ...g,
        generateSection: async (agent, prompt) => {
          const raw = await g.generateSection(agent, prompt);
          raw.reusableItems[0].pattern =
            ++calls === 1 ? "[動詞て形省略い]てた？" : "[動詞て形]た？";
          if (calls === 2) assert.match(prompt, /invalid_construction/);
          return raw;
        },
      },
      () => {},
    );
    const document = await manager.start(f.request.id, f.request);
    assert.equal(calls, 2);
    assert.equal(document.reusableItems[0].pattern, "[動詞て形]た？");
    assert.deepEqual((await storage.documents.get(document.id))?.cues, f.request.cues);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("14 languages and 17 level strategies; Detailed never changes candidate/selection input", () => {
  const f = pointsFixture();
  const levels = new Set<string>();
  for (const language of LEARNING_LANGUAGES)
    for (const level of levelsForTargetLanguage(language)) {
      const request = {
        ...f.request,
        profile: {
          ...f.request.profile,
          targetLanguage: language,
          level,
          emphasizedExplanations: [],
        },
      };
      const prompt = pointsCandidatePrompt(
        request,
        request.cues.map(c => c.id),
        4096,
      );
      assert.doesNotMatch(prompt, /\{\{\w+\}\}/);
      assert.match(prompt, /Learner proficiency:/);
      assert.equal(
        pointsCandidatePrompt(
          { ...request, profile: { ...request.profile, emphasizedExplanations: ["grammar"] } },
          request.cues.map(c => c.id),
          4096,
        ),
        prompt,
      );
      levels.add((language === "ja" ? "JLPT" : language === "ko" ? "TOPIK" : "CEFR") + level);
    }
  assert.equal(levels.size, 17);
  assert.deepEqual(learningPointsBudget({ contextWindow: 32768, maxOutputTokens: 32000 }), {
    output: 8192,
    input: 23552,
  });
  assert.throws(() => learningPointsBudget({ contextWindow: 2000, maxOutputTokens: 1000 }));
});

test("truncated teaching output splits immediately without a same-budget repair or lost utterances", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-v6-truncated-"));
  try {
    const f = pointsFixture(),
      storage = localStoragePorts(root),
      g = generators(f);
    let truncatedCalls = 0;
    const manager = new JobManager(
      {
        storage,
        ...g,
        generateSection: async (a, p) => {
          if (teachingData(p).requiredUtteranceIds.length > 1) {
            truncatedCalls++;
            throw new Error("truncated_output: incomplete JSON");
          }
          return g.generateSection(a, p);
        },
      },
      () => {},
    );
    const doc = await manager.start(f.request.id, f.request);
    assert.ok(doc.schemaVersion === 7);
    assert.equal(truncatedCalls, 1);
    assert.equal(doc.sections[0].utterances.length, 2);
    const job = await storage.jobs.get(doc.id);
    assert.ok(job?.schemaVersion === 5);
    assert.equal(job.learningPlan.batches.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a truncated single utterance expands its budget while retaining completed batches", async () => {
  const f = pointsFixture(),
    g = generators(f),
    outputs: number[] = [];
  let completedCalls = 0;
  const h = await readingJob(f, async (a: any, p: string) => {
    const data = teachingData(p);
    if (data.requiredUtteranceIds.length > 1)
      return {
        status: "needs_split",
        sceneId: data.scene.id,
        utteranceGroups: data.requiredUtteranceIds.map((id: string) => [id]),
      };
    if (data.requiredUtteranceIds[0] === data.scene.utterances[0].id) {
      completedCalls++;
      return g.generateSection(a, p);
    }
    const output = Number(/Output budget in tokens: (\d+)/.exec(p)![1]);
    outputs.push(output);
    if (output < 16384) throw new Error("truncated_output: model reached output limit");
    return g.generateSection(a, p);
  });
  try {
    await h.storage.jobs.update(f.request.id, j => ({
      ...j,
      execution: { ...j.execution!, contextWindow: 1048576, maxOutputTokens: 65536 },
    }));
    const doc = await h.run();
    assert.deepEqual(outputs, [8192, 16384]);
    assert.equal(completedCalls, 1);
    assert.deepEqual(doc.cues, f.request.cues);
    const saved = await h.storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.learningPlan.batches[1].repairAttempted, undefined);
    assert.equal(saved.learningPlan.batches[1].outputTokenBudget, 16384);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

async function budgetJob(
  generate: (
    a: any,
    p: string,
    signal: AbortSignal,
    g: ReturnType<typeof generators>,
  ) => Promise<unknown>,
  model = { contextWindow: 1048576, maxOutputTokens: 65536 },
) {
  const f = pointsFixture(),
    g = generators(f);
  let completedCalls = 0;
  const h = await readingJob(f, async (a: any, p: string, signal: AbortSignal) => {
    const data = teachingData(p);
    if (data.requiredUtteranceIds.length > 1)
      return {
        status: "needs_split",
        sceneId: data.scene.id,
        utteranceGroups: data.requiredUtteranceIds.map((id: string) => [id]),
      };
    if (data.requiredUtteranceIds[0] === data.scene.utterances[0].id) {
      completedCalls++;
      return g.generateSection(a, p);
    }
    return generate(a, p, signal, g);
  });
  await h.storage.jobs.update(f.request.id, j => ({
    ...j,
    execution: { ...j.execution!, ...model },
  }));
  return { ...h, f, completedCalls: () => completedCalls };
}
const outputBudgetIn = (p: string) => Number(/Output budget in tokens: (\d+)/.exec(p)![1]);

test("legacy truncated checkpoints resume with a larger budget and preserve their repair allowance", async () => {
  let resumed = false;
  const outputs: number[] = [];
  const h = await budgetJob(async (a, p, _signal, g) => {
    if (!resumed) throw new Error("Injected prior failure");
    outputs.push(outputBudgetIn(p));
    assert.match(p, /truncated_output/);
    return g.generateSection(a, p);
  });
  try {
    await assert.rejects(h.run(), /one repair/);
    await h.storage.jobs.update(h.f.request.id, j => {
      assert.ok(j.schemaVersion === 5);
      return {
        ...j,
        learningPlan: {
          ...j.learningPlan,
          batches: j.learningPlan.batches.map((b, i) =>
            i === 1
              ? {
                  ...b,
                  lastIssue: {
                    code: "truncated_output",
                    path: "batch",
                    description: "Error: truncated_output: model reached output limit",
                  },
                }
              : b,
          ),
        },
      };
    });
    resumed = true;
    const doc = await h.run();
    assert.deepEqual(outputs, [16384]);
    assert.equal(h.completedCalls(), 1);
    assert.deepEqual(doc.cues, h.f.request.cues);
    const saved = await h.storage.jobs.get(h.f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.learningPlan.batches[1].repairAttempted, true);
    assert.equal(saved.learningPlan.batches[1].outputTokenBudget, 16384);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("budget expansion stops at model or context capacity without renewing automatic repair", async () => {
  for (const [model, expected] of [
    [{ contextWindow: 1048576, maxOutputTokens: 10000 }, [8192, 10000]],
    [{ contextWindow: 32768, maxOutputTokens: 65536 }, [8192]],
    [{ contextWindow: 65536, maxOutputTokens: 65536 }, [8192, 16384]],
    [{ contextWindow: 1048576, maxOutputTokens: 65536 }, [8192, 16384, 32768, 65536]],
  ] as const) {
    const outputs: number[] = [];
    const h = await budgetJob(async (_a, p) => {
      outputs.push(outputBudgetIn(p));
      throw new Error("truncated_output: model reached output limit");
    }, model);
    try {
      await assert.rejects(h.run(), /single_utterance_exceeds_budget: output truncated at/);
      assert.deepEqual(outputs, expected);
      const saved = await h.storage.jobs.get(h.f.request.id);
      assert.ok(saved?.schemaVersion === 5);
      assert.equal(saved.learningPlan.batches[1].repairAttempted, undefined);
      assert.equal(saved.learningPlan.batches[1].lastIssue?.outputTokenBudget, expected.at(-1));
      assert.equal(h.completedCalls(), 1);
      await assert.rejects(
        h.storage.jobs.update(h.f.request.id, j => {
          assert.ok(j.schemaVersion === 5);
          return {
            ...j,
            learningPlan: {
              ...j.learningPlan,
              batches: j.learningPlan.batches.map((b, i) =>
                i === 1 ? { ...b, outputTokenBudget: expected.at(-1)! + 1 } : b,
              ),
            },
          };
        }),
        /Teaching output budget exceeds frozen model capacity/,
      );
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

test("invalid JSON remains a structural error without expanding output or reporting a budget failure", async () => {
  const outputs: number[] = [];
  const h = await budgetJob(async (_a, p) => {
    outputs.push(outputBudgetIn(p));
    throw new Error("Pi returned invalid lesson JSON. The model must return one JSON object.");
  });
  try {
    await assert.rejects(
      h.run(),
      e =>
        /one repair.*invalid lesson JSON/s.test(String(e)) &&
        !/single_utterance_exceeds_budget/.test(String(e)),
    );
    assert.deepEqual(outputs, [8192, 8192]);
    const saved = await h.storage.jobs.get(h.f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.learningPlan.batches[1].lastIssue?.code, "validation_error");
    assert.equal(saved.learningPlan.batches[1].outputTokenBudget, undefined);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("interrupted expanded budget is persisted and resumed without doubling or rerunning completed work", async () => {
  const controller = new AbortController(),
    outputs: number[] = [];
  let resumed = false;
  const h = await budgetJob(async (a, p, _signal, g) => {
    const budget = outputBudgetIn(p);
    outputs.push(budget);
    if (budget === 8192) throw new Error("truncated_output: model reached output limit");
    if (!resumed) {
      controller.abort();
      throw new Error("Interrupted");
    }
    return g.generateSection(a, p);
  });
  try {
    await assert.rejects(h.run(controller.signal), /Interrupted/);
    const saved = await h.storage.jobs.get(h.f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.learningPlan.batches[1].outputTokenBudget, 16384);
    resumed = true;
    await h.run();
    assert.deepEqual(outputs, [8192, 16384, 16384]);
    assert.equal(h.completedCalls(), 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("invalid selection gets one repair; non-progress and blocked teaching preserve checkpoint", async () => {
  for (const mode of ["selection", "split", "blocked"] as const) {
    const root = await mkdtemp(join(tmpdir(), "cll-v6-edge-"));
    try {
      const f = pointsFixture(),
        storage = localStoragePorts(root),
        g = generators(f);
      let calls = 0;
      const manager = new JobManager(
        {
          storage,
          ...g,
          generateSelection:
            mode === "selection"
              ? async () => {
                  calls++;
                  return { selectedCandidateIds: ["unknown"] };
                }
              : g.generateSelection,
          generateSection: async (_a, p) => {
            const data = teachingData(p);
            return mode === "split"
              ? {
                  status: "needs_split",
                  sceneId: data.scene.id,
                  utteranceGroups: [data.requiredUtteranceIds, data.requiredUtteranceIds],
                }
              : {
                  status: "blocked",
                  sceneId: data.scene.id,
                  reason: "single_utterance_exceeds_budget",
                  utteranceIds: [data.requiredUtteranceIds[0]],
                };
          },
        },
        () => {},
      );
      await assert.rejects(
        manager.start(f.request.id, f.request),
        mode === "selection" ? /one repair/ : mode === "split" ? /no progress/ : /single_utterance/,
      );
      if (mode === "selection") assert.equal(calls, 2);
      assert.equal(await storage.documents.get(f.request.id), null);
      assert.equal((await storage.jobs.get(f.request.id))?.summary.status, "failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("V4 resume rejects changed workflow, prompt, language, level or frozen source before any model call", async () => {
  for (const changed of [
    "workflowVersion",
    "promptVersion",
    "languageStrategyVersion",
    "levelStrategyVersion",
    "source",
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), "cll-v6-frozen-"));
    try {
      const f = pointsFixture(),
        storage = localStoragePorts(root),
        job = createSceneJob({ ...f.request, outputSchemaVersion: 7 }, 1);
      job.summary.status = "failed";
      job.execution = {
        workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
        promptVersion: LEARNING_POINTS_PROMPT_VERSION,
        schemaVersion: "7",
        languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
        levelStrategyVersion: LEVEL_STRATEGY_VERSION,
        qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
        inputFingerprint: createHash("sha256").update(JSON.stringify(job.request)).digest("hex"),
        provider: "antigravity",
        modelId: "gemini-3.7-flash",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        chunkPlan: [job.request.cues.map(c => c.id)],
        calls: [],
      };
      if (changed === "source") job.request.cues[0].originalText += " changed";
      else
        job.execution[changed] =
          changed === "promptVersion" ? "learning-points-prompts-9" : "incompatible";
      await mkdir(join(root, "jobs"), { recursive: true });
      await writeFile(join(root, "jobs", job.summary.id + ".json"), JSON.stringify(job));
      await assert.rejects(
        new JobManager({ storage }, () => {}).resume(job.summary.id, job.summary.id),
        changed === "source" ? /frozen execution snapshot/ : /停止支援/,
      );
      assert.equal(
        JSON.parse(await readFile(join(root, "jobs", job.summary.id + ".json"), "utf8")).summary
          .status,
        "failed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// Exercise production checkpoint/merge behavior with deterministic model outputs.
async function readingJob(f: ReturnType<typeof pointsFixture>, generateSection: any) {
  const root = await mkdtemp(join(tmpdir(), "cll-reading-recovery-"));
  const storage = localStoragePorts(root),
    job = createSceneJob({ ...f.request, outputSchemaVersion: 7 }, 1);
  job.summary.status = "running";
  job.execution = {
    workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
    promptVersion: LEARNING_POINTS_PROMPT_VERSION,
    schemaVersion: "7",
    languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
    levelStrategyVersion: LEVEL_STRATEGY_VERSION,
    qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
    inputFingerprint: createHash("sha256").update(JSON.stringify(f.request)).digest("hex"),
    provider: f.request.agent.provider,
    modelId: f.request.agent.modelId,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    chunkPlan: [f.request.cues.map(c => c.id)],
    calls: [],
  };
  await storage.jobs.create(job);
  const originalUpdate = storage.jobs.update.bind(storage.jobs);
  storage.jobs.update = (id, change) =>
    originalUpdate(id, current => {
      const next = change(current);
      if (next.schemaVersion === 5)
        for (const b of next.learningPlan.batches)
          if (b.pronunciationDiagnostics)
            assert.ok(
              b.result,
              "final reading diagnostics and validated result must be committed atomically",
            );
      return next;
    });
  const deps: import("./pipeline").PipelineDependencies = {
    storage,
    ...generators(f),
    generateSection,
  };
  const { runLearningPointsPipeline } = await import("./learning-points-pipeline");
  return {
    storage,
    root,
    deps,
    run: (
      signal = new AbortController().signal,
      notify: (summary: import("@contextual/core").JobSummary) => void = () => {},
    ) => runLearningPointsPipeline(job.summary.id, deps, signal, notify),
  };
}
function withBadReading(f: ReturnType<typeof pointsFixture>, raw: any) {
  raw.pronunciations = [
    {
      cueId: f.request.cues[0].id,
      segments: [{ text: f.request.cues[0].originalText, reading: "roman" }],
    },
  ];
  return raw;
}
test("invalid optional readings are omitted locally while teaching remains complete", async () => {
  for (const reading of ["roman", "", "/wrong/"]) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = "ja";
    f.request.profile.level = "N3";
    f.request.profile.enabledExplanations!.push("pronunciation");
    const g = generators(f);
    let calls = 0;
    const h = await readingJob(f, async (a: any, prompt: string) => {
      calls++;
      const raw = withBadReading(f, await g.generateSection(a, prompt));
      raw.pronunciations[0].segments[0].reading = reading;
      return raw;
    });
    try {
      const doc = await h.run();
      assert.equal(calls, 1);
      assert.equal(doc.sections[0].pronunciations, undefined);
      assert.equal(doc.points.length, 3);
      assert.equal(doc.reusableItems.length, 2);
      assert.deepEqual(doc.cues, f.request.cues);
      assert.equal(doc.execution!.pronunciationDiagnostics![0].action, "omitted");
      const saved = await h.storage.jobs.get(f.request.id);
      assert.equal(saved!.summary.pronunciationMissingCount, 1);
      assert.ok(saved?.schemaVersion === 5);
      assert.equal(saved.learningPlan.batches[0].pendingTeaching, undefined);
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  }
});
test("received teaching racing cancellation is saved and not regenerated on resume", async () => {
  const f = pointsFixture();
  f.request.profile.targetLanguage = "ja";
  f.request.profile.level = "N3";
  f.request.profile.enabledExplanations!.push("pronunciation");
  const g = generators(f),
    controller = new AbortController();
  let calls = 0;
  const h = await readingJob(f, async (a: any, prompt: string) => {
    calls++;
    const raw = withBadReading(f, await g.generateSection(a, prompt));
    controller.abort();
    return raw;
  });
  try {
    await assert.rejects(h.run(controller.signal), /abort/i);
    const saved = await h.storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.ok(saved.learningPlan.batches[0].pendingTeaching);
    assert.equal(saved.learningPlan.batches[0].result, undefined);
    const doc = await h.run();
    assert.equal(calls, 1);
    assert.equal(doc.sections[0].pronunciations, undefined);
    assert.equal(doc.execution!.pronunciationDiagnostics![0].action, "omitted");
    assert.equal(
      new Set(doc.execution!.pronunciationDiagnostics!.map(d => d.id)).size,
      doc.execution!.pronunciationDiagnostics!.length,
    );
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("structural repair uses shared allowance; subsequent reading failure downgrades without another call", async () => {
  const f = pointsFixture();
  f.request.profile.targetLanguage = "ja";
  f.request.profile.level = "N3";
  f.request.profile.enabledExplanations!.push("pronunciation");
  const g = generators(f);
  let calls = 0;
  const h = await readingJob(f, async (a: any, p: string) => {
    calls++;
    if (calls === 1) return {};
    assert.ok(!p.includes("STAGE: Repair only"));
    return withBadReading(f, await g.generateSection(a, p));
  });
  try {
    const doc = await h.run();
    assert.equal(calls, 2);
    assert.equal(doc.sections[0].pronunciations, undefined);
    assert.equal((await h.storage.jobs.get(f.request.id))!.summary.pronunciationMissingCount, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("structural resume carries saved issues and does not reset the repair budget", async () => {
  const f = pointsFixture();
  let calls = 0;
  const g = generators(f);
  const h = await readingJob(f, async (a: any, p: string) => {
    calls++;
    if (calls <= 2) return {};
    assert.match(p, /validation_error/);
    assert.match(p, /previousOutput":null/);
    return g.generateSection(a, p);
  });
  try {
    await assert.rejects(h.run(), /one repair/);
    const saved = await h.storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.ok(saved.learningPlan.batches[0].lastIssue);
    const doc = await h.run();
    assert.equal(calls, 3);
    assert.equal(doc.points.length, 3);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("interruption after the validated draft is saved resumes without another model call", async () => {
  const f = pointsFixture(),
    g = generators(f),
    controller = new AbortController();
  let outputReady = false,
    calls = 0;
  const h = await readingJob(f, async (a: any, prompt: string) => {
    calls++;
    const raw = await g.generateSection(a, prompt);
    outputReady = true;
    return raw;
  });
  try {
    await assert.rejects(
      h.run(controller.signal, () => {
        if (outputReady) controller.abort();
      }),
      /abort/i,
    );
    const saved = await h.storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.ok(saved.learningPlan.batches[0].pendingTeaching);
    const doc = await h.run();
    assert.equal(calls, 1);
    assert.equal(doc.points.length, 3);
    assert.equal(doc.sections[0].utterances.length, 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("high reasoning starts with headroom without changing the saved intensity", async () => {
  const f = pointsFixture(),
    g = generators(f),
    outputs: number[] = [];
  f.request.agent.thinkingLevel = "high";
  const h = await readingJob(f, async (a: any, p: string) => {
    assert.equal(a.thinkingLevel, "high");
    outputs.push(outputBudgetIn(p));
    return g.generateSection(a, p);
  });
  try {
    await h.storage.jobs.update(f.request.id, j => ({
      ...j,
      execution: { ...j.execution!, contextWindow: 1048576, maxOutputTokens: 65536 },
    }));
    await h.run();
    assert.deepEqual(outputs, [32768]);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("near-cap invalid JSON is treated as truncation even when the provider reports stop", async () => {
  const f = pointsFixture(),
    g = generators(f);
  const h = await readingJob(f, undefined);
  let clipped = 0,
    completed = 0;
  h.deps.generateText = async (a, p, _signal, options) => {
    const data = teachingData(p);
    const partial = data.requiredUtteranceIds.length > 1;
    if (partial) clipped++;
    else completed++;
    assert.doesNotMatch(p, /STAGE: Repair/, "clipped output must not consume structural repair");
    const call = {
      step: options!.step!,
      provider: a.provider,
      modelId: a.modelId,
      at: new Date().toISOString(),
      usage: { output: partial ? 8188 : 2000, reasoning: partial ? 7864 : 500 },
    };
    await options!.onCall?.(call);
    return {
      text: partial ? '{"status":"complete",' : JSON.stringify(await g.generateSection(a, p)),
      call,
    };
  };
  try {
    const doc = await h.run();
    assert.equal(clipped, 1);
    assert.equal(completed, 2);
    assert.equal(doc.sections[0].utterances.length, 2);
    const saved = await h.storage.jobs.get(f.request.id);
    assert.ok(saved?.schemaVersion === 5);
    assert.equal(saved.execution!.calls.length, 3);
    assert.ok(saved.learningPlan.batches.every(b => !b.repairAttempted));
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("reasoning headroom respects the frozen model and context capacity", () => {
  const large = { contextWindow: 1048576, maxOutputTokens: 65536 };
  assert.equal(initialLearningPointsBudget(large, "medium").output, 16384);
  assert.equal(initialLearningPointsBudget(large, "high").output, 32768);
  assert.equal(initialLearningPointsBudget(large, "xhigh").output, 32768);
  assert.equal(initialLearningPointsBudget(large, "low").output, 8192);
  assert.equal(
    initialLearningPointsBudget({ ...large, maxOutputTokens: 8192 }, "high").output,
    8192,
  );
  assert.equal(
    initialLearningPointsBudget({ ...large, contextWindow: 32768 }, "high").output,
    8192,
  );
});

test("valid JSON at the output cap is accepted without a capacity retry", async () => {
  const f = pointsFixture(),
    g = generators(f),
    h = await readingJob(f, undefined);
  let calls = 0;
  h.deps.generateText = async (a, p) => {
    calls++;
    return {
      text: JSON.stringify(await g.generateSection(a, p)),
      call: {
        step: "test",
        provider: a.provider,
        modelId: a.modelId,
        at: new Date().toISOString(),
        usage: { output: 8192, reasoning: 500 },
      },
    };
  };
  try {
    await h.run();
    assert.equal(calls, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("retired prompt versions cannot enter a new pipeline", () => {
  for (const version of [
    "learning-points-prompts-8",
    "learning-points-prompts-9",
    "learning-points-prompts-10",
    "learning-points-prompts-12",
    "learning-points-prompts-14",
    "learning-points-prompts-15",
    "learning-points-prompts-16",
  ]) {
    assert.equal(supportsLearningPointsPromptVersion(version), false);
    assert.throws(() => learningPointsPrompts(version), /Unsupported/);
  }
  assert.equal(supportsLearningPointsPromptVersion(LEARNING_POINTS_PROMPT_VERSION), true);
});

test("invalid example readings retain useful examples and their diagnostics across cancellation", async () => {
  for (const cancel of [false, true]) {
    const f = pointsFixture(),
      g = generators(f),
      controller = new AbortController();
    f.request.profile.enabledExplanations!.push("pronunciation");
    let calls = 0;
    const h = await readingJob(f, async (a: any, prompt: string) => {
      calls++;
      const raw = await g.generateSection(a, prompt);
      raw.reusableItems[0].examples[0].dialogue[0].pronunciation = [
        { text: raw.reusableItems[0].examples[0].dialogue[0].text, reading: "not IPA" },
      ];
      if (cancel) controller.abort();
      return raw;
    });
    try {
      if (cancel) {
        await assert.rejects(h.run(controller.signal), /abort/i);
        const saved = await h.storage.jobs.get(f.request.id);
        assert.ok(saved?.schemaVersion === 5);
        assert.equal(saved.learningPlan.batches[0].pendingTeaching?.diagnostics.length, 1);
      }
      const doc = await h.run();
      assert.equal(calls, 1);
      assert.equal(doc.reusableItems.length, 2);
      assert.equal(doc.reusableItems[0].examples[0].dialogue[0].pronunciation, undefined);
      assert.equal(doc.execution!.pronunciationDiagnostics![0].action, "omitted");
      const saved = await h.storage.jobs.get(f.request.id);
      assert.ok(saved?.schemaVersion === 5);
      assert.equal(saved.learningPlan.batches[0].pendingTeaching, undefined);
      assert.equal(saved.learningPlan.batches[0].pronunciationDiagnostics?.length, 1);
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  }
});

test("valid teaching with uncertainty completes in one call without quality review", async () => {
  const f = pointsFixture(),
    g = generators(f);
  let teachingCalls = 0;
  const h = await readingJob(f, async (a: any, prompt: string) => {
    teachingCalls++;
    const raw = await g.generateSection(a, prompt);
    const data = teachingData(prompt);
    raw.risks = [
      {
        type: "reference_uncertainty",
        unitId: raw.utterances[1].id,
        path: "/utterances/1/meaning",
        sourceSpans: data.scene.utterances[1].sourceSpans,
        description: "An uncertain source name can remain quoted without blocking the lesson.",
      },
    ];
    return raw;
  });
  // Historical hooks are deliberately outside the active dependency contract.
  Object.assign(h.deps, {
    generateQuality: async () => {
      throw new Error("unexpected quality review");
    },
    generateQualityRepair: async () => {
      throw new Error("unexpected quality repair");
    },
  });
  try {
    const doc = await h.run();
    assert.equal(teachingCalls, 1);
    assert.deepEqual(doc.cues, f.request.cues);
    assert.equal(doc.points.length, 3);
    assert.equal((await h.storage.jobs.get(f.request.id))!.summary.status, "completed");
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

for (const legacy of [
  { promptVersion: "learning-points-prompts-13", qualityStrategyVersion: "learning-quality-1" },
  { promptVersion: "learning-points-prompts-14", qualityStrategyVersion: "program-validation-1" },
  { promptVersion: "learning-points-prompts-15", qualityStrategyVersion: "program-validation-2" },
  { promptVersion: "learning-points-prompts-16", qualityStrategyVersion: "program-validation-2" },
])
  test(`resuming ${legacy.promptVersion} retains completed batches and regenerates only unfinished teaching`, async () => {
    const root = await mkdtemp(join(tmpdir(), "cll-simple-resume-"));
    try {
      const f = pointsFixture(),
        storage = localStoragePorts(root),
        g = generators(f);
      let firstCalls = 0,
        failedDraft: any;
      const manager = new JobManager(
        {
          storage,
          ...g,
          generateSection: async (a, prompt) => {
            const data = teachingData(prompt);
            if (data.requiredUtteranceIds.length > 1)
              return {
                status: "needs_split",
                sceneId: data.scene.id,
                utteranceGroups: data.requiredUtteranceIds.map((id: string) => [id]),
              };
            const raw = await g.generateSection(a, prompt);
            if (data.requiredUtteranceIds[0] === data.scene.utterances[0].id) {
              firstCalls++;
              return raw;
            }
            failedDraft = raw;
            throw new Error("injected unfinished batch");
          },
        },
        () => {},
      );
      await assert.rejects(manager.start(f.request.id, f.request));
      const before = await storage.jobs.get(f.request.id);
      assert.ok(before?.schemaVersion === 5);
      const completed = structuredClone(before.learningPlan.batches[0]);
      await storage.jobs.update(f.request.id, job => {
        assert.ok(job.schemaVersion === 5 && job.execution);
        const execution = {
          ...job.execution,
          ...legacy,
        };
        const batches = job.learningPlan.batches.map(b => {
          if (b.result || legacy.qualityStrategyVersion !== "learning-quality-1") return b;
          const scene = job.learningPlan.selected!.find(s => s.id === b.sceneId)!;
          const evidence = new Set([...scene.dialogueCueIds, ...scene.contextCueIds]);
          const results = job.learningPlan.batches.flatMap(part =>
            part.result ? [part.result] : [],
          );
          const input = {
            scene,
            requiredUtteranceIds: b.utteranceIds,
            sourceWindow: job.request.cues.filter(c => evidence.has(c.id)),
            existingPoints: results.flatMap(r => r.points),
            existingReusableItems: results.flatMap(r => r.reusableItems),
          };
          const hash = (value: unknown) =>
            createHash("sha256").update(JSON.stringify(value)).digest("hex");
          return {
            ...b,
            quality: {
              phase: "blocked" as const,
              repairEligible: false,
              risks: [],
              diagnostic: "Major issues remain after one repair",
              draft: failedDraft,
              inputHash: hash({ input, profile: job.request.profile, agent: job.request.agent }),
              draftHash: hash(failedDraft),
              originalDraftHash: hash(failedDraft),
            },
          };
        });
        return {
          ...job,
          execution,
          summary: { ...job.summary, execution },
          learningPlan: { ...job.learningPlan, batches },
        };
      });
      const calls: string[][] = [];
      const resumed = new JobManager(
        {
          storage,
          ...g,
          generateSection: async (a, prompt) => {
            calls.push(teachingData(prompt).requiredUtteranceIds);
            return g.generateSection(a, prompt);
          },
        },
        () => {},
      );
      const doc = await resumed.resume(f.request.id, f.request.id);
      assert.equal(firstCalls, 1);
      assert.deepEqual(calls, [before.learningPlan.batches[1].utteranceIds]);
      const after = await storage.jobs.get(f.request.id);
      assert.ok(after?.schemaVersion === 5);
      assert.deepEqual(after.learningPlan.batches[0], completed);
      assert.equal(after.learningPlan.batches[1].quality, undefined);
      assert.equal(doc.sections[0].utterances.length, 2);
      assert.equal(doc.execution!.previousExecution?.promptVersion, legacy.promptVersion);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
