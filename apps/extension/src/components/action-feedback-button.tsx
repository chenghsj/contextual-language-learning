import React, { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { ComponentProps } from "react";

/** Keep transient action feedback inside its action without shifting nearby controls. */
export function ActionFeedbackButton({
  label,
  busyLabel,
  successLabel,
  busy,
  success,
  disabled,
  onClick,
  className,
  variant = "outline",
  feedbackKey,
  "data-ui": dataUi = "action-feedback-button",
}: {
  label: string;
  busyLabel: string;
  successLabel?: string;
  busy: boolean;
  success: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  feedbackKey?: string | number;
  "data-ui"?: string;
}) {
  const [showSuccess, setShowSuccess] = useState(false);
  useEffect(() => {
    setShowSuccess(success && !busy);
    if (!success || busy) return;
    const timer = window.setTimeout(() => setShowSuccess(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [success, busy, feedbackKey]);

  const state = busy ? "busy" : successLabel && success && showSuccess ? "success" : "idle";
  const content = {
    idle: <>{label}</>,
    busy: (
      <>
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
        {busyLabel}
      </>
    ),
    success: successLabel ? (
      <>
        <Check aria-hidden="true" />
        {successLabel}
      </>
    ) : null,
  };
  return (
    <Button
      variant={variant}
      size="sm"
      className={cn("h-auto min-h-8 whitespace-normal", className)}
      data-ui={dataUi}
      data-state={state}
      disabled={disabled || busy}
      aria-label={label}
      aria-busy={busy}
      onClick={onClick}
    >
      <span className="inline-grid min-w-0">
        {Object.entries(content)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => (
            <span
              key={key}
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 flex items-center justify-center gap-1.5"
            >
              {value}
            </span>
          ))}
        <span
          className="col-start-1 row-start-1 flex items-center justify-center gap-1.5"
          aria-live="polite"
          aria-atomic="true"
        >
          {content[state]}
        </span>
      </span>
    </Button>
  );
}
