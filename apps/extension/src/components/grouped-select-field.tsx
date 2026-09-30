import * as SelectPrimitive from "@radix-ui/react-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  encodeSelectValue, decodeSelectValue, type SelectFieldOption,
} from "./ui/select";

export type SelectFieldGroup = { label: string; options: readonly SelectFieldOption[] };

export function GroupedSelectField({ id, ariaLabel, value, onValueChange, groups, disabled }: {
  id?: string;
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  groups: readonly SelectFieldGroup[];
  disabled?: boolean;
}) {
  const selectedLabel = groups.flatMap(group => group.options)
    .find(option => String(option.value) === value)?.label;
  return <Select value={encodeSelectValue(value)}
    onValueChange={next => onValueChange(decodeSelectValue(next))} disabled={disabled}>
    <SelectTrigger id={id} aria-label={ariaLabel}><SelectValue>{selectedLabel}</SelectValue></SelectTrigger>
    <SelectContent>
      {groups.map(group => <SelectPrimitive.Group key={group.label}>
        <SelectPrimitive.Label className="px-3 py-1 text-xs font-semibold text-muted-foreground">{group.label}</SelectPrimitive.Label>
        {group.options.map(option => <SelectItem key={String(option.value)}
          value={encodeSelectValue(String(option.value))} disabled={option.disabled}>{option.label}</SelectItem>)}
      </SelectPrimitive.Group>)}
    </SelectContent>
  </Select>;
}
