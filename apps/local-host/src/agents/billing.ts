import type { BillingKind } from "@contextual/core";

/** Use SDK subscription metadata; the Antigravity plugin does not yet declare it. */
export function billingKind(provider: string, subscription: boolean): BillingKind {
  return subscription || provider === "github-copilot" || provider === "antigravity"
    ? "subscription"
    : "api";
}
