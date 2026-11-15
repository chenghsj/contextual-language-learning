import { z } from "zod";

export const LocalModelConfigSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine(value => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "Enter an HTTP or HTTPS API base URL without credentials or query parameters.")
      .transform(value => value.replace(/\/+$/, "")),
    modelId: z.string().trim().min(1).max(120),
    contextWindow: z.number().int().min(1024).max(2_000_000),
    maxTokens: z.number().int().min(256).max(1_000_000),
    reasoning: z.boolean(),
  })
  .strict()
  .refine(value => value.maxTokens <= value.contextWindow, {
    message: "Maximum output must not exceed the context window.",
    path: ["maxTokens"],
  });
export type LocalModelConfig = z.infer<typeof LocalModelConfigSchema>;

/** Omitted key preserves the saved key only when the endpoint is unchanged; empty removes it. */
export const LocalModelInputSchema = z
  .object({
    config: LocalModelConfigSchema,
    apiKey: z
      .string()
      .trim()
      .max(20000)
      .refine(value => !/[\r\n]/.test(value), "API keys must be a single line.")
      .refine(value => !value.startsWith("!"), "Credential commands are not supported.")
      .optional(),
  })
  .strict();
export type LocalModelInput = z.infer<typeof LocalModelInputSchema>;

export const LocalModelStateSchema = z.object({
  config: LocalModelConfigSchema.nullable(),
  hasApiKey: z.boolean(),
});
