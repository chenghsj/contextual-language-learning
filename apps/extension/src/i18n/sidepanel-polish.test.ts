import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingInfo } from "../components/setting-info";
import { ActionFeedbackButton } from "../components/action-feedback-button";

test("setting help uses an accessible shadcn Popover in narrow Side Panels", async () => {
  const source = await readSource(new URL("../components/setting-info.tsx", import.meta.url));
  const html = renderToStaticMarkup(
    createElement(SettingInfo, {
      label: "Learning language",
      infoLabel: "About",
      explanation: "Select a language.",
    }),
  );
  assert.match(source, /<PopoverContent collisionPadding=\{8\}/);
  assert.match(source, /max-w-\[calc\(100vw-16px\)\]/);
  assert.match(html, /aria-label="About Learning language"/);
  assert.match(html, /aria-expanded="false"/);
});

test("task actions show pending state and status badges never wrap vertically", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const history = await readSource(new URL("../components/task-history.tsx", import.meta.url));
  assert.match(app, /Math\.max\(0, 500 - \(performance\.now\(\) - startedAt\)\)/);
  assert.match(history, /disabled=\{loadingJobs\} aria-busy=\{loadingJobs\}/);
  const host = await readSource(
    new URL("../components/host-connection-settings.tsx", import.meta.url),
  );
  assert.match(host, /<ActionFeedbackButton/);
  const pending = renderToStaticMarkup(
    createElement(ActionFeedbackButton, {
      label: "Check connection",
      busyLabel: "Checking",
      successLabel: "Connected",
      busy: true,
      success: false,
      disabled: false,
      onClick: () => {},
    }),
  );
  assert.match(pending, /disabled=""/);
  assert.match(pending, /aria-busy="true"/);
  const picker = await readSource(new URL("../components/ai-model-selection.tsx", import.meta.url));
  assert.match(picker, /aria-busy=\{busy\}/);
  assert.match(history, /<Badge className="shrink-0 whitespace-nowrap text-ui-meta leading-4">/);
  assert.match(
    history,
    /<span className="line-clamp-2 min-w-0 break-words text-ui-heading font-semibold" title=\{job\.sourceTitle\}\s*>\{job\.sourceTitle\}<\/span>/,
  );
});

test("navigation and Drive backup use standard Button and Switch components", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const nav = await readSource(new URL("../components/side-panel-navigation.tsx", import.meta.url));
  assert.match(nav, /<Button variant="ghost" size="sm"/);
  assert.match(nav, /aria-current=/);
  assert.match(app, /<RequestBackupSwitch/);
  const backup = await readSource(
    new URL("../components/request-backup-switch.tsx", import.meta.url),
  );
  assert.match(backup, /<Switch .*checked=\{enabled\}/);
  assert.doesNotMatch(nav, /bg-card!|hover:bg-transparent|shadow-\[/);
});
