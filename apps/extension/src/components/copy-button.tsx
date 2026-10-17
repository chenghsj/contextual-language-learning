import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "./ui/button";

export function CopyButton({
  value,
  label,
  copiedLabel,
  errorLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  errorLabel: string;
}) {
  const [feedback, setFeedback] = useState<{ kind: "copied" | "error"; request: number } | null>(
    null,
  );
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setFeedback(null);
    return () => {
      revision.current++;
    };
  }, [value]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 1800);
    return () => clearTimeout(timer);
  }, [feedback]);
  async function copy() {
    const request = ++revision.current;
    try {
      await navigator.clipboard.writeText(value);
      if (revision.current === request) setFeedback({ kind: "copied", request });
    } catch {
      if (revision.current === request) setFeedback({ kind: "error", request });
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      title={feedback?.kind === "error" ? errorLabel : undefined}
      aria-label={feedback?.kind === "error" ? `${label}: ${errorLabel}` : label}
      className="relative"
    >
      <span className={feedback ? "invisible" : undefined} aria-hidden={!!feedback}>
        {label}
      </span>
      {feedback && (
        <span className="absolute inset-0 flex items-center justify-center gap-1" role="status">
          {feedback.kind === "copied" ? (
            <>
              <Check aria-hidden="true" className="size-3.5" />
              {copiedLabel}
            </>
          ) : (
            <>
              <X aria-hidden="true" className="size-3.5" />
              {label}
            </>
          )}
        </span>
      )}
    </Button>
  );
}
