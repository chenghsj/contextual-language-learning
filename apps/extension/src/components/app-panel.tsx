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
        "mb-3 min-w-0 max-w-full p-4 wrap-anywhere [&_h1]:my-2 [&_h1]:text-ui-heading [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-ui-heading [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:text-ui-heading [&_h3]:font-semibold [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:max-w-full [&_code]:overflow-x-auto",
        className,
      )}
      {...props}
    />
  );
}
