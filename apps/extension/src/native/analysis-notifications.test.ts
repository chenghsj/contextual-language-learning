import assert from "node:assert/strict";
import test from "node:test";
import { defaultPreferences } from "../lib/preferences-store";
import { notifyAnalysisComplete } from "./analysis-notifications";

test("completion notifications follow all five UI locales and the saved switch", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  let saved: Record<string, unknown> = {};
  const sent: { title: string; message: string }[] = [];
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: { get: async () => ({ preferencesV2: { ...defaultPreferences("en"), ...saved } }) },
      },
      runtime: { getURL: (path: string) => path },
      i18n: { getUILanguage: () => "ja" },
      notifications: {
        create: async (_id: string, copy: { title: string; message: string }) => {
          sent.push(copy);
        },
      },
    },
  });
  try {
    for (const [locale, title] of Object.entries({
      en: "Lesson created",
      "zh-TW": "教材建立完成",
      "zh-CN": "教材建立完成",
      ja: "教材が作成されました",
      ko: "교재 생성 완료",
    })) {
      saved = { uiLocalePreference: locale };
      await notifyAnalysisComplete("job", "Original video title");
      assert.equal(sent.at(-1)?.title, title);
      assert.ok(sent.at(-1)?.message.includes("Original video title"));
    }
    saved = { uiLocalePreference: "auto" };
    await notifyAnalysisComplete("job", "Video");
    assert.equal(sent.at(-1)?.title, "教材が作成されました");
    saved = { analysisNotificationsEnabled: false };
    await notifyAnalysisComplete("job", "Video");
    assert.equal(sent.length, 6);
  } finally {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});

test("completion and attention preferences are independent; test notification bypasses both", async () => {
  const { notifyLessonOutcome, sendTestNotification, notificationDestination } =
    await import("./analysis-notifications");
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const sent: string[] = [];
  let saved = {
    analysisNotificationsEnabled: false,
    attentionNotificationsEnabled: true,
    uiLocalePreference: "zh-TW",
  };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: { get: async () => ({ preferencesV2: { ...defaultPreferences("en"), ...saved } }) },
      },
      runtime: { getURL: (path: string) => path },
      notifications: { create: async (id: string) => sent.push(id) },
    },
  });
  const id = "00000000-0000-4000-8000-000000000001";
  try {
    await notifyLessonOutcome(id, "Video", "completed", id);
    await notifyLessonOutcome(id, "Video", "failed");
    assert.deepEqual(sent, [`lesson-attention:${id}`]);
    saved = { ...saved, analysisNotificationsEnabled: true, attentionNotificationsEnabled: false };
    await notifyLessonOutcome(id, "Video", "interrupted");
    await notifyLessonOutcome(id, "Video", "completed", id);
    await sendTestNotification("zh-TW");
    assert.deepEqual(sent, [`lesson-attention:${id}`, `lesson-complete:${id}`, "lesson-test"]);
    assert.equal(notificationDestination(sent[0]), `sidepanel.html?activity=${id}`);
    assert.equal(notificationDestination(sent[1]), `sidepanel.html?lesson=${id}`);
    assert.equal(notificationDestination("lesson-test"), null);
    assert.equal(notificationDestination("lesson-complete:../../other"), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});

test("custom completion uses localized content wording and a durable viewer destination", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const sent: { id: string; title: string }[] = [];
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async () => ({
            preferencesV2: { ...defaultPreferences("zh-TW"), uiLocalePreference: "zh-TW" },
          }),
        },
      },
      runtime: { getURL: (path: string) => path },
      notifications: {
        create: async (id: string, copy: { title: string }) => sent.push({ id, title: copy.title }),
      },
    },
  });
  try {
    const id = "00000000-0000-4000-8000-000000000001";
    await notifyAnalysisComplete(id, "Custom notes", id, "custom");
    assert.deepEqual(sent, [{ id: `lesson-complete:${id}`, title: "內容建立完成" }]);
  } finally {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
