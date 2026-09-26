import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Reference: integration commit 7b9249afa90dea8d5d2b525660c7dea26b9ecefc,
 * before the PR #69/#71 UI refactors. A future intentional shadcn upgrade must
 * be reviewed separately, rather than silently changing the shared defaults.
 */
const originalBlobShas = {
  "badge.tsx": "2c07258ef7c6b90c9b0befb27ddfd489e5e2e859",
  "button.tsx": "c92fe2cdb9faabb29c315b793fe0768a36ed23b2",
  "card.tsx": "b5882eb33e46838b72d92d16e27dcc41abd61627",
  "input.tsx": "12bb680feaa0730744c47446b861e2bf4d05168e",
  "select.tsx": "1e434745cc925711f6636b7b45eb8f32af6c9d27",
  "textarea.tsx": "33d7dd3b85edae7c6d551ed9a6a87941784fe004",
} as const;

function gitBlobSha(source: string): string {
  return createHash("sha1")
    .update("blob " + Buffer.byteLength(source, "utf8") + "\0")
    .update(source, "utf8")
    .digest("hex");
}

test("all six shared shadcn wrappers retain their original styles and variants", async () => {
  for (const [file, expectedSha] of Object.entries(originalBlobShas)) {
    const source = await readFile(new URL("../components/ui/" + file, import.meta.url), "utf8");
    assert.equal(gitBlobSha(source), expectedSha,
      file + " must remain byte-for-byte identical to the pre-refactor shadcn wrapper");
  }
});

test("application-specific Card layout stays outside the shadcn Card", async () => {
  const panel = await readFile(new URL("../components/app-panel.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const legacy = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const contextual = await readFile(new URL("../components/contextual-scene-reader.tsx", import.meta.url), "utf8");
  assert.match(panel, /<Card\s/);
  assert.match(panel, /mb-3 min-w-0 max-w-full p-4/);
  assert.doesNotMatch(panel, /(?:bg-card|shadow-|rounded-|border-border)/,
    "AppPanel should add spacing/heading layout, not override the shadcn Card's appearance");
  assert.match(app, /<AppPanel>/);
  assert.match(legacy, /<AppPanel>/);
  assert.match(contextual, /<Card className="mb-3 min-w-0 max-w-full/);
  assert.match(app, /<Input type="file" className="h-auto min-h-10 p-\[7px\] text-xs"/,
    "the special subtitle upload size belongs only to this usage");
  assert.match(app, /<Textarea className="resize-y" rows=\{5\}/,
    "textarea resize is a usage-level choice, not a global default");
  assert.doesNotMatch(app, /<Button variant="outline" className="bg-secondary/,
    "the original shadcn outline variant must not be recolored by page CSS");
});
