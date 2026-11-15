/** Isolated UI acceptance fixture. No Host connection, generation or user-data writes. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { JobSummary } from "@contextual/core";
import { TaskHistory } from "../src/components/task-history";
import { Button } from "../src/components/ui/button";
import { translate, type UiLocale } from "../src/i18n/messages";
import "../src/styles.css";

const locale: UiLocale =
  new URLSearchParams(location.search).get("locale") === "en" ? "en" : "zh-TW";
const now = Date.now();
const at = new Date(now).toISOString();
const initial: JobSummary = {
  id: "db39209f-ff43-4683-9bb4-a1796895f995",
  sourceTitle: "字幕分析活動列（模擬資料）",
  provider: "antigravity",
  status: "running",
  phase: "analyzing",
  completed: 0,
  total: 10,
  createdAt: at,
  updatedAt: at,
  execution: {
    workflowVersion: "learning-points-v7-1",
    promptVersion: "learning-points-prompts-12",
    schemaVersion: "7",
    languageStrategyVersion: "learning-language-strategies-4",
    levelStrategyVersion: "learning-level-strategies-1",
    qualityStrategyVersion: "learning-quality-1",
    inputFingerprint: "a".repeat(64),
    provider: "antigravity",
    modelId: "gemini-3.7-flash",
    contextWindow: 1048576,
    maxOutputTokens: 65536,
  },
  activity: [0, 1].map(i => ({
    id: "preview-" + i,
    step: "window-" + i,
    state: "thinking",
    startedAt: new Date(now - 32000 + i * 2000).toISOString(),
    updatedAt: at,
  })),
};
const noop = () => undefined;
function Preview() {
  const [job, setJob] = useState(initial);
  return (
    <main className="mx-auto max-w-[400px] bg-background p-4 text-foreground">
      <p className="mb-4 text-xs text-muted-foreground">活動列驗收預覽 · 模擬資料</p>
      <TaskHistory
        locale={locale}
        jobs={[job]}
        loadingJobs={false}
        hostReady
        generating
        storageBusy={false}
        agentCatalog={[]}
        t={(key, params) => translate(locale, key, params)}
        onRefresh={noop}
        onResume={noop}
        onOpen={noop}
        onRetryPublication={async () => {}}
        onRetryBackup={async () => {}}
      />
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            setJob(current => ({
              ...current,
              phase: "checking",
              activity: [
                {
                  id: "quality-preview",
                  step: "s0-quality-review",
                  state: "thinking",
                  startedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }))
          }
        >
          檢查內容
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setJob(current => ({
              ...current,
              activity: current.activity?.map(call =>
                call.step === "window-1" ? { ...call, state: "writing" } : call,
              ),
            }))
          }
        >
          第二片段改為輸出
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setJob(current => ({
              ...current,
              activity: current.activity?.filter(call => call.step !== "window-0"),
            }))
          }
        >
          完成第一片段
        </Button>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
