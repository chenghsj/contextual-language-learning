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
  const scrubbing = useRef(false);
  const draft = useRef(position);
  const clamp = (value: number) => Math.max(range.startMs, Math.min(range.endMs, value));

  useEffect(() => {
    const sampledAt = performance.now();
    let frame = 0;
    if (!scrubbing.current) setDisplayMs(clamp(position));
    if (playing && !disabled) {
      const animate = (now: number) => {
        // Stop extrapolating if the video stalls or status replies stop arriving.
        if (!scrubbing.current)
          setDisplayMs(clamp(position + Math.min(300, Math.max(0, now - sampledAt)) * rate));
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
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
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
          setDisplayMs(next);
          if (!scrubbing.current) onSeek(next);
        }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
          const next = clamp(Number(event.currentTarget.value) + direction * 100);
          draft.current = next;
          setDisplayMs(next);
          if (!scrubbing.current) onSeek(next);
        }}
        onPointerUp={commit}
        onLostPointerCapture={commit}
        onPointerCancel={() => {
          scrubbing.current = false;
          setDisplayMs(clamp(position));
        }}
        onBlur={commit}
      />
      <span>{formatLoopTimestamp(range.endMs)}</span>
    </div>
  );
}
