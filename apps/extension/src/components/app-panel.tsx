import * as React from "react";
import { cn } from "../lib/utils";
import { Card } from "./ui/card";

/** Application-level content spacing and typography.
 * Keep the shared shadcn Card's original appearance and variants untouched.
 */
export function AppPanel({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        "mb-3 min-w-0 max-w-full p-4 wrap-anywhere [&_h1]:my-2 [&_h1]:text-[21px] [&_h1]:font-[650] [&_h1]:leading-[1.35] [&_h2]:mb-[10px] [&_h2]:text-base [&_h2]:font-[650] [&_h3]:my-[18px_8px] [&_h3]:text-xs [&_h3]:font-bold [&_h3]:uppercase [&_h3]:tracking-[.05em] [&_h3]:text-muted-foreground [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:max-w-full [&_code]:overflow-x-auto",
        className,
      )}
      {...props}
    />
  );
}
