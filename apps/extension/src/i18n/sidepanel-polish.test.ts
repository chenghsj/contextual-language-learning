import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingInfo } from "../components/setting-info";

test("setting help anchors to its icon and prevents viewport overflow, even in narrow Side Panels", async () => {
  const source = await readFile(new URL("../components/setting-info.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(createElement(SettingInfo, {
    label: "Learning language", infoLabel: "About", explanation: "Select a language.",
  }));
  assert.match(source, /trigger\.getBoundingClientRect\(\)/);
  assert.match(source, /window\.innerWidth - width - margin/);
  assert.match(source, /window\.innerHeight - height - margin/);
  assert.match(source, /document\.addEventListener\("scroll", reposition, true\)/);
  assert.match(source, /document\.addEventListener\("keydown", closeEscape\)/);
  assert.match(html, /class="fixed z-50/);
  assert.match(html, /aria-controls="/);
  assert.match(html, /role="note"/);
});

test("task actions show pending state and status badges never wrap vertically", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /Math\.max\(0, 500 - \(performance\.now\(\) - startedAt\)\)/);
  assert.match(app, /disabled=\{loadingJobs\} aria-busy=\{loadingJobs\}/);
  assert.match(app, /disabled=\{hostBusy\} aria-busy=\{hostBusy\}/);
  assert.match(app, /modelBusy && <span aria-hidden="true"/);
  assert.match(app, /<Badge className="shrink-0 whitespace-nowrap text-\[11px\] leading-4">/);
  assert.match(app, /<strong className="min-w-0 flex-1 truncate" title=\{job\.sourceTitle\}>/);
});

test("navigation, form action and Drive Switch use compact app-level dimensions", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const nav = app.slice(app.indexOf("<nav className="), app.indexOf("</nav>"));
  assert.equal((nav.match(/rounded-\[calc\(var\(--radius\)-4px\)\]/g) ?? []).length, 8);
  assert.match(app, /className="h-9 min-w-0 px-3 text-center text-sm font-semibold/);
  assert.match(app, /role="switch" aria-checked=\{backup\.enabled\}/);
  assert.match(app, /relative block h-\[22px\] w-\[38px\]/);
  assert.match(app, /group-aria-checked:translate-x-4/);
});
