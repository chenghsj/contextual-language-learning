import { pronunciationDiagnosticLabel } from "../i18n/pronunciation-diagnostics";
import { createFlowCopy } from "../i18n/create-flow";
import React from "react";
import type { ExecutionMetadata } from "@contextual/core";
import { customContentCopy } from "../i18n/custom-content";
import type { UiLocale } from "../i18n/messages";
import { usageEstimateCopy, formatUsd } from "../i18n/usage-estimate";
export function ExecutionDetails({
  execution,
  locale,
}: {
  execution: ExecutionMetadata | null;
  locale: UiLocale;
}) {
  const ui = customContentCopy(locale);
  const usageUi = usageEstimateCopy(locale);
  if (!execution) return <p className="text-ui-body text-muted-foreground">{ui.unknown}</p>;
  return (
    <div className="grid min-w-0 gap-4 text-ui-body wrap-anywhere">
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-ui-label">
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
      {execution.pronunciationDiagnostics?.map(d => (
        <p key={d.id} className="wrap-anywhere" data-ui="pronunciationDiagnostic">
          {pronunciationDiagnosticLabel(locale, d)} · {d.cueId ?? d.itemId ?? d.batchId} · {d.path}
        </p>
      ))}
      {execution.calls.map((call, index) => (
        <div key={index} className="grid min-w-0 gap-2 border-t border-border pt-4">
          <strong className="text-ui-heading font-semibold">
            {call.step} · {call.provider} / {call.modelId}
          </strong>
          <p className="text-ui-label leading-relaxed">
            {(["input", "output", "cacheRead", "cacheWrite"] as const)
              .map(
                key =>
                  `${usageUi[`${key}Usage`]}: ${call.usage?.[key]?.toLocaleString(locale) ?? ui.unknown}`,
              )
              .join(" · ")}
          </p>
          {call.usage?.reasoning !== undefined && (
            <p className="text-ui-label leading-relaxed">
              {usageUi.reasoningUsage}: {call.usage.reasoning.toLocaleString(locale)}
            </p>
          )}
          {call.retries?.map(retry => (
            <p key={retry.attempt}>
              {createFlowCopy(locale).retrying} {retry.attempt}/2 ·{" "}
              {Math.ceil(retry.delayMs / 1000)}s · {retry.reason}
            </p>
          ))}
          <p>
            {call.billing === "subscription" ||
            ["github-copilot", "antigravity"].includes(call.provider)
              ? usageUi.subscription
              : `${usageUi.referenceCost}: ${call.estimatedCostUsd === undefined ? ui.unknown : formatUsd(call.estimatedCostUsd, locale)}`}
          </p>
        </div>
      ))}
    </div>
  );
}
