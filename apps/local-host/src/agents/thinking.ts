import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@contextual/core";

export const BUDGET_STRATEGY_VERSION = "effective-reasoning-budget-1";

/** Match Pi's automatic medium, resolving capabilities before sizing or freezing a call. */
export function effectiveThinkingLevel(
  model: Model<Api>,
  requested?: ThinkingLevel,
): ThinkingLevel {
  if (requested !== undefined) {
    if (!getSupportedThinkingLevels(model).includes(requested))
      throw new Error(
        "The selected reasoning level is unavailable for this model. Choose a supported level.",
      );
    return requested;
  }
  return clampThinkingLevel(model, "medium");
}
