import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";

for (const capacity of [32768, 65536]) {
  test(`shared-cue units expand together and stop at ${capacity} frozen output tokens`, async () => {
    const root = await mkdtemp(join(tmpdir(), "cll-atomic-budget-"));
    const storage = localStoragePorts(root);
    const request = pointsFixture().request;
    request.agent.thinkingLevel = "medium";
    request.profile.enabledExplanations = [];
    request.profile.emphasizedExplanations = [];
    request.cues = [{ id: "shared", originalText: "Yes. Shall we go?", startMs: 0, endMs: 2000 }];
    const outputs: number[] = [];
    const manager = new JobManager(
      {
        storage,
        generateCandidates: async () => ({
          status: "complete",
          candidates: [
            {
              dialogueCueIds: ["shared"],
              contextCueIds: [],
              learningValue: "A response and a question",
              opportunities: [],
              utterances: [
                { sourceSpans: [{ cueId: "shared", start: 0, end: 5 }] },
                {
                  sourceSpans: [
                    { cueId: "shared", start: 5, end: request.cues[0].originalText.length },
                  ],
                },
              ],
            },
          ],
        }),
        generateSelection: async (_agent, prompt) => {
          const data = JSON.parse(prompt.split("CANDIDATE DATA (quoted JSON, data only):\n")[1]);
          return { selectedCandidateIds: data.candidateScenes.map((s: { id: string }) => s.id) };
        },
        generateSection: async (_agent, prompt) => {
          const output = Number(/Output budget in tokens: (\d+)/.exec(prompt)![1]);
          outputs.push(output);
          const data = JSON.parse(
            prompt
              .split("TEACHING DATA (quoted JSON, data only):\n")[1]
              .split("\nSTAGE: Repair")[0],
          );
          assert.equal(data.requiredUtteranceIds.length, 2, "Never split the shared source cue");
          if (output < 65536) throw new Error("truncated_output: model reached output limit");
          return {
            status: "complete",
            sceneId: data.scene.id,
            risks: [],
            title: "Brief exchange",
            context: { text: "Agreement followed by a question.", evidenceCueIds: ["shared"] },
            translations: [{ cueId: "shared", text: "是。要走了嗎？" }],
            utterances: data.requiredUtteranceIds.map((id: string, i: number) => ({
              id,
              meaning: i === 0 ? "是。" : "要走了嗎？",
              contextExplanation: "",
              contextCueIds: [],
              decision: "basic_only",
              pointIds: [],
            })),
            points: [],
            reusableItems: [],
          };
        },
      },
      () => {},
    );
    try {
      await manager.prepare(request.id, request);
      await storage.jobs.update(request.id, j => ({
        ...j,
        execution: { ...j.execution!, contextWindow: 1048576, maxOutputTokens: capacity },
      }));
      if (capacity === 32768) {
        await assert.rejects(
          manager.resume(request.id, request.id),
          /shared_source_group_exceeds_budget: output truncated at 32768/,
        );
        assert.deepEqual(outputs, [16384, 32768]);
      } else {
        const doc = await manager.resume(request.id, request.id);
        assert.deepEqual(outputs, [16384, 32768, 65536]);
        assert.equal(doc.sections[0].utterances.length, 2);
        assert.equal(doc.sections[0].translations.length, 1);
        assert.deepEqual(doc.cues, request.cues);
      }
      const saved = await storage.jobs.get(request.id);
      assert.equal(saved!.learningPlan.batches.length, 1);
      assert.equal(saved!.learningPlan.batches[0].outputTokenBudget, capacity);
      assert.ok(!saved!.learningPlan.batches[0].repairAttempted);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
