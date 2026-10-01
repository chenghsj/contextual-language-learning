import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { SidePanelNavigation, type SidePanelPage } from "../components/side-panel-navigation";
import { TaskHistory } from "../components/task-history";
import { VideoLibrary } from "../components/video-library";
import { translate } from "./messages";

function render(page: SidePanelPage): string {
  return renderToStaticMarkup(<SidePanelNavigation page={page} onNavigate={() => undefined}
    t={key => translate("zh-TW", key)} />);
}

test("two primary navigation items keep reader within Library and secondary pages use the full panel", () => {
  for (const page of ["create", "lessons", "settings", "activity", "lesson"] as const) {
    const html = render(page);
    assert.equal((html.match(/<button\b/g) ?? []).length, page === "settings" || page === "activity" ? 0 : 2);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, page === "settings" || page === "activity" ? 0 : 1);
  }
  const detail = render("lesson");
  assert.match(detail, /aria-current="page"[^>]*>.*我的教材/s);
  assert.doesNotMatch(detail, /grid-cols-4/);
});

test("each navigation action selects its page and reader detail returns to Library", () => {
  const selected: SidePanelPage[] = [];
  const nav = SidePanelNavigation({ page: "lesson", onNavigate: page => selected.push(page),
    t: key => translate("zh-TW", key) });
  assert.ok(nav);
  const list = nav.props.children as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement<{ onClick: () => void; "aria-current"?: string }> }>[] }>;
  assert.equal(list.props.children[1].props.children.props["aria-current"], "page");
  for (const item of list.props.children) item.props.children.props.onClick();
  assert.deepEqual(selected, ["create", "lessons"]);
});

test("Library exposes lessons; Activity owns the full history and resume actions", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /page === "activity" && <main/);
  assert.match(app, /hidden=\{page !== "lessons"\}/);
  assert.match(app, /page === "lesson" && <main/);
  const tasks = await readFile(new URL("../components/task-history.tsx", import.meta.url), "utf8");
  const videos = await readFile(new URL("../components/video-library.tsx", import.meta.url), "utf8");
  assert.match(tasks, /onResume\(job\.id\)/);
  assert.match(videos, /onOpen\(lesson\.documentId\)/);
  assert.match(app, /onClick=\{\(\) => setPage\("lessons"\)\}/);
});

test("Library screen renders a recoverable task and an openable grouped V4 lesson", () => {
  const now = "2026-09-28T00:00:00.000Z";
  const id = "00000000-0000-4000-8000-000000000001";
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate("zh-TW", key, params);
  const tasks = renderToStaticMarkup(<TaskHistory jobs={[{
    id, sourceTitle: "Synthetic dialogue", provider: "openai",
    status: "waiting", completed: 2, total: 4, createdAt: now, updatedAt: now,
  }]} loadingJobs={false} hostReady={true} generating={false} storageBusy={false}
    agentCatalog={[{ id: "openai", label: "OpenAI", installed: true, supportsAccountProfiles: false }]} t={t} onRefresh={() => undefined} onResume={() => undefined}
    onOpen={() => undefined} onRetryPublication={async () => undefined}
    onRetryBackup={async () => undefined} />);
  assert.match(tasks, /Synthetic dialogue/);
  assert.match(tasks, />繼續生成</);
  const library = renderToStaticMarkup(<VideoLibrary localLessons={[{
    documentId: id, title: "Episode one", createdAt: now, sourceKey: "source-a",
    targetLanguage: "en", level: "B1",
  }]} cloudLessons={[]} driveAccounts={[]} driveConfigured={false}
    lessonsBusy={false} catalogError="" restoreBusy={null} generating={false}
    storageBusy={false} uiLocale="zh-TW" t={t} onRefresh={() => undefined}
    onConnectDrive={async () => undefined} onOpen={() => undefined}
    onRestore={async () => undefined} />);
  assert.match(library, /Episode one/);
  assert.match(library, />開啟教材</);
});

 test("secondary pages use a concise back label and retain their navigation targets", async () => {
 const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
 assert.match(app, /<h1 id="activity-title"/);
 assert.equal((app.match(/\{layout.back\}<\/Button>/g) ?? []).length, 3);
 assert.match(app, /onClick=\{\(\) => setPage\(returnPage\)\}/);
 assert.match(app, /onClick=\{\(\) => setSettingsSection\(null\)\}/);
 assert.match(app, /\{layout.back\}<\/Button>/);
 });
