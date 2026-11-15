import assert from "node:assert/strict";
import test from "node:test";
import { routeHash, readRoute, type ReaderRoute } from "./navigation";

test("library, favorites and material links round-trip without putting lesson contents in URLs", () => {
  const routes: ReaderRoute[] = [
    { kind: "library" },
    { kind: "favorites" },
    { kind: "material", key: "standard:00000000-0000-4000-8000-000000000001" },
    { kind: "material", key: "custom:00000000-0000-4000-8000-000000000002" },
    { kind: "favorite", key: "a".repeat(64) },
  ];
  for (const route of routes) assert.deepEqual(readRoute(routeHash(route)), route);
});
test("malformed and unknown links safely return to the library", () => {
  for (const hash of [
    "",
    "#",
    "#/material/%",
    "#/material/undefined",
    "#/favorite/private-title",
    "#/favorite/" + "a".repeat(64) + "/other",
    "#/external/https://example.test",
  ]) {
    assert.deepEqual(readRoute(hash), { kind: "library" });
  }
});
