import type { CustomGenerationRequest } from "@immersive/core";
import { createHash } from "node:crypto";
import { sourceKey, transcriptKey } from "./duplicates";
/** Separate duplicate identity from the legacy immutable checkpoint fingerprint. */
export function customDuplicateKey(request: CustomGenerationRequest) {
  const input = {
    pipeline: "custom-markdown-1",
    source: sourceKey(request.source, request.cues),
    title: request.context.title ? request.source.title : undefined,
    transcript: request.context.subtitles ? transcriptKey(request.cues) : undefined,
    range: request.analysisRange && {
      startMs: request.analysisRange.startMs,
      endMs: request.analysisRange.endMs,
    },
    agent: request.agent,
    prompt: request.prompt.replace(/\r\n/g, "\n"),
    context: request.context,
  };
  const stable = JSON.stringify(input, (_, value) =>
    value && !Array.isArray(value) && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, value[key]]),
        )
      : value,
  );
  return createHash("sha256").update(stable).digest("hex");
}
