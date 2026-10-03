import React, { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  formatRangeTime,
  parseRangeTime,
  selectAnalysisCues,
  timedCues,
  type SubtitleCue,
  type RangeSelection,
} from "@immersive/core";
import { analysisRangeCopy } from "../i18n/analysis-range";
import type { UiLocale } from "../i18n/messages";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Disclosure } from "./disclosure";

export function AnalysisRangePicker({
  cues,
  value,
  onChange,
  durationMs,
  estimated,
  adapter,
  url,
  locale,
  onError,
}: {
  cues: SubtitleCue[];
  value: RangeSelection;
  onChange: (value: RangeSelection) => void;
  durationMs: number;
  estimated: boolean;
  adapter: VideoAdapter;
  url: string;
  locale: UiLocale;
  onError: (message: string) => void;
}) {
  const ui = analysisRangeCopy(locale);
  const timed = timedCues(cues);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [cues, value.mode]);
  const selected = (() => {
    try {
      return selectAnalysisCues(cues, value);
    } catch {
      return [];
    }
  })();
  const valid =
    value.mode === "full" ||
    (Number.isFinite(value.startMs) &&
      value.startMs >= 0 &&
      value.startMs < value.endMs &&
      value.endMs <= durationMs &&
      selected.length > 0);
  const setTime = (key: "startMs" | "endMs", time: number) =>
    onChange({ ...value, mode: "custom", [key]: time });
  const seek = (ms: number) => {
    if (url && adapter.seek) void adapter.seek(url, ms).catch(error => onError(String(error)));
  };
  async function current(key: "startMs" | "endMs") {
    try {
      const result = await adapter.status?.(url);
      if (result?.currentMs !== undefined) setTime(key, Math.round(result.currentMs));
    } catch (error) {
      onError(String(error));
    }
  }
  return (
    <section className="grid gap-4" aria-label={ui.title}>
      <h2>{ui.title}</h2>
      <SelectField
        ariaLabel={ui.title}
        value={timed ? value.mode : "full"}
        options={[
          { value: "full", label: ui.full },
          ...(timed
            ? [
                { value: "first", label: ui.first },
                { value: "second", label: ui.second },
                { value: "custom", label: ui.custom },
              ]
            : []),
        ]}
        onValueChange={mode => {
          const half = Math.floor(durationMs / 2);
          onChange({
            mode: mode as RangeSelection["mode"],
            startMs: mode === "second" ? half : 0,
            endMs: mode === "first" ? half : durationMs,
          });
        }}
      />
      {!timed ? (
        <p className="text-xs text-muted-foreground">{ui.untimed}</p>
      ) : (
        <>
          {estimated && <p className="text-xs text-muted-foreground">{ui.estimated}</p>}
          <div className="grid grid-cols-2 gap-3">
            {(["startMs", "endMs"] as const).map(key => (
              <div key={key} className="grid gap-2">
                <label className="grid gap-1 text-xs">
                  {key === "startMs" ? ui.start : ui.end}
                  <TimeField
                    value={value[key]}
                    onChange={ms => setTime(key, ms)}
                    invalid={!valid}
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-8 whitespace-normal"
                  disabled={!url || !adapter.status}
                  onClick={() => void current(key)}
                >
                  {ui.current}
                </Button>
              </div>
            ))}
          </div>
          <div role="group" aria-label={ui.title} className="grid gap-2">
            {(["startMs", "endMs"] as const).map(key => (
              <input
                key={key}
                type="range"
                className="w-full accent-primary"
                aria-label={key === "startMs" ? ui.start : ui.end}
                min={0}
                max={durationMs}
                step={1}
                value={Number.isFinite(value[key]) ? value[key] : 0}
                onChange={event => setTime(key, Number(event.target.value))}
              />
            ))}
          </div>
          {!valid && (
            <p role="alert" className="text-xs text-destructive">
              {ui.invalid}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!valid || !url || !adapter.seek}
            onClick={() => seek(value.startMs)}
          >
            {ui.jump}
          </Button>
          <Disclosure title={`${ui.subtitles} · ${selected.length} / ${cues.length}`}>
            <ol className="grid max-h-72 gap-1 overflow-y-auto overscroll-contain">
              {cues.slice(page * 50, (page + 1) * 50).map(cue => (
                <li
                  key={cue.id}
                  className={
                    "flex min-w-0 items-start gap-1 rounded-md p-2 " +
                    (selected.includes(cue) ? "bg-accent" : "text-muted-foreground")
                  }
                >
                  <Button
                    variant="ghost"
                    className="h-auto min-h-8 flex-1 justify-start whitespace-normal text-left"
                    disabled={!url || !adapter.seek}
                    onClick={() => seek(cue.startMs!)}
                  >
                    <span className="grid min-w-0 gap-1">
                      <span className="text-[11px] tabular-nums">
                        {formatRangeTime(cue.startMs!)}
                      </span>
                      <span className="wrap-anywhere">{cue.originalText}</span>
                    </span>
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={ui.actions}
                      >
                        <MoreHorizontal />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-1" collisionPadding={8}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setTime("startMs", cue.startMs!)}
                      >
                        {ui.setStart}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setTime("endMs", cue.endMs!)}
                      >
                        {ui.setEnd}
                      </Button>
                    </PopoverContent>
                  </Popover>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {ui.previous}
              </Button>
              <span className="text-xs">
                {page + 1} / {Math.max(1, Math.ceil(cues.length / 50))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={(page + 1) * 50 >= cues.length}
                onClick={() => setPage(page + 1)}
              >
                {ui.next}
              </Button>
            </div>
          </Disclosure>
        </>
      )}
    </section>
  );
}
function TimeField({
  value,
  onChange,
  invalid,
}: {
  value: number;
  onChange: (ms: number) => void;
  invalid: boolean;
}) {
  const [text, setText] = useState(formatRangeTime(value));
  useEffect(() => {
    if (Number.isFinite(value))
      setText(
        formatRangeTime(value) + (value % 1000 ? `.${String(value % 1000).padStart(3, "0")}` : ""),
      );
  }, [value]);
  return (
    <Input
      value={text}
      placeholder="HH:MM:SS"
      aria-invalid={invalid}
      onChange={event => {
        setText(event.target.value);
        onChange(parseRangeTime(event.target.value));
      }}
    />
  );
}
