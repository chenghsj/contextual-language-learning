import { z } from "zod";

export const BillingKindSchema = z.enum(["api", "subscription"]);
export type BillingKind = z.infer<typeof BillingKindSchema>;

/** Only known initial prompts are estimated; later model output is not predicted. */
export const GenerationInputEstimateSchema = z
  .object({
    provider: z.string(),
    modelId: z.string(),
    inputTokens: z.number().int().nonnegative(),
    inputCalls: z.number().int().positive(),
    billing: BillingKindSchema,
    inputCostUsd: z.number().nonnegative().finite().optional(),
  })
  .refine(
    value => value.billing !== "subscription" || value.inputCostUsd === undefined,
    "Subscription usage cannot be presented as an API charge",
  );
export type GenerationInputEstimate = z.infer<typeof GenerationInputEstimateSchema>;
