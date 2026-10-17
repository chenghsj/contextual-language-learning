import React, { useEffect, useState } from "react";
import type {
  GenerationRequest,
  CustomGenerationRequest,
  GenerationInputEstimate,
} from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { usageEstimateCopy, formatUsd } from "../i18n/usage-estimate";
import { nativeOnce } from "../native/host-client";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

type Payload = GenerationRequest | CustomGenerationRequest;
export function GenerationEstimate({
  locale,
  payload,
  available,
}: {
  locale: UiLocale;
  payload: Payload | null;
  available: boolean;
}) {
  const ui = usageEstimateCopy(locale);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    payload: Payload;
    estimate?: GenerationInputEstimate;
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    let live = true;
    if (!available || !payload) return;
    setState({ payload });
    const timer = window.setTimeout(() => {
      void nativeOnce({ id: crypto.randomUUID(), type: "estimateGeneration", payload })
        .then(reply => {
          if (live) setState({ payload, estimate: reply.estimate });
        })
        .catch(() => {
          if (live) setState({ payload, failed: true });
        });
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [payload, available, retry]);
  const current = available && state?.payload === payload ? state : null;
  const estimate = current?.estimate;
  return (
    <Disclosure title={ui.title} data-ui="generationEstimate">
      {estimate ? (
        <div className="grid gap-3 text-xs">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
            <dt>{ui.input}</dt>
            <dd className="text-right tabular-nums">
              {ui.tokens.replace("{count}", estimate.inputTokens.toLocaleString(locale))}
            </dd>
            <dt>{ui.calls}</dt>
            <dd className="text-right tabular-nums">
              {estimate.inputCalls.toLocaleString(locale)}
            </dd>
            {estimate.billing === "api" && estimate.inputCostUsd !== undefined && (
              <>
                <dt>{ui.inputCost}</dt>
                <dd className="text-right tabular-nums">
                  {formatUsd(estimate.inputCostUsd, locale)}
                </dd>
              </>
            )}
          </dl>
          <p className="text-muted-foreground">{ui.scope}</p>
          <p className="text-muted-foreground">{ui.approximate}</p>
          <p className="text-muted-foreground">
            {estimate.billing === "subscription"
              ? ui.subscription
              : estimate.inputCostUsd === undefined
                ? ui.priceUnknown
                : ui.pricing}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 text-xs">
          <p role="status" className="text-muted-foreground">
            {available && payload && !current?.failed ? ui.loading : ui.unavailable}
          </p>
          {current?.failed && (
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => setRetry(value => value + 1)}
            >
              {ui.retry}
            </Button>
          )}
        </div>
      )}
    </Disclosure>
  );
}
