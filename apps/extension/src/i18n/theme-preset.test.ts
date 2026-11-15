import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { ActionFeedbackButton } from "../components/action-feedback-button";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const button = await readSource(
  new URL("../../../../packages/ui/src/components/ui/button.tsx", import.meta.url),
);
const app = await readSource(new URL("../App.tsx", import.meta.url));
const sonner = await readSource(new URL("../components/ui/sonner.tsx", import.meta.url));
const card = await readSource(
  new URL("../../../../packages/ui/src/components/ui/card.tsx", import.meta.url),
);
const info = await readSource(new URL("../components/setting-info.tsx", import.meta.url));
const contextual = await readSource(
  new URL("../components/contextual-scene-reader.tsx", import.meta.url),
);

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]),
  );
}
const lightMatch = css.match(/:root \{([\s\S]*?)\n\}/);
const darkMatch = css.match(/\.dark \{([\s\S]*?)\n\}/);
if (!lightMatch || !darkMatch)
  throw new Error("Theme must provide the supplied :root and .dark tokens.");
const light = declarations(lightMatch[1]),
  dark = declarations(darkMatch[1]);
// CSS custom properties not overridden by :root.dark inherit from the base :root.
const effectiveDark = { ...light, ...dark };

test("the warm OKLCH theme covers light and dark semantic tokens", () => {
  const names = [
    "background",
    "foreground",
    "card",
    "card-foreground",
    "popover",
    "popover-foreground",
    "primary",
    "primary-foreground",
    "secondary",
    "secondary-foreground",
    "muted",
    "muted-foreground",
    "accent",
    "accent-foreground",
    "destructive",
    "border",
    "input",
    "ring",
    "chart-1",
    "chart-2",
    "chart-3",
    "chart-4",
    "chart-5",
    "sidebar",
    "sidebar-foreground",
    "sidebar-primary",
    "sidebar-primary-foreground",
    "sidebar-accent",
    "sidebar-accent-foreground",
    "sidebar-border",
    "sidebar-ring",
  ];
  for (const name of names) {
    assert.ok(light[name]?.startsWith("oklch("), "missing light token: " + name);
    assert.ok(effectiveDark[name]?.startsWith("oklch("), "missing effective dark token: " + name);
    assert.match(
      css,
      new RegExp("--color-" + name + ": var\\(--" + name + "\\);"),
      "Tailwind mapping missing " + name,
    );
  }
  assert.equal(light.primary, "oklch(0.6171 0.1375 39.0427)");
  assert.equal(dark.primary, "oklch(0.6724 0.1308 38.7559)");
  assert.equal(light.background, "oklch(0.9818 0.0054 95.0986)");
  assert.equal(dark.background, "oklch(0.2679 0.0036 106.6427)");
  assert.equal(light["sidebar-primary"], "oklch(0.6171 0.1375 39.0427)");
  assert.match(dark["sidebar-primary"], /^oklch\(0\.3250? 0 0\)$/);
  assert.equal(dark["chart-1"], light["chart-1"], "the user-supplied dark preset repeats chart-1");
  assert.equal(effectiveDark["chart-1"], light["chart-1"]);
  assert.equal(light.radius, "0.625rem");
});

test("cards, tooltips and compact player use compact rounded Tailwind utilities", () => {
  assert.equal(light.radius, "0.625rem");
  assert.equal(effectiveDark.radius, light.radius);
  for (const [token, expected] of [
    ["sm", "calc(var(--radius) - 4px)"],
    ["md", "calc(var(--radius) - 2px)"],
    ["lg", "var(--radius)"],
    ["xl", "calc(var(--radius) + 4px)"],
  ])
    assert.ok(css.includes("--radius-" + token + ": " + expected + ";"), token);
  assert.doesNotMatch(css, /--radius:\s*0;/);
  assert.ok(
    card.includes("rounded-xl border border-border bg-card text-card-foreground shadow-sm"),
  );
  assert.ok(info.includes("PopoverContent"));
  assert.ok(/editing && draft \? \(?<section/.test(contextual));
  assert.ok(contextual.includes('data-ui="unifiedPlayer"'));
  assert.doesNotMatch(contextual, /backdrop:bg-|<dialog/, "V5 time adjustment stays inline");
});

test("button variants and utility feedback use theme tokens instead of the old fixed palette", () => {
  for (const value of [
    "bg-primary text-primary-foreground",
    "bg-secondary text-secondary-foreground",
    "bg-destructive text-destructive-foreground",
    "hover:bg-accent hover:text-accent-foreground",
  ])
    assert.ok(button.includes(value), "button variant missing " + value);
  assert.doesNotMatch(button, /bg-red-600|bg-red-700/);
  assert.doesNotMatch(css, /#(?:f8faf9|17231f|e7f4ec|f3c0b5|fff0ec|e9f4fb|79b18d)/i);
  assert.ok(sonner.includes("group-[.toaster]:bg-background"));
  assert.doesNotMatch(sonner, /color-mix|--border-radius|--width|--error-bg/);
  assert.match(css, /@layer base \{/);
  assert.doesNotMatch(
    css,
    /^\.(?!dark\b)[A-Za-z][\w-]*\s*\{/gm,
    "component selectors must be replaced by Tailwind v4 utilities",
  );
});

test("primary Side Panel action utilities keep readable labels and the warm palette", () => {
  const dom = new JSDOM(
    renderToStaticMarkup(
      createElement(ActionFeedbackButton, {
        label: "Fetch subtitles",
        busyLabel: "Fetching subtitles",
        busy: true,
        success: false,
        disabled: false,
        onClick: () => {},
      }),
    ),
  );
  try {
    const action = dom.window.document.querySelector("button")!;
    assert.equal(action.getAttribute("aria-label"), "Fetch subtitles");
    assert.equal(action.getAttribute("aria-busy"), "true");
    assert.equal(action.disabled, true);
    assert.ok(action.classList.contains("whitespace-normal"));
    assert.ok(action.classList.contains("text-xs"));
    assert.doesNotMatch(action.className, /\bbg-(?:red|green)/);
  } finally {
    dom.window.close();
  }
  assert.match(button, /sm: "h-8[^"\n]*text-xs/);
  assert.equal(light.primary, "oklch(0.6171 0.1375 39.0427)");
  assert.match(light["primary-foreground"], /^oklch\(1(?:\.0+)? 0 0\)$/);
  assert.match(css, /@custom-variant dark \(&:is\(\.dark \*\)\);/);
  assert.doesNotMatch(
    app + contextual + info,
    /tw\(|utility-classes/,
    "views use Tailwind directly",
  );
});

test("saved and system dark appearance apply the warm theme before and after React renders", async () => {
  const entry = await readSource(new URL("../main.tsx", import.meta.url));
  assert.match(entry, /classList\.toggle\("dark", initialTheme === "dark"\)/);
  assert.match(app, /classList\.toggle\("dark", activeTheme === "dark"\)/);
  assert.match(css, /--color-destructive-foreground: var\(--destructive-foreground\);/);
});
