import React, { useState } from "react";
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
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SearchableOption[];
  copy: { search: string; empty: string };
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(option => option.value === value)?.label ?? value;
  return (
    <Popover modal={false} open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open && !disabled}
          disabled={disabled}
          className="w-full min-w-0 justify-between"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
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
                  keywords={[option.label, ...(option.keywords ?? [])]}
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
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
