/** Historical offline diagnostics only. The active pipeline does not import this module. */
import { z } from "zod";
import { TeachingBatchOutputSchema } from "@contextual/core";
const PatchSchema = z
  .object({
    patches: z
      .array(
        z
          .object({ path: z.string().min(1).max(600), value: z.unknown() })
          .strict()
          .refine(p => Object.hasOwn(p, "value"), "Quality patch value is required"),
      )
      .max(100),
  })
  .strict();
/** Replace existing batch content only. Source/frozen units live outside the patchable draft. */
export function applyQualityPatch(draft: unknown, raw: unknown) {
  const patch = PatchSchema.parse(raw),
    copy: unknown = structuredClone(draft);
  const seen = new Set<string>();
  for (const { path, value } of patch.patches) {
    const keys = path
      .slice(1)
      .split("/")
      .map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (
      !path.startsWith("/") ||
      ![
        "title",
        "context",
        "translations",
        "utterances",
        "points",
        "reusableItems",
        "pronunciations",
        "risks",
      ].includes(keys[0]) ||
      keys.some(k =>
        ["__proto__", "constructor", "prototype", "id", "sceneId", "cueId", "cueIds"].includes(k),
      )
    )
      throw new Error("Quality repair cannot patch identity/source");
    if (seen.has(path)) throw new Error("Duplicate quality patch");
    seen.add(path);
    let parent = copy as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
        throw new Error("Unknown quality patch path");
      parent = parent[key] as Record<string, unknown>;
    }
    const key = keys.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      throw new Error("Unknown quality patch path");
    parent[key] = structuredClone(value);
  }
  return TeachingBatchOutputSchema.parse(copy);
}
