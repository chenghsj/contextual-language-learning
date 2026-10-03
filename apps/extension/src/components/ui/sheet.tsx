import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export function SheetContent({
  children,
  closeLabel,
  onCloseAutoFocus,
  onInteractOutside,
  onEscapeKeyDown,
}: {
  children: React.ReactNode;
  closeLabel: string;
  onCloseAutoFocus?: (event: Event) => void;
  onInteractOutside?: React.ComponentProps<typeof DialogPrimitive.Content>["onInteractOutside"];
  onEscapeKeyDown?: React.ComponentProps<typeof DialogPrimitive.Content>["onEscapeKeyDown"];
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-border bg-background shadow-xl outline-none"
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={onInteractOutside}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
          {children}
        </div>
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
