import React from "react";
import { History, Settings2 } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import { Button } from "./ui/button";
import { IconTooltip } from "./icon-tooltip";
import type { SidePanelPage } from "./side-panel-navigation";

export function HeaderActions({
  locale,
  page,
  attentionCount,
  onActivity,
  onSettings,
}: {
  locale: UiLocale;
  page: SidePanelPage;
  attentionCount: number;
  onActivity: () => void;
  onSettings: () => void;
}) {
  const ui = settingsLayoutCopy[locale];
  return (
    <div className="flex shrink-0 items-center">
      <IconTooltip
        label={
          attentionCount ? `${ui.activity} · ${ui.needsAttention} (${attentionCount})` : ui.activity
        }
      >
        <Button
          id="header-activity"
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={ui.activity}
          aria-pressed={page === "activity"}
          onClick={onActivity}
        >
          <History className="size-4" aria-hidden="true" />
          {attentionCount > 0 && (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
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
