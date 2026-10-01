import { readSource } from "../lib/source-contract";
import ts from "typescript";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Reference: integration commit 7b9249afa90dea8d5d2b525660c7dea26b9ecefc,
 * before the PR #69/#71 UI refactors. A future intentional shadcn upgrade must
 * be reviewed separately, rather than silently changing the shared defaults.
 */
const originalStyleHashes = {
  "badge.tsx": "db08c1d7e139f658feb2aae29ba83cf56ed076eed5ee18be3ba6e62f6cfb443d",
  "button.tsx": "d3f23a3c1d06a9ec5ce49ae7493f2f6afaad3bd859c2a178e3d37d61bca562e4",
  "card.tsx": "fdc12e0018dc4d62534d42a232f3073b46543d5dafed94aed938950459ad6fe2",
  "input.tsx": "8c81e9212078c936e0fba040e16c9f293dcf5a42ee79b63ff35c1433a002dc1b",
  "select.tsx": "bf6b4bfe8c35cc005b7a984f153db7827e278ec85e4ad7e7db6b19f027ecc2c5",
  "textarea.tsx": "889c9fbedd3e0f33cce06e5fde9b3403acebdc5f7a7261f8b99064065ac57d68",
} as const;

function styleHash(source: string): string {
  const tree = ts.createSourceFile(
    "wrapper.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) strings.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return createHash("sha256").update(JSON.stringify(strings)).digest("hex");
}

test("all six shared shadcn wrappers retain their original styles and variants", async () => {
  for (const [file, expectedSha] of Object.entries(originalStyleHashes)) {
    const source = await readFile(new URL("../components/ui/" + file, import.meta.url), "utf8");
    assert.equal(
      styleHash(source),
      expectedSha,
      file + " must retain the pre-refactor style and variant strings",
    );
  }
});

test("application-specific Card layout stays outside the shadcn Card", async () => {
  const panel = await readSource(new URL("../components/app-panel.tsx", import.meta.url));
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const contextual = await readSource(
    new URL("../components/contextual-scene-reader.tsx", import.meta.url),
  );
  assert.match(panel, /<Card\s/);
  assert.match(panel, /mb-3 min-w-0 max-w-full p-4/);
  assert.doesNotMatch(
    panel,
    /(?:bg-card|shadow-|rounded-|border-border)/,
    "AppPanel should add spacing/heading layout, not override the shadcn Card's appearance",
  );
  assert.match(app, /<AppPanel>/);
  assert.match(contextual, /data-ui="unifiedReader"/);
  const importing = await readSource(new URL("../components/subtitle-import.tsx", import.meta.url));
  assert.match(importing, /<Input ref=\{fileInput\} type="file" className="hidden"/);
  assert.match(importing, /<Textarea id=\{pasteId\} className="resize-y" rows=\{5\}/);
  assert.doesNotMatch(
    app,
    /<Button variant="outline" className="bg-secondary/,
    "the original shadcn outline variant must not be recolored by page CSS",
  );
});
