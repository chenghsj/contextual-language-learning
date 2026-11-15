import React, { useEffect, useRef, useState } from "react";
import { LocateFixed, Minus, Pause, Play, Plus, Scan } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { unifiedPlayerMessages } from "../i18n/unified-player";
import { timingControlsCopy } from "../i18n/timing-controls";
import { formatDisplayTime, parseDisplayTime } from "../lib/time-display";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { IconTooltip } from "./icon-tooltip";

/** Formatting on blur never changes the precise value until the user edits it. */
export function TimingTimeInput({
  milliseconds,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  milliseconds: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatDisplayTime(milliseconds));
  const focused = useRef(false);
  const emitted = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!focused.current || !Object.is(emitted.current, milliseconds))
      setText(formatDisplayTime(milliseconds));
  }, [milliseconds]);
  return (
    <Input
      {...props}
      value={text}
      spellCheck={false}
      className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 text-center font-mono tabular-nums focus-visible:ring-inset"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={event => {
        setText(event.target.value);
        emitted.current = parseDisplayTime(event.target.value);
        onChange(emitted.current);
      }}
      onBlur={() => {
        focused.current = false;
        emitted.current = undefined;
        if (Number.isFinite(milliseconds)) setText(formatDisplayTime(milliseconds));
      }}
    />
  );
}

export function TimingPositionControl({
  locale,
  currentMs,
  playing,
  seekDisabled,
  toggleDisabled,
  onSeek,
  onToggle,
}: {
  locale: UiLocale;
  currentMs: number | null;
  playing: boolean;
  seekDisabled: boolean;
  toggleDisabled: boolean;
  onSeek: (delta: number) => void;
  onToggle: () => void;
}) {
  const copy = unifiedPlayerMessages[locale];
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"
      data-ui="timing-position"
    >
      <div className="min-w-0">
        <p className="text-ui-label text-muted-foreground">{copy.current}</p>
        <p className="mt-1 font-mono text-ui-body font-medium tabular-nums">
          {currentMs === null ? "—" : formatDisplayTime(currentMs)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 tabular-nums"
          aria-label={copy.back}
          disabled={seekDisabled}
          onClick={() => onSeek(-1000)}
        >
          −1s
        </Button>
        <Button
          size="icon"
          className="rounded-full"
          aria-label={playing ? copy.pause : copy.play}
          disabled={toggleDisabled}
          onClick={onToggle}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 tabular-nums"
          aria-label={copy.forward}
          disabled={seekDisabled}
          onClick={() => onSeek(1000)}
        >
          +1s
        </Button>
      </div>
    </div>
  );
}

/** The same boundary layout for source subtitles and reader playback ranges. */
export function TimingBoundaryField({
  label,
  htmlFor,
  children,
  captureLabel,
  captureDisabled,
  onCapture,
  nudgeDisabled,
  onNudge,
  preview,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  captureLabel: string;
  captureDisabled: boolean;
  onCapture: () => void;
  nudgeDisabled: (delta: number) => boolean;
  onNudge: (delta: number) => void;
  preview?: { label: string; disabled: boolean; onClick: () => void };
}) {
  return (
    <div role="group" aria-label={label} className="grid min-w-0 gap-1" data-ui="timing-boundary">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label htmlFor={htmlFor} className="text-ui-label font-semibold">
          {label}
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-8 max-w-full gap-2 px-3 py-2 text-ui-label whitespace-normal text-left"
          disabled={captureDisabled}
          onClick={onCapture}
        >
          <LocateFixed className="size-3.5" aria-hidden="true" />
          {captureLabel}
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-r-none focus-visible:ring-inset focus-visible:ring-offset-0"
            aria-label={`${label} -0.1s`}
            title="−0.1s"
            disabled={nudgeDisabled(-100)}
            onClick={() => onNudge(-100)}
          >
            <Minus aria-hidden="true" />
          </Button>
          {children}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-l-none focus-visible:ring-inset focus-visible:ring-offset-0"
            aria-label={`${label} +0.1s`}
            title="+0.1s"
            disabled={nudgeDisabled(100)}
            onClick={() => onNudge(100)}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {preview && (
          <IconTooltip label={preview.label}>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={preview.label}
              disabled={preview.disabled}
              onClick={preview.onClick}
            >
              <Play aria-hidden="true" />
            </Button>
          </IconTooltip>
        )}
      </div>
    </div>
  );
}

/** A real time axis, with independent keyboard- and pointer-operable boundaries. */
export function TimingRangeTimeline({
  locale,
  startMs,
  endMs,
  currentMs,
  duration,
  minDuration = 250,
  maxDuration = 600_000,
  labels,
  disabled,
  onChange,
  onSeek,
}: {
  locale: UiLocale;
  startMs: number;
  endMs: number;
  currentMs: number | null;
  duration?: number;
  minDuration?: number;
  maxDuration?: number;
  labels?: { start: string; end: string };
  disabled: boolean;
  onChange: (boundary: "start" | "end", value: number) => void;
  onSeek?: (value: number) => void;
}) {
  const copy = timingControlsCopy[locale];
  const player = unifiedPlayerMessages[locale];
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    boundary: "start" | "end";
    value: number;
    initialValue: number;
    originX: number;
    millisecondsPerPixel: number;
  } | null>(null);
  const valid =
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs >= 0 &&
    endMs - startMs >= minDuration &&
    endMs - startMs <= maxDuration &&
    endMs <= (duration ?? 43_200_000);
  function context() {
    const start = Number.isFinite(startMs) ? Math.max(0, startMs) : 0;
    const end = Number.isFinite(endMs) && endMs > start ? endMs : start + 1000;
    const padding = Math.max(2000, Math.min(10000, (end - start) / 4));
    return {
      start: Math.max(0, start - padding),
      end: Math.min(duration ?? 43_200_000, end + padding),
    };
  }
  const [window, setWindow] = useState(context);
  if (!valid || window.end <= window.start) return null;
  const outside = startMs < window.start || endMs > window.end;
  const percent = (value: number) =>
    Math.max(0, Math.min(100, ((value - window.start) / (window.end - window.start)) * 100));
  function clamp(boundary: "start" | "end", value: number) {
    const minimum = boundary === "start" ? Math.max(0, endMs - maxDuration) : startMs + minDuration;
    const maximum =
      boundary === "start"
        ? endMs - minDuration
        : Math.min(duration ?? 43_200_000, startMs + maxDuration);
    return Math.max(minimum, Math.min(maximum, Math.round(value)));
  }
  function position(clientX: number) {
    const box = track.current!.getBoundingClientRect();
    return (
      window.start +
      Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * (window.end - window.start)
    );
  }
  return (
    <div className="grid min-w-0 gap-2" data-ui="timing-range-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2 text-ui-label">
        <span className="font-semibold">{player.timeline}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular-nums text-muted-foreground">
            {copy.duration(((endMs - startMs) / 1000).toFixed(1))}
          </span>
          <Button
            variant={outside ? "secondary" : "ghost"}
            size="sm"
            className="gap-1 px-2 text-ui-label"
            disabled={disabled}
            onClick={() => setWindow(context())}
            data-ui="timing-fit-range"
          >
            <Scan className="size-3.5" aria-hidden="true" />
            {copy.fitRange}
          </Button>
        </div>
      </div>
      <div className="px-4">
        <div
          ref={track}
          className="relative h-12 touch-none cursor-pointer"
          onClick={event => {
            if (disabled || !onSeek || event.target !== event.currentTarget) return;
            onSeek(Math.round(position(event.clientX)));
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-3 h-6 rounded-xs bg-muted/60"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-3 h-6 border-y border-primary/40 bg-primary/10"
            style={{ left: `${percent(startMs)}%`, width: `${percent(endMs) - percent(startMs)}%` }}
          />
          {currentMs !== null && currentMs >= window.start && currentMs <= window.end && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-2 h-8 w-px bg-foreground"
              style={{ left: `${percent(currentMs)}%` }}
            />
          )}
          {(["start", "end"] as const).map(boundary => {
            const value = boundary === "start" ? startMs : endMs;
            const label = labels?.[boundary] ?? (boundary === "start" ? player.start : player.end);
            return (
              <button
                key={boundary}
                type="button"
                role="slider"
                aria-label={label}
                aria-valuemin={
                  (boundary === "start"
                    ? Math.max(0, endMs - maxDuration)
                    : startMs + minDuration) / 1000
                }
                aria-valuemax={
                  (boundary === "start"
                    ? endMs - minDuration
                    : Math.min(duration ?? 43_200_000, startMs + maxDuration)) / 1000
                }
                aria-valuenow={value / 1000}
                aria-valuetext={formatDisplayTime(value)}
                disabled={disabled}
                className="group absolute top-1 z-10 flex h-10 w-8 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none disabled:cursor-default disabled:opacity-50"
                style={{ left: `${percent(value)}%` }}
                onPointerDown={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const box = track.current!.getBoundingClientRect();
                  dragging.current = {
                    boundary,
                    value,
                    initialValue: value,
                    originX: event.clientX,
                    millisecondsPerPixel: (window.end - window.start) / box.width,
                  };
                }}
                onPointerMove={event => {
                  if (dragging.current?.boundary !== boundary) return;
                  const drag = dragging.current;
                  const delta =
                    Math.round(((event.clientX - drag.originX) * drag.millisecondsPerPixel) / 100) *
                    100;
                  const next = clamp(boundary, drag.initialValue + delta);
                  if (next === drag.value) return;
                  dragging.current.value = next;
                  onChange(boundary, next);
                }}
                onPointerUp={event => {
                  event.stopPropagation();
                  if (!dragging.current) return;
                  dragging.current = null;
                }}
                onPointerCancel={() => {
                  dragging.current = null;
                }}
                onLostPointerCapture={() => {
                  dragging.current = null;
                }}
                onKeyDown={event => {
                  if (
                    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
                  const next = clamp(
                    boundary,
                    event.key === "Home"
                      ? window.start
                      : event.key === "End"
                        ? window.end
                        : value + direction * (event.shiftKey ? 1000 : 100),
                  );
                  onChange(boundary, next);
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-2 items-center justify-center rounded-xs border border-primary bg-background transition-colors group-hover:bg-accent group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-active:bg-accent"
                >
                  <span className="h-3 w-px bg-primary/70" />
                </span>
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          className="flex justify-between text-ui-meta tabular-nums text-muted-foreground"
        >
          <span>{formatDisplayTime(window.start)}</span>
          <span>{formatDisplayTime(window.end)}</span>
        </div>
      </div>
      <p className="text-ui-label leading-relaxed text-muted-foreground">
        {outside ? copy.outsideHint : copy.dragHint}
      </p>
    </div>
  );
}
