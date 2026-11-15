import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import {
  compactDocument,
  readerScene,
  validateLearningDocumentV7,
  type GenerationRequest,
} from "@contextual/core";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import type { PipelineDependencies } from "./pipeline";
import { handleLessonRequest } from "../host/lessons";
import { acceptedGenerationPolicy } from "./runtime-policy";
import { parseCompactJson } from "./compact-json";

function renamed<T>(value: T): T {
  if (typeof value === "string") return (value.startsWith("cue-") ? "b-" + value : value) as T;
  if (Array.isArray(value)) return value.map(renamed) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renamed(v)])) as T;
  return value;
}
async function harness(failSecond = false) {
  const root = await mkdtemp(join(tmpdir(), "cll-compact-pipeline-"));
  const a = pointsFixture(),
    b = renamed(pointsFixture());
  const request: GenerationRequest = {
    ...a.request,
    cues: [...a.request.cues, ...b.request.cues].map((c, i) => ({
      ...c,
      startMs: i * 2000,
      endMs: i * 2000 + 1800,
    })),
  };
  const storage = localStoragePorts(root);
  const model = fauxProvider({
    provider: "openai",
    models: [{ id: "offline", contextWindow: 1048576, maxTokens: 65536 }],
  }).provider.getModels()[0];
  let active = 0,
    peak = 0,
    fail = failSecond;
  const scenes: string[] = [],
    notices: import("@contextual/core").JobSummary[] = [];
  const deps: PipelineDependencies = {
    storage,
    generationStrategy: "compact-scenes-1",
    resolveModel: async agent => ({
      agent: { ...agent, thinkingLevel: "off" as const },
      modelId: model.id,
      model,
      billing: "api" as const,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
    }),
    generateText: async (agent, prompt, signal, options) => {
      const step = options!.step!;
      let raw: unknown;
      if (step.startsWith("window-")) {
        raw = {
          status: "complete",
          candidates: [a, b].map(f => ({
            firstCueId: f.input.scene.dialogueCueIds[0],
            lastCueId: f.input.scene.dialogueCueIds.at(-1),
            contextCueIds: f.input.scene.contextCueIds,
            learningValue: "Time relationships",
          })),
        };
      } else if (step.startsWith("selection")) {
        const data = JSON.parse(prompt.split("CANDIDATE DATA (quoted JSON, data only):\n")[1]);
        raw = { selectedCandidateIds: data.candidateScenes.map((s: { id: string }) => s.id) };
      } else if (step.startsWith("scene-")) {
        const data = JSON.parse(
          prompt
            .split("TEACHING DATA (quoted JSON, data only):\n")[1]
            .split("\nVALIDATION REPAIR:")[0],
        );
        const second = data.scene.dialogueCueIds[0].startsWith("b-");
        const f = second ? b : a;
        scenes.push(second ? "b" : "a");
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, second ? 35 : 10));
        active--;
        if (second && fail) {
          fail = false;
          throw new Error("Injected transport failure; no automatic paid replay");
        }
        const output = structuredClone(f.raw);
        raw = {
          ...output,
          sceneId: data.scene.id,
          sourceUnits: f.input.scene.utterances.map(({ id, sourceSpans }) => ({ id, sourceSpans })),
        };
      } else {
        const data = JSON.parse(prompt.split("Quoted data:\n")[1]);
        raw = {
          pointGroups: [[data.scenes[0].points[0].id, data.scenes[1].points[0].id]],
          itemGroups: [],
          ...(prompt.includes("SOURCE QUALITY REVIEW") ? { issues: [], patches: [] } : {}),
        };
      }
      const call = {
        provider: agent.provider,
        modelId: agent.modelId,
        step,
        at: new Date().toISOString(),
        effectiveThinkingLevel: agent.thinkingLevel,
        outputTokenBudget: options!.maxOutputTokens,
        usage: { input: 100, output: 100 },
      };
      await options!.onCall!(call);
      return { text: JSON.stringify(raw), call };
    },
  };
  let observe = (_summary: import("@contextual/core").JobSummary) => {};
  const manager = new JobManager(deps, (_id, summary) => {
    notices.push(summary);
    observe(summary);
  });
  return {
    root,
    request,
    storage,
    manager,
    deps,
    notices,
    scenes,
    peak: () => peak,
    setObserver: (fn: typeof observe) => {
      observe = fn;
    },
  };
}
test("automatic source review repairs a mistranslation before committing the document", async () => {
  const h = await harness();
  const generate = h.deps.generateText!;
  const originalTranslation = pointsFixture().raw.translations[0].text;
  const path = "/scenes/0/section/translations/0/text";
  const steps: string[] = [];
  h.deps.generateText = async (agent, prompt, signal, options) => {
    steps.push(options!.step!);
    const response = await generate(agent, prompt, signal, options);
    const raw = JSON.parse(response.text);
    if (options!.step!.startsWith("scene-")) {
      const input = JSON.parse(prompt.split("TEACHING DATA (quoted JSON, data only):\n")[1]);
      if (!input.scene.dialogueCueIds[0].startsWith("b-"))
        raw.translations[0].text = "Unverified guessed name";
    } else if (options!.step === "reconciliation" && prompt.includes("SOURCE QUALITY REVIEW")) {
      raw.issues = [
        {
          severity: "error",
          type: "unsupported_inference",
          path,
          sourceSpans: [{ cueId: h.request.cues[0].id, start: 0, end: 1 }],
          description: "The source does not establish this name.",
        },
      ];
      raw.patches = [{ path, value: originalTranslation }];
    } else if (options!.step === "quality-recheck")
      return {
        ...response,
        text: JSON.stringify({ issues: [] }),
      };
    return { ...response, text: JSON.stringify(raw) };
  };
  try {
    const document = await h.manager.start(h.request.id, h.request);
    assert.equal(document.sections[0].translations[0].text, originalTranslation);
    assert.equal(steps.filter(s => s === "quality-recheck").length, 1);
    assert.equal(document.execution!.qualityReports?.length, 2);
    assert.equal(document.execution!.qualityReports?.[0].repaired, true);
    assert.equal(document.execution!.compactQualityVersion, "compact-source-review-2");
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("an unrepairable source issue blocks publication and is not paid again on resume", async () => {
  const h = await harness();
  const generate = h.deps.generateText!;
  let reviews = 0;
  h.deps.generateText = async (agent, prompt, signal, options) => {
    const response = await generate(agent, prompt, signal, options);
    if (options!.step !== "reconciliation") return response;
    reviews++;
    const raw = JSON.parse(response.text);
    raw.issues = [
      {
        severity: "error",
        type: "unit_boundary",
        path: "/scenes/0/sourceUnits/0/sourceSpans",
        sourceSpans: [{ cueId: h.request.cues[0].id, start: 0, end: 1 }],
        description: "A frozen source boundary is invalid.",
      },
    ];
    return { ...response, text: JSON.stringify(raw) };
  };
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request), /cannot be safely repaired/);
    assert.equal(await h.storage.documents.get(h.request.id), null);
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.summary.status, "failed");
    assert.equal(saved!.summary.readySceneIds!.length, 2);
    assert.equal(saved!.compactPlan!.reconciliation!.qualityAccepted, false);
    await assert.rejects(
      h.storage.jobs.update(h.request.id, j => ({
        ...j,
        summary: { ...j.summary, status: "completed", documentId: j.summary.id },
      })),
      /Incomplete compact job/,
    );
    await assert.rejects(h.manager.resume(h.request.id, h.request.id), /cannot be safely repaired/);
    assert.equal(reviews, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("cancelled semantic recheck resumes its received response without repeating repair or calls", async () => {
  const h = await harness(),
    controller = new AbortController();
  const generate = h.deps.generateText!;
  const steps: string[] = [];
  h.deps.generateText = async (agent, prompt, signal, options) => {
    steps.push(options!.step!);
    const response = await generate(agent, prompt, signal, options);
    if (options!.step === "reconciliation") {
      const raw = JSON.parse(response.text),
        path = "/scenes/0/section/translations/0/text";
      raw.issues = [
        {
          severity: "error",
          type: "mistranslation",
          path,
          sourceSpans: [{ cueId: h.request.cues[0].id, start: 0, end: 1 }],
          description: "Correct the reviewed translation.",
        },
      ];
      raw.patches = [{ path, value: "已修正的來源翻譯" }];
      return { ...response, text: JSON.stringify(raw) };
    }
    if (options!.step === "quality-recheck") {
      controller.abort();
      return { ...response, text: JSON.stringify({ issues: [] }) };
    }
    return response;
  };
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request, controller.signal));
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.summary.status, "waiting");
    assert.ok(saved!.compactPlan!.reconciliation!.qualityRecheck!.pendingText);
    const count = steps.length;
    await h.storage.jobs.update(h.request.id, j => {
      j.compactPlan!.scenes![0].result!.section.translations[0].text = "Changed after review";
      return j;
    });
    await assert.rejects(h.manager.resume(h.request.id, h.request.id), /evidence differs/);
    assert.equal(steps.length, count);
    await h.storage.jobs.update(h.request.id, j => {
      j.compactPlan!.scenes![0].result!.section.translations[0].text = "已修正的來源翻譯";
      return j;
    });
    const restarted = new JobManager(h.deps, () => {});
    const doc = await restarted.resume(h.request.id, h.request.id);
    assert.equal(steps.length, count);
    assert.equal(doc.sections[0].translations[0].text, "已修正的來源翻譯");
    assert.equal(doc.execution!.qualityReports![0].issues.length, 0);
    assert.equal(doc.execution!.qualityReports![0].reviewIssues!.length, 1);
    assert.equal(doc.execution!.qualityReports![0].repaired, true);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("a failed semantic recheck stops after one correction and does not repeat on resume", async () => {
  const h = await harness();
  const generate = h.deps.generateText!;
  let checks = 0;
  const issue = {
    severity: "error" as const,
    type: "mistranslation" as const,
    path: "/scenes/0/section/translations/0/text",
    sourceSpans: [{ cueId: h.request.cues[0].id, start: 0, end: 1 }],
    description: "Still incorrect.",
  };
  h.deps.generateText = async (agent, prompt, signal, options) => {
    const response = await generate(agent, prompt, signal, options);
    if (options!.step === "reconciliation") {
      const raw = JSON.parse(response.text);
      raw.issues = [issue];
      raw.patches = [{ path: issue.path, value: "Insufficient correction" }];
      return { ...response, text: JSON.stringify(raw) };
    }
    if (options!.step === "quality-recheck") {
      checks++;
      return { ...response, text: JSON.stringify({ issues: [issue] }) };
    }
    return response;
  };
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request), /recheck still has errors/);
    assert.equal(await h.storage.documents.get(h.request.id), null);
    await assert.rejects(h.manager.resume(h.request.id, h.request.id), /recheck still has errors/);
    assert.equal(checks, 1);
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.execution!.qualityReports![0].issues.length, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("old compact checkpoints retain their original review contract on resume", async () => {
  const h = await harness(true);
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request));
    await h.storage.jobs.update(h.request.id, j => {
      delete j.execution!.compactQualityVersion;
      if (j.summary.execution) delete j.summary.execution.compactQualityVersion;
      return j;
    });
    const document = await h.manager.resume(h.request.id, h.request.id);
    assert.equal(document.execution!.compactQualityVersion, undefined);
    assert.equal(document.execution!.qualityReports, undefined);
    assert.equal(document.sections.length, 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("v1 compact recovery uses its frozen quality prompt rather than upgrading the model work", async () => {
  const h = await harness(true);
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request));
    await h.storage.jobs.update(h.request.id, j => {
      j.execution!.compactQualityVersion = "compact-source-review-1";
      if (j.summary.execution)
        j.summary.execution.compactQualityVersion = "compact-source-review-1";
      return j;
    });
    const generate = h.deps.generateText!;
    let reviewed = false;
    h.deps.generateText = async (agent, prompt, signal, options) => {
      if (options?.step === "reconciliation") {
        reviewed = true;
        assert.doesNotMatch(prompt, /HOST RISK HINTS/);
      }
      return generate(agent, prompt, signal, options);
    };
    const doc = await new JobManager(h.deps, () => {}).resume(h.request.id, h.request.id);
    assert.equal(reviewed, true);
    assert.equal(doc.execution!.compactQualityVersion, "compact-source-review-1");
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("compact scenes overlap, publish ready revisions in source order, and finish a valid document", async () => {
  const h = await harness();
  try {
    const document = await h.manager.start(h.request.id, h.request);
    assert.equal(h.peak(), 2);
    assert.equal(document.sections.length, 2);
    assert.equal(document.points.length, 6);
    const group = document.execution!.pointEquivalenceGroups![0];
    assert.equal(group.length, 2);
    const later = readerScene(document, document.sections[1]);
    const shared = later.analyses.flatMap(a => a.notes).find(n => n.id === group[0]);
    assert.ok(
      shared?.sourceSpans?.every(s => s.cueId.startsWith("b-")),
      "canonical presentation retains this scene's actual source ranges",
    );
    assert.ok(
      document.points.some(p => p.id === group[1]),
      "published IDs are not deleted during reconciliation",
    );
    assert.throws(
      () =>
        validateLearningDocumentV7({
          ...document,
          execution: { ...document.execution!, pointEquivalenceGroups: [[group[0], "invented"]] },
        }),
      /equivalence/,
    );
    assert.equal(new Set(document.sections.flatMap(s => s.utterances.map(u => u.id))).size, 4);
    assert.ok(h.notices.some(n => n.readySceneIds?.length === 1 && n.status === "running"));
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.summary.status, "completed");
    assert.equal(saved!.execution!.calls.length, 5);
    assert.equal(saved!.compactPlan!.revision, 3);
    assert.equal(saved!.summary.completed, saved!.summary.total);
    assert.deepEqual((await h.storage.documents.get(h.request.id))!.sections, document.sections);
    await assert.rejects(
      h.storage.jobs.update(h.request.id, j => ({
        ...j,
        compactPlan: {
          ...j.compactPlan!,
          scenes: j.compactPlan!.scenes!.map((s, i) =>
            i ? s : { ...s, result: { ...s.result!, sourceUnits: s.result!.sourceUnits.slice(1) } },
          ),
        },
      })),
      /Compact|coverage|source/i,
    );
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("production preparation keeps the existing strategy unless compact is explicitly selected", async () => {
  const h = await harness();
  try {
    const manager = new JobManager(
      { ...h.deps, generationStrategy: undefined, compactAutomaticReasoning: "low" },
      () => {},
    );
    const job = await manager.prepare(h.request.id, h.request);
    assert.equal(job.compactPlan, undefined);
    assert.equal(job.execution!.generationStrategyVersion, undefined);
    assert.equal(job.execution!.compactReasoningPolicy, undefined);
    assert.equal(job.summary.readySceneIds, undefined);
    assert.deepEqual(job.execution!.calls, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("resume recovers a fully validated earlier response when the paid repair is malformed", async () => {
  const h = await harness();
  const generate = h.deps.generateText!;
  const outputs = new Map<string, string>();
  h.deps.generateText = async (agent, prompt, signal, options) => {
    const response = await generate(agent, prompt, signal, options);
    if (options!.step!.startsWith("scene-")) {
      outputs.set(options!.step!, response.text);
      throw new Error("Injected transport failure after capture");
    }
    return response;
  };
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request), /Injected transport failure/);
    await h.storage.jobs.update(h.request.id, job => {
      for (const scene of job.compactPlan!.scenes!) {
        const text = outputs.get("scene-" + scene.source.id)!;
        assert.ok(text.includes('"targetLineIndex":'));
        scene.pendingText = '{"pointIds":[] factory}';
        scene.repairAttempted = true;
        scene.previousOutputs = [
          {
            text: text.replaceAll('"targetLineIndex":', '"targetLineIndex:'),
            issue: "Pi returned invalid lesson JSON",
          },
        ];
      }
      return job;
    });
    let newSceneCalls = 0;
    h.deps.generateText = async (agent, prompt, signal, options) => {
      if (options!.step!.startsWith("scene-")) {
        newSceneCalls++;
        throw new Error("Do not repeat paid scene work");
      }
      return generate(agent, prompt, signal, options);
    };
    const recoverable = (await h.storage.jobs.get(h.request.id))!.compactPlan!;
    await h.storage.jobs.update(h.request.id, job => {
      for (const scene of job.compactPlan!.scenes!) {
        const invalid = parseCompactJson(scene.previousOutputs![0].text).value as {
          sourceUnits: { sourceSpans: { cueId: string }[] }[];
        };
        invalid.sourceUnits[0].sourceSpans[0].cueId = "not-in-source";
        scene.previousOutputs![0].text = JSON.stringify(invalid);
      }
      return job;
    });
    await assert.rejects(
      h.manager.resume(h.request.id, h.request.id),
      /bounded validation recovery/,
    );
    assert.equal(newSceneCalls, 0, "Invalid source must stay rejected without a paid replay");
    await h.storage.jobs.update(h.request.id, job => ({ ...job, compactPlan: recoverable }));
    const document = await h.manager.resume(h.request.id, h.request.id);
    assert.equal(document.sections.length, 2);
    assert.equal(newSceneCalls, 0);
    const saved = await h.storage.jobs.get(h.request.id);
    for (const scene of saved!.compactPlan!.scenes!) {
      assert.ok(scene.result);
      assert.equal(scene.recoveredPreviousOutput, true);
      assert.deepEqual(scene.jsonNormalization, ["target_line_index_key_quote"]);
      assert.equal(scene.previousOutputs!.at(-1)!.text, '{"pointIds":[] factory}');
    }
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("a malformed content repair gets one bounded JSON repair before the checkpoint fails", async () => {
  const h = await harness();
  const generate = h.deps.generateText!;
  const attempts = new Map<string, number>();
  h.deps.generateText = async (agent, prompt, signal, options) => {
    const response = await generate(agent, prompt, signal, options);
    if (!options!.step!.startsWith("scene-")) return response;
    const key = options!.step!.replace(/-repair$/, "");
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    if (attempt === 1) {
      const raw = JSON.parse(response.text);
      raw.reusableItems[0].sourceForms[0].text = "not the cited source";
      return { ...response, text: JSON.stringify(raw) };
    }
    if (attempt === 2) return { ...response, text: response.text.replace(/}$/, " Siem}") };
    assert.match(prompt, /invalid lesson JSON/);
    assert.match(prompt, /Siem/);
    return response;
  };
  try {
    const document = await h.manager.start(h.request.id, h.request);
    assert.equal(document.sections.length, 2);
    assert.deepEqual([...attempts.values()], [3, 3]);
    const saved = await h.storage.jobs.get(h.request.id);
    for (const scene of saved!.compactPlan!.scenes!) {
      assert.equal(scene.jsonRepairAttempted, true);
      assert.equal(scene.previousOutputs!.length, 2);
      assert.match(scene.previousOutputs![0].issue, /invalid_source_reference/);
      assert.match(scene.previousOutputs![1].text, /Siem/);
    }
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
for (const finalFailure of ["syntax", "source"] as const) {
  test(`a failed extra JSON repair stays bounded across restart (${finalFailure})`, async () => {
    const h = await harness();
    const generate = h.deps.generateText!;
    const attempts = new Map<string, number>();
    h.deps.generateText = async (agent, prompt, signal, options) => {
      const response = await generate(agent, prompt, signal, options);
      if (!options!.step!.startsWith("scene-")) return response;
      const key = options!.step!.replace(/-repair$/, "");
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      if (attempt === 1 || (attempt === 3 && finalFailure === "source")) {
        const raw = JSON.parse(response.text);
        raw.reusableItems[0].sourceForms[0].text = "not the cited source";
        return { ...response, text: JSON.stringify(raw) };
      }
      return { ...response, text: response.text.replace(/}$/, " Siem}") };
    };
    try {
      await assert.rejects(h.manager.start(h.request.id, h.request), /bounded validation recovery/);
      assert.deepEqual([...attempts.values()], [3, 3]);
      const saved = await h.storage.jobs.get(h.request.id);
      assert.ok(saved!.compactPlan!.scenes!.every(s => s.jsonRepairAttempted));
      assert.equal(saved!.summary.readySceneIds?.length ?? 0, 0);
      const calls = saved!.execution!.calls.length;
      h.deps.generateText = async () => {
        throw new Error("No new calls after the persisted budget");
      };
      await assert.rejects(
        new JobManager(h.deps, () => {}).resume(h.request.id, h.request.id),
        /bounded validation recovery/,
      );
      assert.equal((await h.storage.jobs.get(h.request.id))!.execution!.calls.length, calls);
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  });
}
test("runtime rollout selects only the live-accepted automatic model recipe", async () => {
  const h = await harness();
  try {
    const manager = new JobManager(
      {
        ...h.deps,
        ...acceptedGenerationPolicy,
        resolveModel: async agent => ({
          ...(await h.deps.resolveModel!(agent)),
          agent: { ...agent, thinkingLevel: agent.thinkingLevel ?? "medium" },
        }),
      },
      () => {},
    );
    for (const agent of [
      { provider: "antigravity", modelId: "gemini-3.8-flash" },
      { provider: "antigravity", modelId: "another-model" },
      { provider: "openai", modelId: "gemini-3.8-flash" },
      { provider: "antigravity", modelId: "gemini-3.8-flash", thinkingLevel: "high" as const },
      { provider: "antigravity", modelId: "gemini-3.8-flash", thinkingLevel: "low" as const },
    ]) {
      const job = await manager.prepare(h.request.id, {
        ...h.request,
        id: crypto.randomUUID(),
        agent,
      });
      const selected =
        agent.provider === "antigravity" &&
        agent.modelId === "gemini-3.8-flash" &&
        agent.thinkingLevel === undefined;
      assert.equal(!!job.compactPlan, selected);
      assert.equal(
        job.execution!.compactQualityVersion,
        selected ? "compact-source-review-2" : undefined,
      );
      assert.deepEqual(
        job.execution!.compactReasoningPolicy,
        selected
          ? {
              version: "light-selection-1",
              candidate: "low",
              selection: "low",
            }
          : undefined,
      );
      assert.equal(job.execution!.effectiveThinkingLevel, agent.thinkingLevel ?? "medium");
    }
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("automatic light stages are frozen across restart; teaching retains medium", async () => {
  const h = await harness(true);
  try {
    const resolveModel: NonNullable<PipelineDependencies["resolveModel"]> = async agent => {
      const resolved = await h.deps.resolveModel!(agent);
      return { ...resolved, agent: { ...agent, thinkingLevel: agent.thinkingLevel ?? "medium" } };
    };
    const manager = new JobManager(
      { ...h.deps, resolveModel, compactAutomaticReasoning: "low" },
      () => {},
    );
    await assert.rejects(manager.start(h.request.id, h.request), /Injected transport failure/);
    const checkpoint = await h.storage.jobs.get(h.request.id);
    assert.equal(checkpoint!.request.agent.thinkingLevel, undefined);
    assert.equal(checkpoint!.execution!.effectiveThinkingLevel, "medium");
    assert.deepEqual(checkpoint!.execution!.compactReasoningPolicy, {
      version: "light-candidates-1",
      candidate: "low",
      selection: "medium",
    });
    // A fresh manager without the experimental setting must still obey the saved policy.
    const resumed = new JobManager({ ...h.deps, resolveModel }, () => {});
    const doc = await resumed.resume(h.request.id, h.request.id);
    const calls = doc.execution!.calls;
    for (const call of calls) {
      const light = call.step.startsWith("window-");
      assert.equal(call.effectiveThinkingLevel, light ? "low" : "medium", call.step);
      assert.equal(call.outputTokenBudget, light ? 8192 : 16384, call.step);
    }
    assert.equal(h.scenes.filter(s => s === "a").length, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("light-stage opt in never lowers an explicit reasoning choice", async () => {
  const h = await harness();
  try {
    const explicit = {
      ...h.request,
      agent: { ...h.request.agent, thinkingLevel: "high" as const },
    };
    const manager = new JobManager(
      {
        ...h.deps,
        compactAutomaticReasoning: "low",
        compactAutomaticSelectionReasoning: "low",
        resolveModel: async agent => ({
          ...(await h.deps.resolveModel!(agent)),
          agent: { ...agent, thinkingLevel: agent.thinkingLevel ?? "medium" },
        }),
      },
      () => {},
    );
    const job = await manager.prepare(explicit.id, explicit);
    assert.equal(job.execution!.effectiveThinkingLevel, "high");
    assert.equal(job.execution!.compactReasoningPolicy, undefined);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("automatic low selection is frozen separately while teaching and review retain medium", async () => {
  const h = await harness(true);
  try {
    const resolveModel: NonNullable<PipelineDependencies["resolveModel"]> = async agent => ({
      ...(await h.deps.resolveModel!(agent)),
      agent: { ...agent, thinkingLevel: agent.thinkingLevel ?? "medium" },
    });
    const manager = new JobManager(
      {
        ...h.deps,
        resolveModel,
        compactAutomaticReasoning: "low",
        compactAutomaticSelectionReasoning: "low",
      },
      () => {},
    );
    await assert.rejects(manager.start(h.request.id, h.request), /Injected transport failure/);
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.execution!.compactReasoningPolicy!.selection, "low");
    assert.equal(saved!.execution!.effectiveThinkingLevel, "medium");
    const restarted = new JobManager({ ...h.deps, resolveModel }, () => {});
    const document = await restarted.resume(h.request.id, h.request.id);
    for (const call of document.execution!.calls) {
      const light = call.step.startsWith("window-") || call.step.startsWith("selection");
      assert.equal(call.effectiveThinkingLevel, light ? "low" : "medium", call.step);
      assert.equal(call.outputTokenBudget, light ? 8192 : 16384, call.step);
    }
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("cancellation retains completed scenes and received output, with no paid replay on resume", async () => {
  const h = await harness(),
    controller = new AbortController();
  try {
    h.setObserver(summary => {
      if (summary.readySceneIds?.length === 1) controller.abort();
    });
    await assert.rejects(h.manager.start(h.request.id, h.request, controller.signal));
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.summary.status, "waiting");
    assert.equal(saved!.compactPlan!.scenes!.filter(s => s.result).length, 1);
    assert.ok(saved!.compactPlan!.scenes!.find(s => !s.result)!.pendingText);
    h.setObserver(() => {});
    const doc = await h.manager.resume(h.request.id, h.request.id);
    assert.equal(doc.sections.length, 2);
    assert.deepEqual(h.scenes.sort(), ["a", "b"]);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
test("a failed parallel scene preserves the completed scene and resumes only unfinished work", async () => {
  const h = await harness(true);
  try {
    await assert.rejects(h.manager.start(h.request.id, h.request), /Injected transport failure/);
    const saved = await h.storage.jobs.get(h.request.id);
    assert.equal(saved!.summary.status, "failed");
    assert.equal(saved!.summary.readySceneIds!.length, 1);
    const preview = compactDocument(
      saved!.request,
      saved!.execution,
      saved!.summary.createdAt,
      saved!.compactPlan!,
    );
    assert.equal(preview!.sections.length, 1);
    const messages: import("@contextual/core").HostMessage[] = [];
    await handleLessonRequest(
      { id: crypto.randomUUID(), type: "getJobPreview", jobId: h.request.id },
      { storage: h.storage, manager: h.manager, reply: m => messages.push(m) },
      (id, document) => messages.push({ id, type: "result", document }),
    );
    assert.equal(messages[0].type, "job");
    assert.equal(messages[1].type, "result");
    const doc = await h.manager.resume(h.request.id, h.request.id);
    assert.equal(doc.sections.length, 2);
    assert.equal(h.scenes.filter(s => s === "a").length, 1);
    assert.equal(h.scenes.filter(s => s === "b").length, 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
