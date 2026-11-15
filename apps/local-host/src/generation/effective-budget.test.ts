import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSceneJob } from "@contextual/core";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { localStoragePorts } from "../storage/file";
import { createLearningExecution } from "./learning-execution";
import { teachBatches } from "./learning-teaching";

test("a pinned automatic medium uses the same allowance and strength at the real pipeline call seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-effective-budget-"));
  try {
    const f = pointsFixture(),
      storage = localStoragePorts(root);
    const job = createSceneJob(f.request, 1);
    job.summary.status = "running";
    job.execution = {
      ...f.document.execution!,
      modelId: "gemini-3.8-flash",
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      effectiveThinkingLevel: "medium",
      budgetStrategyVersion: "effective-reasoning-budget-1",
    };
    await storage.jobs.create(job);
    let calls = 0;
    const execution = await createLearningExecution(
      job.summary.id,
      {
        storage,
        generateText: async (agent, _prompt, _signal, options) => {
          calls++;
          assert.equal(agent.thinkingLevel, "medium");
          assert.equal(options!.maxOutputTokens, 32768);
          const call = {
            provider: agent.provider,
            modelId: agent.modelId,
            step: options!.step!,
            at: new Date().toISOString(),
            effectiveThinkingLevel: agent.thinkingLevel,
          };
          await options!.onCall!(call);
          return { text: options!.step === "s0" ? JSON.stringify(f.raw) : '{"ok":true}', call };
        },
      },
      new AbortController().signal,
      () => {},
    );
    try {
      assert.deepEqual(await execution.generate("fixed source", "window-0", "candidate"), {
        ok: true,
      });
      await execution.update(j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          candidateWindows: j.learningPlan.candidateWindows.map((w, i) => ({
            ...w,
            candidates: i === 0 ? [f.input.scene] : [],
          })),
          selected: [f.input.scene],
          batches: [
            {
              id: "s0",
              sceneId: f.input.scene.id,
              utteranceIds: f.input.requiredUtteranceIds,
              outputTokenBudget: 16384,
            },
          ],
        },
      }));
      await teachBatches(execution);
    } finally {
      execution.close();
    }
    const saved = await storage.jobs.get(job.summary.id);
    assert.equal(
      calls,
      2,
      "a saved lower batch budget must not bypass the resolved medium allowance",
    );
    assert.equal(saved!.request.agent.thinkingLevel, undefined, "original request stays unchanged");
    assert.equal(saved!.execution!.calls[0].effectiveThinkingLevel, "medium");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
