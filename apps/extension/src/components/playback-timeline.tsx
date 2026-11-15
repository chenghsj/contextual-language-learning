import React, { useEffect, useRef, useState } from "react";
import { formatLoopTimestamp, type LoopWindow } from "../video/loop-window";

type Props = {
  range: LoopWindow;
  position: number;
  playing: boolean;
  rate: number;
  disabled: boolean;
  label: string;
  onSeek: (position: number) => void;
};

const MAX_EXTRAPOLATION_MS = 1000;
const MAX_SPEED_CORRECTION = 0.1;

/** Animate only the timeline; video status remains the authoritative clock. */
export function PlaybackTimeline({
  range,
  position,
  playing,
  rate,
  disabled,
  label,
  onSeek,
}: Props) {
  const [displayMs, setDisplayMs] = useState(position);
  const display = useRef(position);
  const scrubbing = useRef(false);
  const draft = useRef(position);
  const previousSample = useRef({ position, at: performance.now() });
  const lastFrameAt = useRef<number | null>(null);
  const wasAnimating = useRef(false);
  const clamp = (value: number) => Math.max(range.startMs, Math.min(range.endMs, value));

  function updateDisplay(value: number): void {
    display.current = value;
    setDisplayMs(value);
  }

  useEffect(() => {
    const sampledAt = performance.now();
    const elapsed = Math.max(0, sampledAt - previousSample.current.at);
    const movedBackwards = position < previousSample.current.position;
    const jumpedForward = position - previousSample.current.position > (elapsed + 300) * rate;
    const reset = movedBackwards || jumpedForward;
    previousSample.current = { position, at: sampledAt };
    const animating = playing && !disabled;
    let frame = 0;
    if (!scrubbing.current)
      updateDisplay(
        reset
          ? clamp(position)
          : animating
            ? clamp(display.current)
            : Math.max(clamp(display.current), clamp(position)),
      );
    if (!wasAnimating.current || reset || lastFrameAt.current === null)
      lastFrameAt.current = sampledAt;
    wasAnimating.current = animating;
    if (animating) {
      const animate = (now: number) => {
        const delta = Math.max(0, now - lastFrameAt.current!);
        lastFrameAt.current = now;
        if (!scrubbing.current) {
          const nominal = display.current + delta * rate;
          const predicted =
            position + Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, now - sampledAt)) * rate;
          // Slew small clock errors instead of stopping or jumping at each poll.
          const limit = delta * rate * MAX_SPEED_CORRECTION;
          const correction = Math.max(
            -limit,
            Math.min(limit, (predicted - nominal) * Math.min(1, delta / 1000)),
          );
          // A missing or stalled source may lead by at most one second.
          const ceiling = clamp(position + MAX_EXTRAPOLATION_MS * rate);
          updateDisplay(
            Math.max(clamp(display.current), Math.min(clamp(nominal + correction), ceiling)),
          );
        }
        frame = window.requestAnimationFrame(animate);
      };
      frame = window.requestAnimationFrame(animate);
    }
    return () => window.cancelAnimationFrame(frame);
  }, [position, playing, rate, disabled, range.startMs, range.endMs]);

  function commit(): void {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (!disabled) onSeek(draft.current);
  }

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ui-meta tabular-nums text-muted-foreground">
      <span>{formatLoopTimestamp(range.startMs)}</span>
      <input
        type="range"
        aria-label={label}
        className="h-6 w-full min-w-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
        min={range.startMs}
        max={range.endMs}
        step={1}
        value={clamp(displayMs)}
        disabled={disabled}
        onPointerDown={event => {
          scrubbing.current = true;
          draft.current = Number(event.currentTarget.value);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onChange={event => {
          const next = Number(event.currentTarget.value);
          draft.current = next;
          updateDisplay(next);
          if (!scrubbing.current) onSeek(next);
        }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
          const next = clamp(Number(event.currentTarget.value) + direction * 100);
          draft.current = next;
          updateDisplay(next);
          if (!scrubbing.current) onSeek(next);
        }}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        onPointerCancel={() => {
          scrubbing.current = false;
          updateDisplay(clamp(position));
        }}
        onBlur={commit}
      />
      <span>{formatLoopTimestamp(range.endMs)}</span>
    </div>
  );
}
