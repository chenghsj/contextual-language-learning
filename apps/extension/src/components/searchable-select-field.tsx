import React, { useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { filterSearchableOptions, type SearchableOption } from "../lib/searchable-options";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";

/** shadcn's Popover + Command combobox, with localized language search. */
export function SearchableSelectField({
  id,
  ariaLabel,
  value,
  onValueChange,
  options,
  copy,
  disabled,
  className,
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly (SearchableOption & { description?: string; disabled?: boolean })[];
  copy: { search: string; empty: string; placeholder?: string };
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const selectedLabel = options.find(option => option.value === value)?.label ?? value;
  return (
    <Popover
      modal={false}
      open={open && !disabled}
      onOpenChange={next => {
        // Keep the popup inside its dialog's scroll-lock boundary.
        if (next)
          setPortalContainer(trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          id={id}
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open && !disabled}
          disabled={disabled}
          className={cn("w-full min-w-0 justify-between", className)}
        >
          <span className="truncate">{selectedLabel || copy.placeholder}</span>
          <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="start"
        collisionPadding={8}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] p-0"
      >
        <Command
          filter={(optionValue, search, keywords) =>
            filterSearchableOptions(
              [{ value: optionValue, label: keywords?.[0] ?? optionValue, keywords }],
              search,
            ).length
          }
        >
          <CommandInput placeholder={copy.search} aria-label={copy.search} />
          <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-48px))]">
            <CommandEmpty>{copy.empty}</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  aria-label={option.label}
                  aria-describedby={
                    option.description ? `${descriptionId}-${option.value}` : undefined
                  }
                  disabled={option.disabled}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  className="min-h-11"
                  onSelect={next => {
                    onValueChange(next);
                    setOpen(false);
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  {option.description && (
                    <span
                      id={`${descriptionId}-${option.value}`}
                      className="shrink-0 text-xs text-muted-foreground"
                    >
                      {option.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
