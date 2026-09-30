import React from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";

/** Viewport feedback stays visible while a reader scrolls inside the Side Panel. */
export function NoticeViewport({ error, notice, dismiss, closeLabel }: {
  error: string;
  notice: string;
  dismiss: () => void;
  closeLabel: string;
}) {
  if (!error && !notice) return null;
  return <div className="pointer-events-none sticky top-2 z-[100] mx-auto mb-3 max-w-[750px]" aria-live={error ? "assertive" : "polite"}>
    <div className={"pointer-events-auto flex max-w-full min-w-0 items-start justify-between gap-[10px] rounded-[var(--radius)] border bg-card px-3 py-[10px] text-xs text-foreground shadow-lg wrap-anywhere " +
      (error ? "border-[color-mix(in_oklch,var(--destructive)_55%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_10%,var(--card))]" : "border-border")}
      role={error ? "alert" : "status"}>
      <span>{error || notice}</span><Button variant="ghost" size="icon" className="shrink-0"
        aria-label={closeLabel} onClick={dismiss}><X aria-hidden="true" /></Button>
    </div>
  </div>;
}
