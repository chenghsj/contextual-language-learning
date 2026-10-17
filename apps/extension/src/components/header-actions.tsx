import React from "react";
import { ExternalLink, History, Settings2 } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { createFlowCopy } from "../i18n/create-flow";
import { activityCopy } from "../i18n/activity";
import { layoutText } from "../i18n/side-panel-layout";
import { Button } from "./ui/button";
import { IconTooltip } from "./icon-tooltip";
import type { SidePanelPage } from "./side-panel-navigation";

export function HeaderActions({
  locale,
  page,
  runningCount = 0,
  queuedCount = 0,
  onActivity,
  onSettings,
  onOpenWebReader,
}: {
  locale: UiLocale;
  page: SidePanelPage;
  runningCount?: number;
  queuedCount?: number;
  onActivity: () => void;
  onSettings: () => void;
  onOpenWebReader?: () => void;
}) {
  const ui = settingsLayoutCopy[locale];
  const activity = activityCopy[locale];
  const activeCount = runningCount + queuedCount;
  const activityLabel = [
    ui.activity,
    runningCount ? layoutText(activity.runningCount, { count: runningCount }) : "",
    queuedCount ? layoutText(activity.queuedCount, { count: queuedCount }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex shrink-0 items-center">
      {onOpenWebReader && (
        <IconTooltip label={createFlowCopy(locale).web}>
          <Button
            id="header-web-reader"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={createFlowCopy(locale).web}
            onClick={onOpenWebReader}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        </IconTooltip>
      )}
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
              className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-primary px-0.5 text-[10px] font-semibold leading-[14px] text-primary-foreground tabular-nums"
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
