import React, { useEffect, useRef, useState } from "react";
import { CustomModelIdSchema, modelCatalogLookupUrl } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { customModelCopy, modelSearchCopy } from "../i18n/custom-model";
import { piCopy } from "../i18n/pi";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion";
import { Button, buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";

export function ModelIdSettings({
  id,
  locale,
  provider,
  modelId,
  customIds,
  disabled,
  onSelect,
  onRemove,
  credentialMethod,
}: {
  id: string;
  locale: UiLocale;
  provider: string;
  modelId: string;
  customIds: string[];
  disabled: boolean;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
  credentialMethod?: "api_key" | "oauth";
}) {
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const copy = customModelCopy[locale],
    search = modelSearchCopy[locale];
  useEffect(() => {
    setOpen("");
    setDraft("");
    setError("");
  }, [provider]);
  function close() {
    setOpen("");
    setDraft("");
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function save() {
    const parsed = CustomModelIdSchema.safeParse(draft);
    if (!parsed.success) {
      setError(copy.invalid);
      return;
    }
    if (!customIds.includes(parsed.data) && customIds.length >= 50) {
      setError(copy.limit);
      return;
    }
    onSelect(parsed.data);
    close();
  }
  const lookup = modelCatalogLookupUrl(provider, credentialMethod);
  return (
    <div
      data-ui="customModel"
      data-editing={!!open}
      onKeyDown={event => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
        <AccordionItem value="manual" className="border-0">
          <AccordionTrigger ref={trigger} className="py-2 text-ui-heading font-semibold">
            {search.advanced}
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <label htmlFor={`${id}-custom-model`} className="text-xs font-semibold">
                  {translate(locale, "modelId")}
                </label>
                {lookup && (
                  <a
                    href={lookup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      buttonVariants({ variant: "link", size: "sm" }),
                      "h-auto min-h-8 max-w-full whitespace-normal",
                    )}
                  >
                    {search.lookup}
                  </a>
                )}
              </div>
              <Input
                id={`${id}-custom-model`}
                value={draft}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={120}
                placeholder={translate(locale, "modelPlaceholder")}
                aria-invalid={!!error}
                aria-describedby={`${id}-custom-hint${error ? ` ${id}-custom-error` : ""}`}
                disabled={disabled}
                onChange={event => {
                  setDraft(event.target.value);
                  setError("");
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!disabled) save();
                  }
                }}
              />
              <p id={`${id}-custom-hint`} className="text-ui-body text-muted-foreground">
                {copy.hint}
              </p>
              {error && (
                <p id={`${id}-custom-error`} role="alert" className="text-ui-body text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !draft.trim()}
                  onClick={save}
                >
                  {copy.save}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={close}>
                  {piCopy[locale].cancel}
                </Button>
                {customIds.includes(modelId) && onRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      onRemove(modelId);
                      onSelect("");
                    }}
                  >
                    {copy.remove}
                  </Button>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
