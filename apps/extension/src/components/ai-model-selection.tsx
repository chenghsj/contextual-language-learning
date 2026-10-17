import React from "react";
import type { AgentInfo, AgentModel, ThinkingLevel } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { thinkingCopy } from "../i18n/thinking";
import { piCopy } from "../i18n/pi";
import { SelectField } from "./ui/select";
import { SearchableSelectField } from "./searchable-select-field";
import { PiFeedback } from "./pi-feedback";
import { Button } from "./ui/button";
import { RefreshCw } from "lucide-react";
import { IconTooltip } from "./icon-tooltip";
import { modelAvailabilityCopy } from "../i18n/model-availability";

export function AiModelSelection({
  locale,
  id,
  provider,
  modelId,
  providers,
  models,
  available,
  busy,
  notice,
  warning = "",
  onProvider,
  onModel,
  onRefresh,
  thinkingLevel,
  onThinking,
  request = false,
}: {
  locale: UiLocale;
  id: string;
  provider: string;
  modelId: string;
  providers: AgentInfo[];
  models: AgentModel[];
  available: boolean;
  busy: boolean;
  notice: string;
  warning?: string;
  onProvider: (id: string) => void;
  onModel: (id: string) => void;
  onRefresh: () => void;
  thinkingLevel?: ThinkingLevel;
  onThinking?: (level: ThinkingLevel | undefined) => void;
  request?: boolean;
}) {
  const ui = piCopy[locale];
  const availabilityCopy = modelAvailabilityCopy[locale];
  const connected = providers.filter(item => item.installed);
  const selected = connected.some(item => item.id === provider);
  const thinking = thinkingCopy[locale];
  const usable = models.filter(item => !item.disabled);
  const currentModel = modelId ? models.find(item => item.id === modelId) : usable[0];
  const levels = currentModel?.thinkingLevels ?? [];
  const missing = !!modelId && !currentModel;
  const stale = !!modelId && (!currentModel || currentModel.disabled);
  return (
    <div
      className={request ? "grid min-w-0 gap-2" : "my-3 grid min-w-0 gap-2"}
      data-ui="aiModelSelection"
    >
      {!request && (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-service`} className="text-xs font-semibold">
            {ui.title}
          </label>
          <SearchableSelectField
            id={`${id}-service`}
            ariaLabel={ui.title}
            value={provider}
            disabled={!available || !connected.length}
            onValueChange={onProvider}
            copy={{ search: ui.searchServices, empty: ui.noResults, placeholder: ui.choose }}
            options={[
              ...(!selected && provider
                ? [
                    {
                      value: provider,
                      label: `${providers.find(item => item.id === provider)?.label ?? provider} · ${ui.disconnected}`,
                      disabled: true,
                    },
                  ]
                : []),
              ...connected.map(item => ({ value: item.id, label: item.label })),
            ]}
          />
        </div>
      )}
      {selected && (
        <div className={request ? "grid gap-2" : "grid gap-1.5"}>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${id}-model`} className="text-xs font-semibold">
              {ui.model}
            </label>
            {request && (
              <IconTooltip label={busy ? ui.loading : ui.refresh}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={!available || busy}
                  aria-label={busy ? ui.loading : ui.refresh}
                  aria-busy={busy}
                  onClick={onRefresh}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      busy ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"
                    }
                  />
                </Button>
              </IconTooltip>
            )}
          </div>
          <SelectField
            id={`${id}-model`}
            ariaLabel={ui.model}
            value={modelId}
            disabled={!available || busy || !models.length || !!notice}
            onValueChange={onModel}
            options={[
              { value: "", label: ui.automatic, disabled: !usable.length },
              ...(missing
                ? [
                    {
                      value: modelId,
                      label:
                        notice || warning
                          ? modelId
                          : `${modelId} · ${availabilityCopy.unavailable}`,
                      disabled: true,
                    },
                  ]
                : []),
              ...models.map(item => ({
                value: item.id,
                label: item.disabled
                  ? `${item.label} · ${availabilityCopy.unavailable}`
                  : item.label,
                disabled: item.disabled,
              })),
            ]}
          />
          {onThinking && (levels.some(level => level !== "off") || !!thinkingLevel) && (
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-thinking`} className="text-xs font-semibold">
                {thinking.title}
              </label>
              <SelectField
                id={`${id}-thinking`}
                ariaLabel={thinking.title}
                value={thinkingLevel ?? ""}
                disabled={
                  !available || busy || !currentModel || !!currentModel.disabled || !!notice
                }
                onValueChange={value => onThinking(value ? (value as ThinkingLevel) : undefined)}
                options={[
                  { value: "", label: thinking.automatic },
                  ...(thinkingLevel && !levels.includes(thinkingLevel)
                    ? [{ value: thinkingLevel, label: thinking[thinkingLevel], disabled: true }]
                    : []),
                  ...levels.map(level => ({ value: level, label: thinking[level] })),
                ]}
              />
            </div>
          )}
          {stale && !busy && !notice && !warning && (
            <p className="text-xs text-muted-foreground" role="status">
              {ui.stale}
            </p>
          )}
          {available &&
            !busy &&
            !notice &&
            (!stale || !!warning) &&
            (currentModel || !!warning) &&
            provider === "antigravity" && (
              <p
                className="text-xs text-muted-foreground"
                role="status"
                data-ui="modelAvailability"
              >
                {!warning && currentModel?.availability === "listed"
                  ? availabilityCopy.listed
                  : availabilityCopy.unknown}
              </p>
            )}
          {available && !busy && !notice && !usable.length && (
            <p className="text-xs text-muted-foreground" role="status">
              {ui.noChatModels}
            </p>
          )}
          {notice && <PiFeedback locale={locale} message={notice} context="models" />}
          {!notice && warning && (
            <PiFeedback locale={locale} message={warning} context="modelRefresh" />
          )}
          {!request && (
            <Button
              variant="ghost"
              size="sm"
              className="w-fit justify-self-start"
              disabled={!available || busy}
              aria-busy={busy}
              aria-live="polite"
              onClick={onRefresh}
            >
              {busy && (
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                />
              )}
              {busy ? ui.loading : ui.refresh}
            </Button>
          )}
        </div>
      )}
      {!selected && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.empty}
        </p>
      )}
    </div>
  );
}
