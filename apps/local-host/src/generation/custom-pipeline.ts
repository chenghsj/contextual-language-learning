import {
  CustomDocumentSchema,
  CustomJobSnapshotSchema,
  type AgentSettings,
  type CustomGenerationRequest,
  type CustomJobSnapshot,
  type CustomNode,
  type CustomDocument,
  type JobSummary,
} from "@immersive/core";
import { generatePiText, resolvePiModel, type PiTextResult } from "../agents/pi";
import { contentHash, type CustomRepository } from "../storage/custom";
export const CUSTOM_WORKFLOW_VERSION = "custom-markdown-1";
export const CUSTOM_PROMPT_VERSION = "custom-prompt-1";
export type ResolvedModel = {
  agent: AgentSettings;
  contextWindow: number;
  maxOutputTokens: number;
};
export type CustomDependencies = {
  repository: CustomRepository;
  resolveModel?: (agent: AgentSettings) => Promise<ResolvedModel>;
  generate?: (
    agent: AgentSettings,
    prompt: string,
    signal: AbortSignal,
    options: { maxOutputTokens: number; step: string },
  ) => Promise<PiTextResult>;
};
export function customFingerprint(request: CustomGenerationRequest): string {
  const {
    id: _id,
    previousDocumentId: _previous,
    destination: _destination,
    backup: _backup,
    ...input
  } = request;
  return contentHash(JSON.stringify(input));
}
export function customBasePrompt(request: CustomGenerationRequest): string {
  return (
    "USER TASK:\n" +
    request.prompt +
    "\n" +
    (request.context.title
      ? "SOURCE TITLE (data):\n" + JSON.stringify(request.source.title) + "\n"
      : "")
  );
}
function cueText(request: CustomGenerationRequest, ids: string[]): string {
  if (!request.context.subtitles) return "";
  const wanted = new Set(ids);
  return JSON.stringify(request.cues.filter(cue => wanted.has(cue.id)));
}
/** UTF-8 bytes conservatively bound tokens; output and framing both reserve context. */
export function planCustomJob(
  request: CustomGenerationRequest,
  model: ResolvedModel,
): CustomJobSnapshot {
  const outputTokens = Math.min(8192, model.maxOutputTokens, Math.floor(model.contextWindow / 8));
  const inputBudget = Math.floor(model.contextWindow * 0.75) - outputTokens - 2048;
  const baseBytes = Buffer.byteLength(customBasePrompt(request), "utf8") + 1024;
  const available = inputBudget - baseBytes;
  if (outputTokens < 32 || available < 2048)
    throw new Error(
      "Prompt exceeds this model's safe input budget; shorten the prompt or choose a larger context model.",
    );
  const outputByteLimit = Math.min(outputTokens * 4, Math.floor(available / 3));
  const fanIn = Math.min(32, Math.floor(available / (outputByteLimit + 256)));
  if (fanIn < 2)
    throw new Error(
      "Model context is too small for hierarchical integration; choose a larger model.",
    );
  const groups: string[][] = [];
  let group: string[] = [];
  if (request.context.subtitles) {
    for (const cue of request.cues) {
      const next = [...group, cue.id];
      if (Buffer.byteLength(cueText(request, next), "utf8") > available) {
        if (!group.length)
          throw new Error("A subtitle exceeds the safe model budget; shorten the selected input.");
        groups.push(group);
        group = [cue.id];
        if (Buffer.byteLength(cueText(request, group), "utf8") > available)
          throw new Error("A subtitle exceeds the safe model budget; shorten the selected input.");
      } else group = next;
    }
  }
  if (group.length || !groups.length) groups.push(group);
  const nodes: CustomNode[] = groups.map((cueIds, index) => ({
    id: `segment-${index}`,
    kind: "segment",
    level: 0,
    inputs: [],
    cueIds,
  }));
  let previous = nodes.map(node => node.id),
    level = 1;
  while (previous.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < previous.length; i += fanIn) {
      const id = `merge-${level}-${i / fanIn}`;
      nodes.push({ id, kind: "merge", level, inputs: previous.slice(i, i + fanIn), cueIds: [] });
      next.push(id);
    }
    previous = next;
    level++;
  }
  const now = new Date().toISOString();
  const execution = {
    workflowVersion: CUSTOM_WORKFLOW_VERSION,
    promptVersion: CUSTOM_PROMPT_VERSION,
    schemaVersion: "custom-v1",
    inputFingerprint: customFingerprint(request),
    provider: model.agent.provider,
    modelId: model.agent.modelId,
    contextWindow: model.contextWindow,
    maxOutputTokens: outputTokens,
    chunkPlan: groups,
    calls: [],
  };
  return CustomJobSnapshotSchema.parse({
    schemaVersion: "custom-v1",
    request,
    execution,
    nodes,
    inputBudget,
    outputByteLimit,
    summary: {
      id: request.id,
      kind: "custom",
      sourceTitle: request.source.title,
      provider: model.agent.provider,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      completed: 0,
      total: nodes.length,
      execution,
    },
  });
}
export function validateMarkdown(text: string, byteLimit: number): string {
  const markdown = text.trim();
  let jsonObject = false;
  try {
    const value = JSON.parse(markdown);
    jsonObject = value !== null && typeof value === "object";
  } catch {}
  if (!markdown || jsonObject || /^```(?:json|markdown|md)?\s*\n[\s\S]*\n```$/.test(markdown))
    throw new Error("Expected a Markdown document, not JSON or an enclosing code fence");
  if (Buffer.byteLength(markdown, "utf8") > byteLimit)
    throw new Error(
      "Markdown stage exceeds the frozen integration budget; retry this stage with shorter output.",
    );
  return markdown;
}
export async function runCustomPipeline(
  id: string,
  deps: CustomDependencies,
  signal: AbortSignal,
  notify: (summary: JobSummary) => void,
): Promise<CustomDocument> {
  const repository = deps.repository;
  let job = await repository.getJob(id);
  if (!job) throw new Error("Custom job not found");
  const generate =
    deps.generate ??
    ((agent, prompt, abort, options) =>
      generatePiText(agent, prompt, abort, { ...options, format: "markdown" }));
  for (const node of job.nodes) {
    if (node.output !== undefined) {
      validateMarkdown(node.output, job.outputByteLimit);
      continue;
    }
    signal.throwIfAborted();
    const inputs =
      node.kind === "segment"
        ? cueText(job.request, node.cueIds)
        : JSON.stringify(
            node.inputs.map(input => {
              const output = job!.nodes.find(item => item.id === input)?.output;
              if (!output) throw new Error("Missing integration checkpoint");
              return output;
            }),
          );
    const prompt =
      customBasePrompt(job.request) +
      `\nSTAGE: ${node.kind}, level ${node.level}. ${node.kind === "segment" && job.nodes.length > 1 ? "Create a source-grounded partial document for later integration." : "Produce a coherent complete document following the user task; integrate all supplied material without adding unsupported source facts."}\nReturn Markdown only, at most ${job.outputByteLimit} UTF-8 bytes.\nSOURCE DATA:\n` +
      inputs;
    if (Buffer.byteLength(prompt, "utf8") > job.inputBudget)
      throw new Error(
        "Checkpoint inputs exceed the pinned model budget; create a new job with shorter input.",
      );
    job = await repository.updateJob(id, current => ({
      ...current,
      summary: {
        ...current.summary,
        phase: node.kind === "merge" ? "selecting" : "creating",
        updatedAt: new Date().toISOString(),
      },
    }));
    notify(job.summary);
    const result = await generate(
      { ...job.request.agent, provider: job.execution.provider, modelId: job.execution.modelId },
      prompt,
      signal,
      { maxOutputTokens: job.execution.maxOutputTokens, step: node.id },
    );
    signal.throwIfAborted();
    job = await repository.updateJob(id, current => ({
      ...current,
      execution: { ...current.execution, calls: [...current.execution.calls, result.call] },
    }));
    if (
      result.call.provider !== job.execution.provider ||
      result.call.modelId !== job.execution.modelId
    )
      throw new Error("Actual model differs from the frozen execution model");
    const output = validateMarkdown(result.text, job.outputByteLimit);
    job = await repository.updateJob(id, current => {
      signal.throwIfAborted();
      if (current.summary.status !== "running") throw new Error("Custom job interrupted");
      return {
        ...current,
        nodes: current.nodes.map(item =>
          item.id === node.id ? { ...item, output, call: result.call } : item,
        ),
        execution: current.execution,
        summary: {
          ...current.summary,
          completed: current.summary.completed + 1,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    notify(job.summary);
  }
  signal.throwIfAborted();
  job = await repository.updateJob(id, current => ({
    ...current,
    summary: { ...current.summary, phase: "saving" },
  }));
  notify(job.summary);
  const document = CustomDocumentSchema.parse({
    schemaVersion: "custom-v1",
    kind: "custom",
    id,
    createdAt: job.summary.createdAt,
    title: job.request.source.title,
    request: job.request,
    execution: job.execution,
    markdown: job.nodes.at(-1)!.output,
    previousDocumentId: job.request.previousDocumentId,
  });
  // The final node is already checkpointed. Saving can fail without losing generated output.
  await repository.saveDocument(document);
  signal.throwIfAborted();
  job = await repository.updateJob(id, current => ({
    ...current,
    summary: {
      ...current.summary,
      status: "completed",
      phase: "saving",
      documentId: id,
      ownerPid: undefined,
      error: undefined,
      updatedAt: new Date().toISOString(),
      ...(current.request.backup?.enabled
        ? {
            backup: {
              status: "pending",
              accountId: current.request.backup.accountId!,
              updatedAt: new Date().toISOString(),
            },
          }
        : {}),
    },
  }));
  notify(job.summary);
  return document;
}
export const resolveCustomModel = (agent: AgentSettings) => resolvePiModel(agent);
