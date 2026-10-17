import React, { useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { CreateFlow } from "../hooks/use-create-flow";
import { useContentMotion } from "../hooks/use-content-motion";
import { createFlowCopy } from "../i18n/create-flow";
import { customContentCopy } from "../i18n/custom-content";
import { activityCopy } from "../i18n/activity";
import { translate, type UiLocale } from "../i18n/messages";
import { Button } from "./ui/button";
import { IconTooltip } from "./icon-tooltip";

/** Create navigation and scrolling stay mounted while another application page is shown. */
export function CreateFrame({
  create,
  locale,
  active,
  preview,
  canSubmit,
  checking,
  submitting,
  activeJobCount,
  onSubmit,
  children,
}: {
  create: CreateFlow;
  locale: UiLocale;
  active: boolean;
  preview: ReactNode;
  canSubmit: boolean;
  checking: boolean;
  submitting: boolean;
  activeJobCount: number;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { createStep, completedStep, subtitlePreview } = create.state;
  const { allowedStep, draft: createDraft, lastSettings } = create;
  const ux = createFlowCopy(locale),
    customUi = customContentCopy(locale);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const formScroll = useRef<HTMLDivElement>(null);
  useContentMotion(formScroll, `${createStep}:${subtitlePreview}`, {
    active: active && !subtitlePreview,
    depth: createStep + (subtitlePreview ? 0.5 : 0),
    entryDuration: 180,
    duration: 200,
    directional: true,
  });
  return (
    <main
      hidden={!active}
      id="page-panel-create"
      aria-labelledby="page-nav-create"
      className="mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col hidden:!hidden"
    >
      {preview}
      <nav
        hidden={subtitlePreview}
        aria-label={customUi.create}
        data-ui="create-steps"
        className="shrink-0 pb-1"
      >
        <ol className="grid grid-cols-3 gap-1">
          {[ux.video, ux.settings, ux.create].map((label, index) => (
            <li key={index} className="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-h-9 min-w-0 flex-1 gap-2 whitespace-normal px-1 text-xs"
                aria-current={createStep === index ? "step" : undefined}
                disabled={index > Math.min(completedStep, allowedStep)}
                onClick={() => create.goTo(index)}
              >
                <span
                  aria-hidden="true"
                  className={
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums " +
                    (createStep === index
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground")
                  }
                >
                  {index + 1}
                </span>
                <span
                  data-ui="create-step-label"
                  className={createStep === index ? "font-semibold" : "font-normal"}
                >
                  {label}
                </span>
              </Button>
              {index < 2 && (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div
        ref={formScroll}
        data-ui="create-scroll"
        hidden={subtitlePreview}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-3"
      >
        {children}
      </div>
      <footer
        data-ui="create-footer"
        hidden={subtitlePreview}
        className="flex hidden:!hidden shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-background py-3 pb-[max(12px,env(safe-area-inset-bottom))]"
      >
        {createStep > 0 && (
          <Button variant="ghost" onClick={() => create.goTo(createStep - 1)}>
            {customUi.previous}
          </Button>
        )}
        {createStep === 0 && lastSettings && (
          <IconTooltip label={ux.quick} side="top">
            <Button
              variant="outline"
              size="sm"
              aria-label={ux.quick}
              className="h-9"
              disabled={!create.canQuickCreate}
              onClick={create.quickCreate}
            >
              {ux.quickAction}
            </Button>
          </IconTooltip>
        )}
        {createStep < 2 ? (
          <Button
            className="ml-auto shrink-0"
            disabled={!createDraft.ready || createStep >= allowedStep}
            onClick={() => {
              create.next();
              formScroll.current?.scrollTo(0, 0);
            }}
          >
            {customUi.next}
          </Button>
        ) : (
          <Button
            className="h-auto min-h-9 px-3 py-2 text-center text-xs font-semibold leading-[1.4] whitespace-normal wrap-anywhere"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {checking && (
              <span
                className="inline-block size-[14px] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {submitting
              ? ux.queuing
              : checking
                ? t("checkingExistingShort")
                : activeJobCount > 0
                  ? activityCopy[locale].addToQueue
                  : t("create")}
          </Button>
        )}
      </footer>
    </main>
  );
}
