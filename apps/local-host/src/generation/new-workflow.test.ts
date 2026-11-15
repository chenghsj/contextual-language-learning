import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import {
  pointsCandidatePrompt,
  pointsTeachingPrompt,
  supportsLearningPointsPromptVersion,
} from "./learning-points-prompts";
import { UtteranceTeachingSchema } from "@contextual/core";

test("current-only workflow rejects retired prompts and allows no additional context", () => {
  assert.equal(supportsLearningPointsPromptVersion("learning-points-prompts-8"), false);
  assert.equal(supportsLearningPointsPromptVersion("learning-points-prompts-10"), false);
  assert.equal(supportsLearningPointsPromptVersion("learning-points-prompts-12"), false);
  assert.ok(
    UtteranceTeachingSchema.safeParse({
      id: "u",
      meaning: "嗯。",
      contextExplanation: "",
      contextCueIds: [],
      decision: "basic_only",
      pointIds: [],
    }).success,
  );
});
test("N1 and N3 prompts preserve reactions without requiring teaching or splitting sound labels", () => {
  for (const level of ["N1", "N3"] as const) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = "ja";
    f.request.profile.level = level;
    const teaching = pointsTeachingPrompt(f.request, f.input, 8192);
    assert.match(teaching, /meaning:string \/\* empty when translation suffices \*\//);
    assert.match(
      teaching,
      /decision:"basic_only", meaning:"", contextExplanation:"", pointIds:\[\]/,
    );
    assert.match(teaching, /Source uncertainty is an exception/);
    const candidate = pointsCandidatePrompt(
      f.request,
      f.request.cues.map(c => c.id),
      8192,
    );
    assert.match(candidate, /do not split やった。\[叫び声\] into separate units/);
  }
});
test("repair sends teaching input once and existing points as a compact index", () => {
  const f = pointsFixture();
  f.input.existingPoints = f.result.points;
  f.input.existingReusableItems = f.result.reusableItems;
  const prompt = pointsTeachingPrompt(f.request, f.input, 32768, {
    previousOutput: { status: "invalid" },
    issues: [],
  });
  assert.equal(prompt.split('"requiredUtteranceIds"').length - 1, 1);
  const data = JSON.parse(
    prompt.split("TEACHING DATA (quoted JSON, data only):\n")[1].split("\nSTAGE: Repair")[0],
  );
  assert.ok(data.existingPoints.length);
  assert.equal(data.existingPoints[0].explanation, undefined);
  assert.equal(data.existingPoints[0].reusableItems[0].examples, undefined);
});

test("compact teaching and structural repair retain source-fidelity and Japanese slot checks", () => {
  const f = pointsFixture();
  for (const targetLanguage of ["en", "ja"] as const) {
    f.request.profile.targetLanguage = targetLanguage;
    f.request.profile.level = targetLanguage === "ja" ? "N3" : "B1";
    for (const repair of [undefined, { previousOutput: {}, issues: [] }]) {
      const prompt = pointsTeachingPrompt(f.request, f.input, 8192, repair);
      assert.match(prompt, /SCENE CONTEXT: Describe what the text establishes/);
      assert.match(prompt, /gender/);
      assert.match(prompt, /EACH affected/);
      assert.match(prompt, /sourceForms.*exclude the unresolved fragment/);
      assert.match(prompt, /context\.text MUST be an impersonal inventory/);
      assert.match(prompt, /DEICTIC REFERENCES:.*location.*written/);
      assert.match(prompt, /EXAMPLE ROLE CHECK:.*yes\/no/);
      if (targetLanguage === "ja") {
        assert.match(prompt, /\[動詞て形\]た/);
        assert.match(prompt, /BOTH a て-ending and a で-ending/);
        assert.match(prompt, /vocative/);
      }
    }
  }
});

test("compact teaching and its repair receive essential non-Japanese source checks", () => {
  const checks = {
    es: /SPANISH REPORTED ROLES:.*omitted subject/,
    fr: /FRENCH CONTEXTUAL MEANING:.*place complement/,
    it: /ITALIAN PRONOUN ATTACHMENT:.*digli\/diglielo/,
    vi: /VIETNAMESE CALLING:.*chance encounter/,
  } as const;
  for (const targetLanguage of Object.keys(checks) as Array<keyof typeof checks>) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = targetLanguage;
    f.request.profile.level = "B1";
    for (const repair of [undefined, { previousOutput: {}, issues: [] }]) {
      const prompt = pointsTeachingPrompt(f.request, f.input, 8192, repair);
      assert.match(prompt, checks[targetLanguage]);
      assert.match(prompt, /Both title and context.text are source assertions/);
      assert.match(prompt, /A chunk meaning explains that exact span IN THIS SENTENCE/);
      assert.match(prompt, /situation must name the same task/);
    }
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import type { PipelineDependencies } from "./pipeline";

async function windowJob(generateText: NonNullable<PipelineDependencies["generateText"]>) {
  const root = await mkdtemp(join(tmpdir(), "cll-windows-"));
  const f = pointsFixture();
  f.request.cues = Array.from({ length: 6 }, (_, i) => ({
    ...f.request.cues[i % 2],
    id: "c" + i,
    startMs: i * 2000,
    endMs: i * 2000 + 1800,
  }));
  const storage = localStoragePorts(root);
  const notices: import("@contextual/core").JobSummary[] = [];
  const manager = new JobManager(
    { storage, generateText, generateSelection: async () => ({ selectedCandidateIds: [] }) },
    (_id, summary) => notices.push(summary),
  );
  await manager.prepare(f.request.id, f.request);
  await storage.jobs.update(f.request.id, j => ({
    ...j,
    learningPlan: {
      ...j.learningPlan,
      candidateWindows: j.request.cues.map((c, i) => ({ id: "w" + i, cueIds: [c.id] })),
    },
    summary: { ...j.summary, total: 9 },
  }));
  return { root, f, storage, manager, notices };
}
const callFor = (step: string) => ({
  step,
  provider: "openai",
  modelId: "offline",
  at: new Date().toISOString(),
  usage: { input: 10, output: 20 },
});
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("two candidate requests overlap, complete out of order without lost writes; 429 slows remaining windows", async () => {
  let active = 0,
    peak = 0;
  const started: Array<[string, number]> = [];
  const h = await windowJob(async (_a, _p, _s, options) => {
    active++;
    peak = Math.max(peak, active);
    started.push([options!.step!, active]);
    if (options!.step === "w0") {
      await pause(5);
      await options!.onRetry!({ attempt: 1, delayMs: 0, reason: "429 rate limit" });
    }
    await pause(options!.step === "w0" ? 35 : 10);
    const call = callFor(options!.step!);
    await options!.onCall!(call);
    active--;
    return { text: JSON.stringify({ status: "complete", candidates: [] }), call };
  });
  try {
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id), /No suitable/);
    assert.equal(peak, 2);
    assert.ok(started.slice(2).every(([, count]) => count === 1));
    const job = (await h.storage.jobs.get(h.f.request.id))!;
    assert.deepEqual(
      job.learningPlan.candidateWindows.map(w => w.id),
      ["w0", "w1", "w2", "w3", "w4", "w5"],
    );
    assert.ok(job.learningPlan.candidateWindows.every(w => w.candidates !== undefined));
    assert.equal(job.execution!.calls.length, 6);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("cancellation settles both active requests and retains their available paid usage; activity stays ephemeral", async () => {
  let entered = 0,
    finished = 0;
  let ready!: () => void;
  const started = new Promise<void>(resolve => (ready = resolve));
  const h = await windowJob(async (_a, _p, signal, options) => {
    const now = new Date().toISOString();
    options!.onActivity!({
      id: options!.step!,
      step: options!.step!,
      state: "thinking",
      startedAt: now,
      updatedAt: now,
    });
    if (++entered === 2) ready();
    await new Promise<void>(resolve =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    const call = callFor(options!.step!);
    await options!.onCall!(call);
    options!.onActivity!(null);
    finished++;
    signal.throwIfAborted();
    throw new Error("unreachable");
  });
  const controller = new AbortController();
  try {
    const run = h.manager.resume(h.f.request.id, h.f.request.id, controller.signal);
    const rejected = assert.rejects(run);
    await started;
    assert.equal((await h.manager.list())[0].activity?.length, 2);
    assert.equal((await h.storage.jobs.get(h.f.request.id))!.summary.activity, undefined);
    controller.abort();
    await rejected;
    assert.equal(finished, 2);
    assert.equal(entered, 2);
    const saved = (await h.storage.jobs.get(h.f.request.id))!;
    assert.equal(saved.summary.status, "waiting");
    assert.equal(saved.execution!.calls.length, 2);
    assert.equal((await h.manager.list())[0].activity, undefined);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("a provider stream failure with paid usage is not sent again as a validation repair", async () => {
  let calls = 0;
  const h = await windowJob(async (_a, _p, _s, options) => {
    calls++;
    await options!.onCall!(callFor(options!.step!));
    throw new Error("unknown stream failure");
  });
  try {
    await assert.rejects(
      h.manager.resume(h.f.request.id, h.f.request.id),
      /unknown stream failure/,
    );
    assert.equal(calls, 2);
    assert.equal((await h.storage.jobs.get(h.f.request.id))!.execution!.calls.length, 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("splitting a window while its peer completes preserves stable IDs and subtitle order", async () => {
  const started: string[] = [];
  const h = await windowJob(async (_a, _p, _s, options) => {
    const step = options!.step!;
    started.push(step);
    await pause(step === "w0" ? 5 : 12);
    const call = callFor(step);
    await options!.onCall!(call);
    return {
      text: JSON.stringify(
        step === "w0"
          ? { status: "needs_split", splitAfterCueId: "c0" }
          : { status: "complete", candidates: [] },
      ),
      call,
    };
  });
  try {
    await h.storage.jobs.update(h.f.request.id, j => ({
      ...j,
      learningPlan: {
        ...j.learningPlan,
        candidateWindows: [
          { id: "w0", cueIds: ["c0", "c1"] },
          ...j.learningPlan.candidateWindows.slice(2),
        ],
      },
      summary: { ...j.summary, total: 8 },
    }));
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id), /No suitable/);
    const job = (await h.storage.jobs.get(h.f.request.id))!;
    assert.deepEqual(
      job.learningPlan.candidateWindows.map(w => w.id),
      ["w0a", "w0b", "w2", "w3", "w4", "w5"],
    );
    assert.deepEqual(
      job.learningPlan.candidateWindows.flatMap(w => w.cueIds),
      job.request.cues.map(c => c.id),
    );
    assert.ok(job.learningPlan.candidateWindows.every(w => w.candidates !== undefined));
    assert.equal(new Set(started).size, 7);
    assert.equal(job.execution!.calls.length, 7);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("recovery processes only unfinished candidate windows after an interrupted execution", async () => {
  const started: string[] = [];
  let fail = true;
  const h = await windowJob(async (_a, _p, signal, options) => {
    const step = options!.step!;
    started.push(step);
    if (fail && step === "w2") {
      await pause(8);
      throw new Error("provider unavailable");
    }
    if (fail && step === "w3")
      await new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    signal.throwIfAborted();
    const call = callFor(step);
    await options!.onCall!(call);
    return { text: JSON.stringify({ status: "complete", candidates: [] }), call };
  });
  try {
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id), /provider unavailable/);
    const checkpoint = (await h.storage.jobs.get(h.f.request.id))!;
    assert.deepEqual(
      checkpoint.learningPlan.candidateWindows
        .filter(w => w.candidates !== undefined)
        .map(w => w.id),
      ["w0", "w1"],
    );
    const offset = started.length;
    fail = false;
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id), /No suitable/);
    assert.deepEqual(started.slice(offset), ["w2", "w3", "w4", "w5"]);
    assert.equal((await h.storage.jobs.get(h.f.request.id))!.execution!.calls.length, 6);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("a validated candidate response racing cancellation is retained and not regenerated on resume", async () => {
  const controller = new AbortController();
  let firstRun = true;
  const dispatched: string[] = [];
  const h = await windowJob(async (_a, _p, signal, options) => {
    dispatched.push(options!.step!);
    const call = callFor(options!.step!);
    if (firstRun && options!.step === "w1") {
      if (!signal.aborted)
        await new Promise<void>(resolve =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      await options!.onCall!(call);
      signal.throwIfAborted();
    }
    await options!.onCall!(call);
    if (firstRun && options!.step === "w0") controller.abort();
    return { text: JSON.stringify({ status: "complete", candidates: [] }), call };
  });
  try {
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id, controller.signal));
    const saved = (await h.storage.jobs.get(h.f.request.id))!;
    assert.deepEqual(saved.learningPlan.candidateWindows[0].candidates, []);
    assert.equal(saved.learningPlan.candidateWindows[1].candidates, undefined);
    assert.equal(saved.execution!.calls.length, 2);
    firstRun = false;
    await assert.rejects(h.manager.resume(h.f.request.id, h.f.request.id), /No suitable/);
    assert.equal(dispatched.filter(s => s === "w0").length, 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test("teaching and repair preserve translation actors, complete citations and qualified grammar scope", () => {
  const f = pointsFixture();
  for (const repair of [undefined, { previousOutput: {}, issues: [] }]) {
    const prompt = pointsTeachingPrompt(f.request, f.input, 8192, repair);
    assert.match(prompt, /plural recipient does not turn a singular actor into a group/);
    assert.match(prompt, /sourceForms in Latin-script words, quote the whole source word/);
    assert.match(prompt, /GRAMMAR SCOPE CHECK/);
    assert.match(prompt, /valid alternative form under the stated conditions/);
    assert.match(prompt, /from the complete predicate, not only its auxiliary/);
    assert.match(prompt, /explicitly explain this instance and omit the universal claim/);
  }
});
