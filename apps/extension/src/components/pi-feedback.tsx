import React from "react";
import type { UiLocale } from "../i18n/messages";
import { piFeedback, piFeedbackCopy, type PiFeedbackContext } from "../i18n/pi-feedback";

export function PiFeedback({ locale, message, context = "error" }: {
  locale: UiLocale; message: string; context?: PiFeedbackContext;
}) {
  const feedback = piFeedback(locale, message, context);
  return <div className="grid min-w-0 gap-3 text-sm leading-relaxed wrap-anywhere" data-ui="piFeedback">
    <p role="status">{feedback.message}</p>
    {feedback.detail && <details className="min-w-0 border-t border-border pt-2" open={context === "prompt"}>
      <summary className="cursor-pointer py-1 text-xs font-normal text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">{piFeedbackCopy(locale, "details")}</summary>
      <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs font-normal leading-relaxed text-muted-foreground" dir="auto">{feedback.detail}</p>
    </details>}
  </div>;
}
