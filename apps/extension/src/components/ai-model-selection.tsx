import React from "react";
import type { AgentInfo, AgentModel, ThinkingLevel } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { thinkingCopy } from "../i18n/thinking";
import { piCopy } from "../i18n/pi";
import { SelectField } from "./ui/select";
import { PiFeedback } from "./pi-feedback";
import { Button } from "./ui/button";

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
  onProvider,
  onModel,
  onRefresh,
  thinkingLevel,
  onThinking,
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
  onProvider: (id: string) => void;
  onModel: (id: string) => void;
  onRefresh: () => void;
  thinkingLevel?: ThinkingLevel;
  onThinking?: (level: ThinkingLevel | undefined) => void;
}) {
  const ui = piCopy[locale];
  const connected = providers.filter(item => item.installed);
  const selected = connected.some(item => item.id === provider);
  const thinking = thinkingCopy[locale];
  const levels =
    (modelId ? models.find(item => item.id === modelId) : models[0])?.thinkingLevels ?? [];
  const stale = !!modelId && !models.some(item => item.id === modelId);
  return (
    <div className="my-3 grid min-w-0 gap-2" data-ui="aiModelSelection">
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-service`} className="text-xs font-semibold">
          {ui.title}
        </label>
        <SelectField
          id={`${id}-service`}
          ariaLabel={ui.title}
          value={provider}
          disabled={!available || !connected.length}
          onValueChange={onProvider}
          options={[
            { value: "", label: ui.choose, disabled: true },
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
      {selected && (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-model`} className="text-xs font-semibold">
            {ui.model}
          </label>
          <SelectField
            id={`${id}-model`}
            ariaLabel={ui.model}
            value={modelId}
            disabled={!available || busy}
            onValueChange={onModel}
            options={[
              { value: "", label: ui.automatic },
              ...(stale ? [{ value: modelId, label: modelId, disabled: true }] : []),
              ...models.map(item => ({ value: item.id, label: item.label })),
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
                disabled={!available || busy}
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
          {stale && !busy && (
            <p className="text-xs text-muted-foreground" role="status">
              {ui.stale}
            </p>
          )}
          {notice && <PiFeedback locale={locale} message={notice} context="models" />}
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
