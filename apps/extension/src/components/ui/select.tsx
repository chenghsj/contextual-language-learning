import * as React from "react";
import { cn } from "../../lib/utils";

// Native select retains keyboard accessibility and is styled to match the shadcn form fields.
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn("flex h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50", className)}
      {...props}
    />
  );
}
