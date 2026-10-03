import React from "react";
import type { ExecutionMetadata } from "@immersive/core";
import { customContentCopy } from "../i18n/custom-content";
import type { UiLocale } from "../i18n/messages";
export function ExecutionDetails({
  execution,
  locale,
}: {
  execution: ExecutionMetadata | null;
  locale: UiLocale;
}) {
  const ui = customContentCopy(locale);
  if (!execution) return <p className="text-xs text-muted-foreground">{ui.unknown}</p>;
  return (
    <div className="grid min-w-0 gap-3 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        {Object.entries({
          Provider: execution.provider,
          Model: execution.modelId,
          Workflow: execution.workflowVersion,
          Prompt: execution.promptVersion,
          Schema: execution.schemaVersion,
          SHA256: execution.inputFingerprint,
        }).map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-anywhere">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="text-muted-foreground">{ui.costHint}</p>
      {execution.calls.map((call, index) => (
        <div key={index} className="grid gap-1 border-t border-border pt-2">
          <strong>
            {call.step} · {call.provider} / {call.modelId}
          </strong>
          <p>
            {["input", "output", "cacheRead", "cacheWrite"]
              .map(
                key =>
                  `${key}: ${call.usage?.[key as keyof NonNullable<typeof call.usage>] ?? ui.unknown}`,
              )
              .join(" · ")}
          </p>
          <p>
            USD:{" "}
            {call.estimatedCostUsd === undefined ? ui.unknown : call.estimatedCostUsd.toFixed(6)}
          </p>
        </div>
      ))}
    </div>
  );
}
