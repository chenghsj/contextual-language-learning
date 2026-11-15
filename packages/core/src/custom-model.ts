import { z } from "zod";

/** Provider model IDs are opaque values, not display names or commands. */
export const CustomModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u, "Enter a model ID without spaces or control characters.");

export const CustomModelIdsSchema = z.array(CustomModelIdSchema).max(50);

export const DiscoveredModelSchema = z.object({
  id: CustomModelIdSchema,
  label: z.string().min(1).max(240),
  catalogId: CustomModelIdSchema.optional(),
});
export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>;
