import { SYSTEM } from "./learning-points-rules";
import { calculateCost } from "@earendil-works/pi-ai";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  chunkCues,
  type GenerationRequest,
  type CustomGenerationRequest,
  GenerationInputEstimateSchema,
} from "@contextual/core";
import { lessonResources, resolvePiModel } from "../agents/pi";
import { pointsCandidatePrompt, initialLearningPointsBudget } from "./learning-points-prompts";
import { customNodePrompt, planCustomJob } from "./custom-pipeline";

/** No inference or job creation: estimate known input without predicting model output. */
export async function estimateGenerationInput(
  request: GenerationRequest | CustomGenerationRequest,
  runtime?: ModelRuntime,
) {
  const resolved = await resolvePiModel(request.agent, runtime);
  const custom = "kind" in request;
  const prompts = custom
    ? (() => {
        const plan = planCustomJob(request, resolved);
        return plan.nodes
          .filter(node => node.kind === "segment")
          .map(node => customNodePrompt(plan, node));
      })()
    : (() => {
        const chunks = chunkCues(request.cues);
        return chunks.map((cues, index) =>
          pointsCandidatePrompt(
            request,
            cues.map(c => c.id),
            initialLearningPointsBudget(resolved, request.agent.thinkingLevel).output,
          ),
        );
      })();
  const systemTokens = estimateTextTokens(
    lessonResources(
      custom ? "markdown" : "json",
      !custom && request.outputSchemaVersion === 7 ? SYSTEM : undefined,
    ).getSystemPrompt()!,
  );
  const tokenCounts = prompts.map(prompt => systemTokens + estimateTextTokens(prompt));
  const priced =
    resolved.billing === "api" &&
    Number.isFinite(resolved.model.cost.input) &&
    resolved.model.cost.input > 0;
  const inputCostUsd = priced
    ? tokenCounts.reduce(
        (total, input) =>
          total +
          calculateCost(resolved.model, {
            input,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: input,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }).total,
        0,
      )
    : undefined;
  return GenerationInputEstimateSchema.parse({
    provider: resolved.agent.provider,
    modelId: resolved.agent.modelId,
    inputTokens: tokenCounts.reduce((sum, count) => sum + count, 0),
    inputCalls: prompts.length,
    billing: resolved.billing,
    ...(inputCostUsd === undefined ? {} : { inputCostUsd }),
  });
}
