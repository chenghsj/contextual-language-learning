import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const handler = app.match(/onActivity=\{\(\) => \{([^\n]+)\}\}/)?.[1];
assert.ok(handler, "header Activity handler exists");
const onActivity = new Function("page", "setReturnPage", "setPage", "loadJobs", handler);

function clickActivity(page: string) {
  const calls: string[] = [];
  onActivity(
    page, (value: string) => calls.push(`return:${value}`),
    (value: string) => calls.push(`page:${value}`), () => calls.push("refresh"),
  );
  return calls;
}

test("clicking the selected Activity page does not refresh tasks", () => {
  assert.deepEqual(clickActivity("activity"), []);
});

test("entering Activity loads tasks and retains the previous primary page", () => {
  for (const page of ["create", "lessons", "lesson"]) {
    assert.deepEqual(clickActivity(page), [`return:${page}`, "page:activity", "refresh"]);
  }
});
