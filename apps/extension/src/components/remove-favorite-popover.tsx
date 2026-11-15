import React, { useId, useRef } from "react";
import type { UiLocale } from "../i18n/messages";
import { favoritesCopy } from "../i18n/favorites";
import { IconTooltip, restoreFocusWithoutTooltip } from "./icon-tooltip";
import { Button, destructiveOutlineClassName } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function RemoveFavoritePopover({
  locale,
  title,
  open,
  onOpenChange,
  onConfirm,
  triggerLabel,
  className,
  children,
}: {
  locale: UiLocale;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  triggerLabel: string;
  className?: string;
  children: React.ReactElement;
}) {
  const copy = favoritesCopy(locale);
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreTrigger = useRef(false);
  function dismiss() {
    restoreTrigger.current = true;
    onOpenChange(false);
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <span className={"inline-flex shrink-0 " + (className ?? "")}>
        <IconTooltip label={triggerLabel}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        </IconTooltip>
      </span>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-60 max-w-[calc(100vw-24px)] space-y-3 rounded-xl p-3"
        aria-labelledby={id + "-title"}
        aria-describedby={id + "-description"}
        onOpenAutoFocus={() => {
          restoreTrigger.current = false;
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onEscapeKeyDown={() => {
          restoreTrigger.current = true;
        }}
        onCloseAutoFocus={event => {
          if (restoreTrigger.current) {
            event.preventDefault();
            restoreFocusWithoutTooltip(
              returnFocus.current?.isConnected ? returnFocus.current : null,
            );
          }
        }}
      >
        <h3 id={id + "-title"} className="text-ui-heading font-semibold">
          {copy.confirmRemove}
        </h3>
        <span id={id + "-description"} className="sr-only">
          {title}
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal"
            onClick={dismiss}
          >
            {copy.keep}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={`${destructiveOutlineClassName} h-auto min-h-8 whitespace-normal`}
            onClick={() => {
              dismiss();
              onConfirm();
            }}
          >
            {copy.removeAction}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
