import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/utils";
import { buttonVariants, destructiveOutlineClassName } from "./button";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader(props: React.ComponentProps<"div">) {
  return <div {...props} className={cn("grid gap-2 text-left", props.className)} />;
}

export function AlertDialogFooter(props: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("flex flex-wrap items-center justify-end gap-2", props.className)}
    />
  );
}

export function AlertDialogTitle(props: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      {...props}
      className={cn("text-sm font-semibold", props.className)}
    />
  );
}

export function AlertDialogDescription(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Description>,
) {
  return (
    <AlertDialogPrimitive.Description
      {...props}
      className={cn("text-xs leading-relaxed text-muted-foreground", props.className)}
    />
  );
}

export function AlertDialogCancel(props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      {...props}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "h-auto min-h-8 max-w-full whitespace-normal py-1.5",
        props.className,
      )}
    />
  );
}

export function AlertDialogAction(props: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      {...props}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        destructiveOutlineClassName,
        "h-auto min-h-8 max-w-full whitespace-normal py-1.5",
        props.className,
      )}
    />
  );
}
