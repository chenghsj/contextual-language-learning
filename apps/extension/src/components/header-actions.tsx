import React from "react";
import { History, Settings2 } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { activityCopy } from "../i18n/activity";
import { speechDownloadTaskText } from "../i18n/speech-download-task";
import { layoutText } from "../i18n/side-panel-layout";
import { Button } from "./ui/button";
import { IconTooltip } from "./icon-tooltip";
import type { SidePanelPage } from "./side-panel-navigation";

export function HeaderActions({
  locale,
  page,
  runningCount = 0,
  queuedCount = 0,
  downloadActiveCount = 0,
  onActivity,
  onSettings,
}: {
  locale: UiLocale;
  page: SidePanelPage;
  runningCount?: number;
  queuedCount?: number;
  downloadActiveCount?: number;
  onActivity: () => void;
  onSettings: () => void;
}) {
  const ui = settingsLayoutCopy[locale];
  const activity = activityCopy[locale];
  const activeCount = runningCount + queuedCount + downloadActiveCount;
  const activityLabel = [
    ui.activity,
    runningCount ? layoutText(activity.runningCount, { count: runningCount }) : "",
    queuedCount ? layoutText(activity.queuedCount, { count: queuedCount }) : "",
    downloadActiveCount
      ? speechDownloadTaskText(locale, "activeCount", {
          count: downloadActiveCount,
        })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex shrink-0 items-center">
      <IconTooltip label={activityLabel}>
        <Button
          id="header-activity"
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={activityLabel}
          aria-pressed={page === "activity"}
          onClick={onActivity}
        >
          <History className="size-4" aria-hidden="true" />
          {activeCount > 0 && (
            <span
              data-ui="activity-count"
              className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-primary px-0.5 text-ui-meta font-semibold text-primary-foreground tabular-nums"
              aria-hidden="true"
            >
              {activeCount > 9 ? "9+" : activeCount}
            </span>
          )}
        </Button>
      </IconTooltip>
      <IconTooltip label={translate(locale, "settings")}>
        <Button
          id="header-settings"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={translate(locale, "settings")}
          aria-pressed={page === "settings"}
          onClick={onSettings}
        >
          <Settings2 className="size-4" aria-hidden="true" />
        </Button>
      </IconTooltip>
    </div>
  );
}
