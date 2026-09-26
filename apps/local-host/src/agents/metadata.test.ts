import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogModels, parseCliModelTable, probeCli, discoverAgentModels } from "./metadata";

test("generic CLI text model catalogs have bounded, de-duplicated IDs", () => {
  const output = "slug                    name\n" +
    "first-high               First (High)\n" +
    "second-medium            Second (Medium)\n" +
    "\u001b[32msecond-medium            Duplicate\u001b[0m\n";
  assert.deepEqual(parseCliModelTable(output), [
    { id: "first-high", label: "First (High)" },
    { id: "second-medium", label: "Duplicate" },
  ]);
});

test("generic JSON catalogs filter hidden entries and untrusted model IDs", () => {
  const catalog = { models: [
    { slug: "model-one", display_name: "Model One", visibility: "list", internal: { secret: true } },
    { slug: "hidden-model", visibility: "hide" },
    { slug: "--flag", name: "Invalid" },
  ] };
  assert.deepEqual(parseCatalogModels(catalog), [{ id: "model-one", label: "Model One" }]);
  assert.deepEqual(parseCatalogModels({ models: "not an array" }), []);
  assert.deepEqual(parseCliModelTable(JSON.stringify({ models: [
    { id: "new-model", name: "New Model" }, { id: "../../bin/sh", name: "Invalid" },
  ] })), [{ id: "new-model", label: "New Model" }]);
});

test("generic text catalogs accept nonbreaking spaces and stderr", async () => {
  const output = await probeCli(process.execPath, ["-e",
    'process.stderr.write("example-high    Example (High)\\n")'], { ...process.env });
  assert.equal(output.stdout, "");
  assert.deepEqual(parseCliModelTable(output.stderr),
    [{ id: "example-high", label: "Example (High)" }]);
  assert.deepEqual(parseCliModelTable("alpha-high \u00a0 \u00a0 Alpha\n"),
    [{ id: "alpha-high", label: "Alpha" }]);
});

test("removed built-in Agent cannot fetch a model catalog", async () => {
  await assert.rejects(() => discoverAgentModels({ provider: "agy", modelId: "" }),
    /no longer supported/);
});
