import * as React from "react";
import { XIcon } from "lucide-react";
import { Button } from "./ui/button";
import { DialogClose, DialogTitle } from "./ui/dialog";

/**
 * Compact dialog title with a localized close button on the same row.
 * The shadcn DialogContent close button is English-only and cannot be disabled
 * while work is pending, so dialogs using this set `showCloseButton={false}`.
 */
export function DialogTitleBar({
  children,
  closeLabel,
  closeDisabled = false,
}: {
  children: React.ReactNode;
  closeLabel: string;
  closeDisabled?: boolean;
}) {
  return (
    <div data-slot="dialog-title-row" className="flex min-w-0 items-center justify-between gap-2">
      <DialogTitle className="min-w-0 flex-1 text-sm leading-5 font-semibold wrap-anywhere">
        {children}
      </DialogTitle>
      <DialogClose asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={closeLabel}
          disabled={closeDisabled}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </Button>
      </DialogClose>
    </div>
  );
}
