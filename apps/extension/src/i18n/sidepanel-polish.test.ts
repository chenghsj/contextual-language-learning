import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingInfo } from "../components/setting-info";

test("setting help uses an accessible shadcn Popover in narrow Side Panels", async () => {
  const source = await readFile(new URL("../components/setting-info.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(createElement(SettingInfo, {
    label: "Learning language", infoLabel: "About", explanation: "Select a language.",
  }));
  assert.match(source, /<PopoverContent collisionPadding=\{8\}/);
  assert.match(source, /max-w-\[calc\(100vw-16px\)\]/);
  assert.match(html, /aria-label="About Learning language"/);
  assert.match(html, /aria-expanded="false"/);
});

test("task actions show pending state and status badges never wrap vertically", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../components/task-history.tsx", import.meta.url), "utf8");
  assert.match(app, /Math\.max\(0, 500 - \(performance\.now\(\) - startedAt\)\)/);
  assert.match(history, /disabled=\{loadingJobs\} aria-busy=\{loadingJobs\}/);
  const host = await readFile(new URL("../components/host-connection-settings.tsx", import.meta.url), "utf8");
  assert.match(host, /disabled=\{busy\} aria-busy=\{busy\}/);
  const picker = await readFile(new URL("../components/ai-model-selection.tsx", import.meta.url), "utf8");
  assert.match(picker, /aria-busy=\{busy\}/);
  assert.match(history, /<Badge className="shrink-0 whitespace-nowrap text-\[11px\] leading-4">/);
  assert.match(history, /<strong className="min-w-0 flex-1 truncate" title=\{job\.sourceTitle\}>/);
});

test("navigation and Drive backup use standard Tabs and Switch components", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const nav = await readFile(new URL("../components/side-panel-navigation.tsx", import.meta.url), "utf8");
  assert.match(nav, /<TabsTrigger/);
  assert.match(app, /<Switch checked=\{backup.enabled\}/);
  assert.doesNotMatch(nav, /bg-card!|hover:bg-transparent|shadow-\[/);
});
