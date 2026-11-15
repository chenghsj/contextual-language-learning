import assert from "node:assert/strict";
import test from "node:test";
import { cn } from "./utils";

test("product typography survives foreground color variants", () => {
  for (const role of ["body", "source", "heading", "label", "meta"]) {
    assert.equal(
      cn(`text-ui-${role}`, "text-muted-foreground"),
      `text-ui-${role} text-muted-foreground`,
    );
    assert.equal(cn("text-destructive", `text-ui-${role}`), `text-destructive text-ui-${role}`);
  }
});

test("compact controls and product roles override inherited font sizes", () => {
  assert.equal(cn("text-ui-heading font-semibold", "text-xs"), "font-semibold text-xs");
  assert.equal(cn("text-sm", "text-ui-source"), "text-ui-source");
  assert.equal(cn("text-ui-source", "text-ui-body"), "text-ui-body");
});
