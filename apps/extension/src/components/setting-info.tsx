import React from "react";
import { Info } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type SettingInfoItem = { value: string; label: string; description: string };

export function SettingInfo({
  label,
  infoLabel,
  explanation,
  items,
}: {
  label: string;
  infoLabel: string;
  explanation: string;
  items?: readonly SettingInfoItem[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={infoLabel + " " + label}
        >
          <Info aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={8}
        className="max-h-[min(340px,var(--radix-popover-content-available-height))] max-w-[calc(100vw-16px)] overflow-y-auto"
      >
        <p className="text-sm">{explanation}</p>
        {items && items.length > 0 && (
          <ul className="mt-3 grid list-none gap-2 p-0">
            {items.map(item => (
              <li key={item.value} className="border-t pt-2">
                <strong className="block text-sm">
                  {item.value} · {item.label}
                </strong>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
