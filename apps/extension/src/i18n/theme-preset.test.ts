import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const button = await readFile(new URL("../components/ui/button.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]),
  );
}
const lightMatch = css.match(/:root \{([\s\S]*?)\n\}/);
const darkMatch = css.match(/:root\[data-theme="dark"\], :root\.dark \{([\s\S]*?)\n\}/);
if (!lightMatch || !darkMatch) throw new Error("Theme must support both app data-theme and shadcn dark class.");
const light = declarations(lightMatch[1]), dark = declarations(darkMatch[1]);
// CSS custom properties not overridden by :root.dark inherit from the base :root.
const effectiveDark = { ...light, ...dark };

test("the warm OKLCH theme covers light and dark semantic tokens", () => {
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
    assert.ok(effectiveDark[name]?.startsWith("oklch("), "missing effective dark token: " + name);
    assert.match(css, new RegExp("--color-" + name + ": var\\(--" + name + "\\);"),
      "Tailwind mapping missing " + name);
  }
  assert.equal(light.primary, "oklch(0.6171 0.1375 39.0427)");
  assert.equal(dark.primary, "oklch(0.6724 0.1308 38.7559)");
  assert.equal(light.background, "oklch(0.9818 0.0054 95.0986)");
  assert.equal(dark.background, "oklch(0.2679 0.0036 106.6427)");
  assert.equal(light["sidebar-primary"], "oklch(0.6171 0.1375 39.0427)");
  assert.equal(dark["sidebar-primary"], "oklch(0.3250 0 0)");
  assert.equal(dark["chart-1"], undefined, "unchanged chart color should inherit");
  assert.equal(effectiveDark["chart-1"], light["chart-1"]);
  assert.equal(light.radius, "1rem");
});

test("cards, tooltips and compact player use warm rounded surfaces", () => {
  assert.equal(light.radius, "1rem");
  for (const [token, expected] of [
    ["xs", "calc(var(--radius) - 6px)"],
    ["sm", "calc(var(--radius) - 4px)"],
    ["md", "calc(var(--radius) - 2px)"],
    ["lg", "var(--radius)"],
    ["xl", "calc(var(--radius) + 4px)"],
    ["full", "9999px"],
  ]) assert.ok(css.includes("--radius-" + token + ": " + expected + ";"), token);
  assert.doesNotMatch(css, /--radius:\s*0;/);
  assert.match(css, /\.panel \{[^}]+border-radius: var\(--radius\)/);
  assert.match(css, /\.settingInfoPopover \{[\s\S]*?background: var\(--popover\)/);
  assert.match(css, /\.sceneMiniControls \{/);
  assert.match(css, /:root\.dark \.textButton \{\s*color: var\(--primary\)/);
});

test("button variants and transient feedback use theme tokens instead of the old fixed palette", () => {
  for (const value of [
    "bg-primary text-primary-foreground",
    "bg-secondary text-secondary-foreground",
    "bg-destructive text-destructive-foreground",
    "hover:bg-accent hover:text-accent-foreground",
  ]) assert.ok(button.includes(value), "button variant missing " + value);
  assert.doesNotMatch(button, /bg-red-600|bg-red-700/);
  assert.doesNotMatch(css, /#(?:f8faf9|17231f|e7f4ec|f3c0b5|fff0ec|e9f4fb|79b18d)/i);
  assert.match(css, /\.status \{[^}]+var\(--primary\)/);
  assert.match(css, /\.alert \{[^}]+var\(--destructive\)/);
});

test("primary Side Panel action labels are readable without changing the warm palette", () => {
  assert.match(app, /<Button className="subtitleFetchButton"/);
  assert.match(app, /<Button className="primary" onClick=\{startGeneration\}/);
  assert.match(css, /button\[data-slot="button"\]\.subtitleFetchButton,\s*button\[data-slot="button"\]\.primary\s*\{/);
  const rule = css.match(/button\[data-slot="button"\]\.subtitleFetchButton,[\s\S]*?\{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /min-height: 40px/);
  assert.match(rule, /font-size: 14px/);
  assert.match(rule, /font-weight: 600/);
  assert.match(rule, /white-space: normal/);
  assert.doesNotMatch(rule, /(?:background|color):/);
  assert.equal(light.primary, "oklch(0.6171 0.1375 39.0427)");
  assert.equal(light["primary-foreground"], "oklch(1.0000 0 0)");
  assert.match(css, /@custom-variant dark \(&:is\(\.dark \*\)\);/);
});


test("saved and system dark appearance apply the warm theme before and after React renders", async () => {
  const entry = await readFile(new URL("../main.tsx", import.meta.url), "utf8");
  assert.match(entry, /classList\.toggle\("dark", initialTheme === "dark"\)/);
  assert.match(app, /classList\.toggle\("dark", activeTheme === "dark"\)/);
  assert.match(css, /--color-destructive-foreground: var\(--destructive-foreground\);/);
});
