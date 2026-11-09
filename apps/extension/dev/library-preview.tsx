// Development-only fixture: real library component with synthetic content and storage.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { VideoLibrary } from "../src/components/video-library";
import { translate, type UiLocale } from "../src/i18n/messages";
import type { CustomContentSummary, LessonSummary } from "@contextual/core";
import { studyProgressKey } from "../src/lib/study-progress";
import "../src/styles.css";

const params = new URLSearchParams(location.search);
const locale = (params.get("locale") ?? "zh-TW") as UiLocale;
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const title =
  "畫完這個再去死 第10話【這個世界上90%都是渣滓～想變得比嫉妒更強就需要「朋友」】｜Muse木棉花 動畫 線上看";
const localLessons: LessonSummary[] = [
  {
    documentId: "lesson-one",
    title: "畫完這個再去死 第10集：第10集",
    createdAt: "2026-10-01T00:00:00Z",
    sourceKey: "video-a",
    targetLanguage: "ja",
    level: "N3",
    schemaVersion: 7,
    sceneCount: 4,
    sceneIds: ["s1", "s2", "s3", "s4"],
    pointCount: 40,
    reusableItemCount: 30,
  },
  {
    documentId: "lesson-two",
    title,
    createdAt: "2026-10-02T00:00:00Z",
    sourceKey: "video-a",
    targetLanguage: "ja",
    level: "N3",
    schemaVersion: 5,
    sceneCount: 6,
    expressionCount: 12,
  },
  {
    documentId: "dragon",
    title: "電影版小林家的龍女僕：害怕寂寞的龍",
    createdAt: "2026-09-30T00:00:00Z",
    sourceKey: "video-b",
    targetLanguage: "ja",
    level: "N3",
    schemaVersion: 5,
    sceneCount: 6,
    sceneIds: ["s1", "s2", "s3", "s4", "s5", "s6"],
    expressionCount: 12,
  },
];
const localCustom: CustomContentSummary[] = [
  {
    kind: "custom",
    documentId: "notes",
    title: "重點筆記",
    sourceTitle: title,
    sourceKey: "video-a",
    createdAt: "2026-10-03T00:00:00Z",
  },
  {
    kind: "custom",
    documentId: "justice",
    title: "正義使者：我的英雄學院之非法英雄 第18集：歸來之男",
    sourceTitle: "正義使者：我的英雄學院之非法英雄 第18集：歸來之男",
    sourceKey: "video-c",
    createdAt: "2026-10-02T00:00:00Z",
  },
];
const saved = {
  [studyProgressKey("lesson-one")]: { sceneId: "s1", visitedSceneIds: ["s1"] },
  [studyProgressKey("dragon")]: { sceneId: "s1", visitedSceneIds: ["s1"] },
};
Object.assign(globalThis, {
  chrome: {
    storage: {
      local: { get: async () => saved },
      onChanged: { addListener() {}, removeListener() {} },
    },
  },
});
const acceptance = {
  opened: [] as string[],
  restored: [] as string[],
  refreshed: 0,
  reconnected: 0,
  deleted: [] as string[],
  deleteFailures: params.get("delete") === "fail" ? 1 : 0,
};
const catalogError =
  params.get("error") === "auth"
    ? "Google OAuth Token 交換失敗（HTTP 400，invalid_grant）。授權碼可能已失效或被使用，請重新連結 Google 帳號。"
    : params.get("error") === "generic"
      ? "Simulated catalog read failure: " + "diagnostic-".repeat(30)
      : "";
Object.assign(window, { acceptance });
function Preview() {
  const [lessons, setLessons] = useState(localLessons);
  const [custom, setCustom] = useState(localCustom);
  return (
    <main className="mx-auto max-w-3xl p-4">
      <VideoLibrary
        localLessons={lessons}
        cloudLessons={[]}
        localCustom={custom}
        cloudCustom={[
          { ...localCustom[0], accountId: "drive", url: "https://example.com/notes" },
          {
            kind: "custom",
            documentId: "cloud",
            title: "雲端摘要",
            sourceTitle: title,
            sourceKey: "video-a",
            createdAt: "2026-10-01T00:00:00Z",
            accountId: "drive",
            url: "https://example.com/cloud",
          },
        ]}
        driveAccounts={[
          {
            id: "drive",
            email: "language.learning.secondary.account.with.a.long.name@example.test",
          },
        ]}
        driveConfigured={false}
        lessonsBusy={false}
        catalogError={catalogError}
        catalogErrorAccountId={params.get("error") === "auth" ? "drive" : undefined}
        restoreBusy={null}
        generating={false}
        storageBusy={false}
        uiLocale={locale}
        t={(key, values) => translate(locale, key, values)}
        onRefresh={() => {
          acceptance.refreshed++;
        }}
        onConnectDrive={async () => {
          acceptance.reconnected++;
          await new Promise(resolve => setTimeout(resolve, 200));
          if (params.get("reconnect") === "fail") throw new Error("Simulated reconnect failure");
        }}
        onOpen={id => acceptance.opened.push(id)}
        onOpenCustom={id => acceptance.opened.push(id)}
        onRestore={async item => {
          acceptance.restored.push(item.documentId);
        }}
        onRestoreCustom={async item => {
          acceptance.restored.push(item.documentId);
        }}
        onDeleteLocal={async (id, kind) => {
          acceptance.deleted.push(id);
          if (params.get("delete") === "unsupported")
            throw new Error("Invalid request: Invalid discriminator value. Expected 'listLessons'");
          await new Promise(resolve => setTimeout(resolve, 250));
          if (acceptance.deleteFailures-- > 0) throw new Error("Simulated deletion failure");
          if (kind === "custom") setCustom(items => items.filter(item => item.documentId !== id));
          else setLessons(items => items.filter(item => item.documentId !== id));
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
