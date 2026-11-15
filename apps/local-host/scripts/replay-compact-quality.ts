/** Offline integration replay. No provider resolution or live generation is permitted. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { fauxProvider } from "@earendil-works/pi-ai";
import {
  compactProgress,
  COMPACT_QUALITY_STRATEGY_VERSION,
  type JobSnapshotV5,
} from "@contextual/core";
import { JobManager } from "../src/jobs/manager";
import { localStoragePorts } from "../src/storage/file";

const option = (key: string) =>
  process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const jobPath = option("job"),
  repairPath = option("repair"),
  destination = option("output");
if (!jobPath || !repairPath || !destination) throw new Error("Required --job, --repair, --output");
const saved: JobSnapshotV5 = JSON.parse(await readFile(resolve(jobPath), "utf8"));
if (!saved.compactPlan?.scenes?.every(s => s.result))
  throw new Error("Need a completed compact draft");
const repaired = JSON.parse(await readFile(join(resolve(repairPath), "document.json"), "utf8"));
const proof = JSON.parse(await readFile(join(resolve(repairPath), "report.json"), "utf8"));
const patches = (proof.patches as { path: string; value: string }[]).map(patch => {
  const parts = patch.path.split("/");
  if (parts[1] === "sections")
    return { ...patch, path: `/scenes/${parts[2]}/section/${parts.slice(3).join("/")}` };
  if (parts[1] === "points") {
    const pointId = repaired.points[Number(parts[2])].id;
    const sceneIndex = saved.compactPlan!.scenes!.findIndex(s =>
      s.result!.points.some(p => p.id === pointId),
    );
    const pointIndex = saved.compactPlan!.scenes![sceneIndex].result!.points.findIndex(
      p => p.id === pointId,
    );
    return {
      ...patch,
      path: `/scenes/${sceneIndex}/points/${pointIndex}/${parts.slice(3).join("/")}`,
    };
  }
  throw new Error("Unsupported saved review path");
});
// The envelope and final recheck are canned test responses, not a new model quality verdict.
const review = {
  pointGroups: [],
  itemGroups: [],
  patches,
  issues: patches.map(p => {
    const scene = saved.compactPlan!.scenes![Number(p.path.split("/")[2])].source;
    return {
      severity: "error",
      type: "unsupported_inference",
      path: p.path,
      sourceSpans: scene.dialogueCueIds.map(cueId => ({
        cueId,
        start: 0,
        end: saved.request.cues.find(c => c.id === cueId)!.originalText.length,
      })),
      description: "Previously reviewed source mistranslation; replaying the saved correction.",
    };
  }),
};
const output = resolve(destination);
await mkdir(output, { recursive: false });
const storage = localStoragePorts(join(output, "isolated-library"));
saved.execution!.compactQualityVersion = COMPACT_QUALITY_STRATEGY_VERSION;
saved.compactPlan.reconciliation = { pendingText: JSON.stringify(review) };
saved.summary = {
  ...saved.summary,
  status: "waiting",
  documentId: undefined,
  ownerPid: undefined,
  execution: saved.execution,
  ...compactProgress(saved.compactPlan, saved.request.profile.sceneCount),
};
await storage.jobs.create(saved);
let cannedRechecks = 0;
const model = fauxProvider({
  provider: saved.execution!.provider,
  models: [
    {
      id: saved.execution!.modelId,
      contextWindow: saved.execution!.contextWindow,
      maxTokens: saved.execution!.maxOutputTokens,
    },
  ],
}).provider.getModels()[0];
const manager = new JobManager(
  {
    storage,
    resolveModel: async agent => ({
      agent: { ...agent, thinkingLevel: saved.execution!.effectiveThinkingLevel! },
      modelId: model.id,
      model,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      billing: "subscription",
    }),
    generateText: async (_agent, _prompt, _signal, options) => {
      if (options?.step !== "quality-recheck")
        throw new Error("Unexpected generation in offline replay");
      cannedRechecks++;
      return {
        text: '{"issues":[]}',
        call: {
          step: "offline-canned-recheck",
          provider: "offline-replay",
          modelId: "canned-response",
          at: new Date().toISOString(),
        },
      };
    },
  },
  () => {},
);
const document = await manager.resume(saved.request.id, saved.summary.id);
assert.deepEqual(document.cues, repaired.cues);
assert.deepEqual(document.sections, repaired.sections);
assert.deepEqual(document.points, repaired.points);
assert.deepEqual(document.reusableItems, repaired.reusableItems);
assert.equal(document.execution!.calls.length, saved.execution!.calls.length);
const final = await storage.jobs.get(saved.summary.id);
assert.equal(final!.compactPlan!.reconciliation!.qualityAccepted, true);
const report = {
  offline: true,
  structural: "passed",
  savedCorrectionsApplied: patches.length,
  newModelCalls: 0,
  cannedRechecks,
  modelSemanticDetectionTested: false,
  qualityReports: document.execution!.qualityReports?.length,
  sourceIdsSpansExamplesAnnotationsPreserved: true,
  originalJobAndLibraryModified: false,
  boundary:
    "Real JobManager and pipeline with saved corrections in a synthetic review envelope and a canned recheck. Tests integration, immutable content and commit gating; not live semantic detection or latency.",
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
