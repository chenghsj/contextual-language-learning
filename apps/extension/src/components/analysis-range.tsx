import { useEffect, useRef, useState } from "react";
import {
  selectAnalysisCues,
  timedCues,
  type SubtitleCue,
  type RangeSelection,
} from "@contextual/core";
import { analysisRangeCopy } from "../i18n/analysis-range";
import { createFlowCopy } from "../i18n/create-flow";
import type { UiLocale } from "../i18n/messages";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";
import { formatDisplayTime, parseDisplayTime } from "../lib/time-display";
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
  connected = false,
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
  connected?: boolean;
}) {
  const ui = analysisRangeCopy(locale),
    ux = createFlowCopy(locale),
    timed = timedCues(cues);
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
  async function current(key: "startMs" | "endMs") {
    try {
      const status = await adapter.status?.(url);
      if (status?.currentMs !== undefined) setTime(key, Math.round(status.currentMs));
    } catch (error) {
      onError(String(error));
    }
  }
  return (
    <section className="grid gap-3" aria-label={ui.title}>
      <h2>{ui.title}</h2>
      <SelectField
        ariaLabel={ui.title}
        value={timed ? value.mode : "full"}
        options={[
          { value: "full", label: ui.full },
          { value: "first", label: ui.first, disabled: !timed || estimated || durationMs <= 0 },
          { value: "second", label: ui.second, disabled: !timed || estimated || durationMs <= 0 },
          { value: "custom", label: ui.custom, disabled: !timed || durationMs <= 0 },
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
        <p className="text-ui-body text-muted-foreground">{ui.untimed}</p>
      ) : (
        <>
          {estimated && <p className="text-xs text-muted-foreground">{ui.estimated}</p>}
          {value.mode === "custom" && (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-3">
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
                      className="h-auto min-h-9 whitespace-normal"
                      disabled={!connected || !adapter.status}
                      onClick={() => void current(key)}
                    >
                      {ui.current}
                    </Button>
                  </div>
                ))}
              </div>
              <div role="group" aria-label={ui.title} className="relative h-11">
                <div className="absolute inset-x-0 top-5 h-1 rounded-full bg-muted">
                  <div
                    className="absolute h-1 rounded-full bg-primary"
                    style={{
                      left: Math.max(0, (value.startMs / durationMs) * 100) + "%",
                      right: Math.max(0, 100 - (value.endMs / durationMs) * 100) + "%",
                    }}
                  />
                </div>
                {(["startMs", "endMs"] as const).map(key => (
                  <input
                    key={key}
                    type="range"
                    className="dual-range absolute inset-0 h-11 w-full"
                    aria-label={key === "startMs" ? ui.start : ui.end}
                    aria-valuetext={formatDisplayTime(value[key])}
                    min={0}
                    max={durationMs}
                    step={1}
                    value={Number.isFinite(value[key]) ? value[key] : 0}
                    onChange={event =>
                      setTime(
                        key,
                        key === "startMs"
                          ? Math.min(Number(event.target.value), value.endMs - 1)
                          : Math.max(Number(event.target.value), value.startMs + 1),
                      )
                    }
                  />
                ))}
              </div>
              {!connected && (
                <p className="text-ui-body text-muted-foreground">{ux.disconnected}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!valid || !connected || !adapter.seek}
                onClick={() =>
                  void adapter.seek?.(url, value.startMs).catch(error => onError(String(error)))
                }
              >
                {ui.jump}
              </Button>
            </>
          )}
          {value.mode !== "full" && (
            <p className="text-xs tabular-nums">
              {formatDisplayTime(value.startMs)} — {formatDisplayTime(value.endMs)} ·{" "}
              {selected.length} / {cues.length}
            </p>
          )}
          {!valid && (
            <p role="alert" className="text-ui-body text-destructive">
              {ui.invalid}
            </p>
          )}
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
  const [text, setText] = useState(formatDisplayTime(value));
  const editing = useRef(false);
  useEffect(() => {
    if (Number.isFinite(value) && !editing.current) setText(formatDisplayTime(value));
  }, [value]);
  return (
    <Input
      value={text}
      placeholder="MM:SS.s"
      aria-invalid={invalid}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={() => {
        editing.current = false;
        if (Number.isFinite(value)) setText(formatDisplayTime(value));
      }}
      onChange={event => {
        setText(event.target.value);
        onChange(parseDisplayTime(event.target.value));
      }}
    />
  );
}
