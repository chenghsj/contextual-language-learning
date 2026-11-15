import test from "node:test";
import assert from "node:assert/strict";
import { searchableModelOptions } from "./model-options";

test("search choices preserve SDK capabilities/denials and exclude known effort aliases", () => {
  const sdk = [
    { id: "known", label: "Known model", thinkingLevels: ["high" as const] },
    { id: "denied", label: "Denied", disabled: true },
  ];
  const result = searchableModelOptions(
    sdk,
    [
      { id: "known-high", label: "Known (High)", catalogId: "known" },
      { id: "denied", label: "Denied copy" },
      { id: "future", label: "Future model" },
    ],
    [],
  );
  assert.deepEqual(
    result.map(model => model.id),
    ["known", "denied", "future"],
  );
  assert.deepEqual(result[0], sdk[0]);
  assert.equal(result[1].disabled, true);
  assert.equal(result[2].custom, true);
  assert.deepEqual(result[2].thinkingLevels, ["off"]);
  assert.equal(result[2].availability, "unknown");
});

test("saved IDs regain human names without registering them or inferring capabilities", () => {
  const result = searchableModelOptions(
    [{ id: "future", label: "future", custom: true }],
    [{ id: "future", label: "Future model" }],
    ["future", "manual"],
  );
  assert.deepEqual(
    result.map(model => model.label),
    ["Future model", "manual"],
  );
  assert.equal(result[0].custom, true);
});

test("identically named snapshots remain distinguishable while searching by name", () => {
  const result = searchableModelOptions(
    [{ id: "version-a", label: "Same model" }],
    [{ id: "version-b", label: "Same model" }],
    [],
  );
  assert.deepEqual(
    result.map(model => model.label),
    ["Same model (version-a)", "Same model (version-b)"],
  );
});
