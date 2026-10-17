import { parseRangeTime } from "@contextual/core";

/** Compact UI text only; stored subtitle/range values retain their milliseconds. */
export function formatDisplayTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "";
  const tenths = Math.round(Math.max(0, milliseconds) / 100);
  const seconds = Math.floor(tenths / 10);
  const hours = Math.floor(seconds / 3600);
  const clock = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (hours) clock.unshift(hours);
  return clock.map(value => String(value).padStart(2, "0")).join(":") + "." + (tenths % 10);
}

/** Accept compact MM:SS as well as the existing HH:MM:SS, with up to three decimals. */
export function parseDisplayTime(text: string): number {
  const compact = /^(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(text);
  if (!compact) return parseRangeTime(text);
  if (Number(compact[1]) >= 60) return NaN;
  return (
    (Number(compact[1]) * 60 + Number(compact[2])) * 1000 +
    Number((compact[3] ?? "").padEnd(3, "0"))
  );
}
