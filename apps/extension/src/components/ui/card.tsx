import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn("mb-3 min-w-0 max-w-full rounded-[var(--radius)] border border-border bg-card p-4 text-card-foreground shadow-[0_1px_3px_#00000008] wrap-anywhere [&_h1]:my-2 [&_h1]:text-[21px] [&_h1]:font-[650] [&_h1]:leading-[1.35] [&_h2]:mb-[10px] [&_h2]:text-base [&_h2]:font-[650] [&_h3]:my-[18px_8px] [&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-[.05em] [&_h3]:text-muted-foreground [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:max-w-full [&_code]:overflow-x-auto", className)}
      {...props}
    />
  );
}
