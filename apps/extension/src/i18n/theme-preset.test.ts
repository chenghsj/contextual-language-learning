import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const button = await readFile(new URL("../components/ui/button.tsx", import.meta.url), "utf8");

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]),
  );
}
const lightMatch = css.match(/:root \{([\s\S]*?)\n\}/);
const darkMatch = css.match(/:root\[data-theme="dark"\], :root\.dark \{([\s\S]*?)\n\}/);
if (!lightMatch || !darkMatch) throw new Error("Theme must support both app data-theme and shadcn dark class.");
const light = declarations(lightMatch[1]), dark = declarations(darkMatch[1]);

test("the supplied shadcn preset is applied to both themes without dropping semantic tokens", () => {
  const names = [
    "background", "foreground", "card", "card-foreground", "popover",
    "popover-foreground", "primary", "primary-foreground", "secondary",
    "secondary-foreground", "muted", "muted-foreground", "accent",
    "accent-foreground", "destructive", "border", "input", "ring",
    "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
    "sidebar", "sidebar-foreground", "sidebar-primary",
    "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground",
    "sidebar-border", "sidebar-ring",
  ];
  for (const name of names) {
    assert.ok(light[name]?.startsWith("oklch("), "missing light token: " + name);
    assert.ok(dark[name]?.startsWith("oklch("), "missing dark token: " + name);
    assert.match(css, new RegExp("--color-" + name + ": var\\(--" + name + "\\);"),
      "Tailwind mapping missing " + name);
  }
  assert.equal(light.primary, "oklch(0.511 0.096 186.391)");
  assert.equal(dark.primary, "oklch(0.437 0.078 188.216)");
  assert.equal(light.background, "oklch(1 0 0)");
  assert.equal(dark.background, "oklch(0.148 0.004 228.8)");
  assert.equal(light["sidebar-primary"], "oklch(0.6 0.118 184.704)");
  assert.equal(dark["sidebar-primary"], "oklch(0.704 0.14 182.503)");
  assert.equal(light.radius, "0");
});

test("cards, tooltips and existing rounded utilities respect the square preset", () => {
  for (const token of ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "full"]) {
    assert.match(css, new RegExp("--radius-" + token + ": var\\(--radius\\);"));
  }
  assert.doesNotMatch(css, /border-radius:\s*(?:\d+(?:\.\d+)?px|50%)/);
  assert.match(css, /\.panel \{[^}]+border-radius: var\(--radius\)/);
  assert.match(css, /\.settingInfoPopover \{[\s\S]*?background: var\(--popover\)/);
  assert.match(css, /\.scenePlayer \{/);
});

test("button variants and transient feedback use theme tokens instead of the old fixed palette", () => {
  for (const value of [
    "bg-primary text-primary-foreground",
    "bg-secondary text-secondary-foreground",
    "bg-destructive text-background",
    "hover:bg-accent hover:text-accent-foreground",
  ]) assert.ok(button.includes(value), "button variant missing " + value);
  assert.doesNotMatch(button, /bg-red-600|bg-red-700/);
  assert.doesNotMatch(css, /#(?:f8faf9|17231f|e7f4ec|f3c0b5|fff0ec|e9f4fb|79b18d)/i);
  assert.match(css, /\.status \{[^}]+var\(--primary\)/);
  assert.match(css, /\.alert \{[^}]+var\(--destructive\)/);
});
