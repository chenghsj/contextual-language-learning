import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";

const app = await readSource(new URL("../App.tsx", import.meta.url));
const handler = app.match(
  /function openActivity\(\): void \{(.*?)\} function confirmRegeneration/,
)?.[1];
assert.ok(handler, "header Activity handler exists");
const onActivity = new Function(
  "pageRef",
  "setReturnPage",
  "setExecutionDetails",
  "setPage",
  "loadJobs",
  handler,
);

function clickActivity(page: string) {
  const calls: string[] = [];
  onActivity(
    { current: page },
    (value: string) => calls.push(`return:${value}`),
    () => calls.push("details:clear"),
    (value: string) => calls.push(`page:${value}`),
    () => calls.push("refresh"),
  );
  return calls;
}

test("clicking the selected Activity page does not refresh tasks", () => {
  assert.deepEqual(clickActivity("activity"), []);
});

test("entering Activity loads tasks and retains the previous primary page", () => {
  for (const page of ["create", "lessons", "lesson", "custom"]) {
    assert.deepEqual(clickActivity(page), [
      `return:${page}`,
      "details:clear",
      "page:activity",
      "refresh",
    ]);
  }
});
