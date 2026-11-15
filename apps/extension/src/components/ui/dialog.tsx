export * from "@contextual/ui/dialog";
import React, { type ComponentProps } from "react";
import {
  DialogTitle as SharedDialogTitle,
  DialogDescription as SharedDialogDescription,
} from "@contextual/ui/dialog";
import { cn } from "../../lib/utils";

export function DialogTitle({ className, ...props }: ComponentProps<typeof SharedDialogTitle>) {
  return (
    <SharedDialogTitle className={cn("text-ui-heading font-semibold", className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof SharedDialogDescription>) {
  return <SharedDialogDescription className={cn("text-ui-body", className)} {...props} />;
}
