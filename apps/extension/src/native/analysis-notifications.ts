import { customContentCopy } from "../i18n/custom-content";
import { translate, type UiLocale } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { PreferencesStore } from "../lib/preferences-store";
import { getBrowserLocale, isLocalePreference } from "../i18n/preferences";

export type LessonNotificationOutcome = "completed" | "interrupted" | "failed";

/** Read preferences at delivery so changes during a running job apply. */
export async function notifyLessonOutcome(
  jobId: string,
  title: string,
  outcome: LessonNotificationOutcome,
  documentId?: string,
  kind?: "standard" | "custom",
): Promise<void> {
  const saved = await new PreferencesStore(chrome.storage.local, getBrowserLocale()).load();
  if (
    (outcome === "completed"
      ? saved.analysisNotificationsEnabled
      : saved.attentionNotificationsEnabled) === false
  )
    return;
  const locale =
    isLocalePreference(saved.uiLocalePreference) && saved.uiLocalePreference !== "auto"
      ? saved.uiLocalePreference
      : getBrowserLocale();
  const ui = settingsLayoutCopy[locale];
  // Encode the destination in the ID, surviving service-worker restarts.
  const id =
    outcome === "completed" && documentId
      ? `lesson-complete:${documentId}`
      : `lesson-attention:${jobId}`;
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title:
      outcome === "completed"
        ? kind === "custom"
          ? customContentCopy(locale).created
          : translate(locale, "analysisCompleteTitle")
        : ui[outcome],
    message:
      outcome === "completed"
        ? title
          ? translate(locale, "analysisCompleteBody", { title })
          : translate(locale, "analysisCompleteTitle")
        : [title, outcome === "failed" ? ui.failedBody : ui.interruptedBody]
            .filter(Boolean)
            .join("\n"),
    buttons: [
      {
        title:
          outcome === "completed" && documentId
            ? translate(locale, "openLesson")
            : outcome === "interrupted"
              ? translate(locale, "resume")
              : ui.activity,
      },
    ],
  });
}

/** Completion and attention have independent current-format preferences. */
export async function notifyAnalysisComplete(
  jobId: string,
  title: string,
  documentId?: string,
  kind?: "standard" | "custom",
): Promise<void> {
  return notifyLessonOutcome(jobId, title, "completed", documentId, kind);
}

export async function sendTestNotification(locale: UiLocale): Promise<void> {
  await chrome.notifications.create("lesson-test", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Contextual Language Learning",
    message: settingsLayoutCopy[locale].testBody,
  });
}

export function notificationDestination(id: string): string | null {
  const match = /^(lesson-complete|lesson-attention):([0-9a-f-]{36})$/i.exec(id);
  if (!match) return null;
  return match[1] === "lesson-complete"
    ? `sidepanel.html?lesson=${encodeURIComponent(match[2])}`
    : `sidepanel.html?activity=${encodeURIComponent(match[2])}`;
}
