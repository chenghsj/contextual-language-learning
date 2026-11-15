import React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";

export function PageHeading({
  title,
  backLabel,
  onBack,
  id,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  id?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border py-3">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={backLabel}
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Button>
      <h1 id={id} className="min-w-0 text-ui-heading font-semibold">
        {title}
      </h1>
    </div>
  );
}
