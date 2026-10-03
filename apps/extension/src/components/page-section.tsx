import React from "react";
import { cn } from "../lib/utils";

/** Form steps can be framed; other sections retain simple dividers. */
export function PageSection({
  framed = false,
  className,
  ...props
}: React.ComponentProps<"section"> & { framed?: boolean }) {
  return (
    <section
      className={cn(
        "min-w-0 [&_h2]:mb-2 [&_h2]:text-[13px] [&_h2]:font-semibold",
        framed
          ? "rounded-[var(--radius)] border border-border p-3"
          : "border-b border-border py-6 first:pt-4 last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}
