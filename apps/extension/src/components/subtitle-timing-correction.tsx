import React, { useEffect, useId, useRef, useState } from "react";
import { formatRangeTime } from "@contextual/core";
import type { SubtitleDraft, SubtitleDraftState } from "../lib/subtitle-draft";
import { transformSubtitleTiming, type TimingCorrection } from "../lib/subtitle-timing";
import { formatDisplayTime, parseDisplayTime } from "../lib/time-display";
import { youtubeAdapter } from "../video/youtube";
import { isLoopWindow } from "../video/loop-window";
import { subtitleEditorCopy } from "../i18n/subtitle-editor";
import { subtitleTimingCopy } from "../i18n/subtitle-timing";
import type { UiLocale } from "../i18n/messages";
import { Dialog, DialogContent, DialogDescription, DialogHeader } from "./ui/dialog";
import { DialogTitleBar } from "./dialog-title-bar";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Mode = "offset" | "anchors";
type Preview = { snapshot: SubtitleDraftState; changes: TimingCorrection[] };

/** Closing stops playback; completed proposals remain in the saved draft. */
export function SubtitleTimingCorrection({
  draft,
  locale,
  duration,
  onClose,
  onRestoreFocus,
}: {
  draft: SubtitleDraft;
  locale: UiLocale;
  duration?: number;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const copy = subtitleTimingCopy[locale];
  const id = useId();
  const saved = useRef(draft.timingPreview()).current;
  const [mode, setMode] = useState<Mode>(saved?.inputs?.mode ?? "offset");
  const [offset, setOffset] = useState(saved?.inputs?.offset ?? "0");
  const first = draft.snapshot.cues.find(cue => cue.startMs !== null);
  const last = [...draft.snapshot.cues].reverse().find(cue => cue.endMs !== null);
  const [anchors, setAnchors] = useState(
    () =>
      saved?.inputs?.anchors ?? {
        subtitleFirst: formatRangeTime(first?.startMs ?? 0),
        audioFirst: formatRangeTime(first?.startMs ?? 0),
        subtitleLast: formatRangeTime(last?.endMs ?? 1000),
        audioLast: formatRangeTime(last?.endMs ?? 1000),
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localPreview, setPreview] = useState<Preview | null>(() => draft.timingPreview());
  const baseline = draft.snapshot;
  const preview = draft.timingPreview() ?? localPreview;
  const stale = preview !== null && preview.snapshot !== baseline;
  const [playing, setPlaying] = useState<string | null>(null);
  const [playBusy, setPlayBusy] = useState(false);
  const mounted = useRef(true);
  const active = useRef<{ key: string; url: string } | null>(null);
  const playback = useRef(Promise.resolve());
  async function stopPlayback() {
    const previous = active.current;
    active.current = null;
    if (mounted.current) setPlaying(null);
    if (previous) {
      try {
        await youtubeAdapter.stopLoop!(previous.url);
      } finally {
        await youtubeAdapter.pause!(previous.url);
      }
    }
  }
  function stopQueued() {
    playback.current = playback.current.catch(() => {}).then(stopPlayback);
    void playback.current.catch(() => {});
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopQueued();
    };
  }, []);
  useEffect(() => {
    stopQueued();
  }, [baseline.sourceUrl, baseline.raw]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (playBusy || !active.current) return;
      void youtubeAdapter.status!(active.current.url)
        .then(status => {
          if (mounted.current && status.playing === false) stopQueued();
        })
        .catch(() => {
          if (mounted.current) stopQueued();
        });
    }, 500);
    return () => clearInterval(timer);
  }, [playing, playBusy]);
  function listen(key: string, startMs: number, endMs: number) {
    if (playBusy || busy || stale) return;
    const url = baseline.sourceUrl;
    if (!isLoopWindow({ startMs, endMs })) {
      setError(subtitleEditorCopy[locale].previewRange);
      return;
    }
    setPlayBusy(true);
    playback.current = playback.current
      .catch(() => {})
      .then(async () => {
        if (!mounted.current) return;
        const stopping = active.current?.key === key;
        await stopPlayback();
        if (stopping || !mounted.current) return;
        active.current = { key, url };
        await youtubeAdapter.loop!(url, { startMs, endMs, repeats: 1, delaySeconds: 0 });
        if (mounted.current) setPlaying(key);
      })
      .catch(async () => {
        await stopPlayback().catch(() => {});
        if (mounted.current) setError(subtitleEditorCopy[locale].unavailable);
      })
      .finally(() => {
        if (mounted.current) setPlayBusy(false);
      });
  }
  function invalidate() {
    draft.clearTimingPreview();
    stopQueued();
    setPreview(null);
    setError("");
    setBusy(false);
  }
  async function calculate() {
    invalidate();
    const snapshot = draft.snapshot;
    setBusy(true);
    try {
      await playback.current;
      if (!mounted.current) return;
      let changes: TimingCorrection[];
      if (mode === "offset") {
        if (!/^[+-]?(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(offset.trim()))
          throw new Error("INVALID_TIMING");
        changes = transformSubtitleTiming(
          snapshot.cues,
          { offsetMs: Math.round(Number(offset) * 1000) },
          duration,
        );
      } else {
        changes = transformSubtitleTiming(
          snapshot.cues,
          {
            anchors: [
              {
                subtitleMs: parseDisplayTime(anchors.subtitleFirst),
                audioMs: parseDisplayTime(anchors.audioFirst),
              },
              {
                subtitleMs: parseDisplayTime(anchors.subtitleLast),
                audioMs: parseDisplayTime(anchors.audioLast),
              },
            ],
          },
          duration,
        );
      }
      if (mounted.current) {
        draft.saveTimingPreview(changes, snapshot, { mode, offset, anchors });
        setPreview(draft.timingPreview());
      }
    } catch (cause) {
      if (mounted.current) {
        const code = cause instanceof Error ? cause.message : "";
        setError(code === "STALE_TIMING" ? copy.stale : copy.invalid);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function apply() {
    if (!preview || busy) return;
    try {
      draft.applyTimingCorrections(preview.changes, preview.snapshot, duration);
      onClose();
    } catch {
      setError(draft.snapshot !== preview.snapshot ? copy.stale : copy.invalid);
    }
  }
  const originals = new Map(preview?.snapshot.cues.map(cue => [cue.id, cue]));
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90dvh] min-w-0 flex-col overflow-hidden"
        onCloseAutoFocus={event => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitleBar closeLabel={copy.close}>{copy.title}</DialogTitleBar>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div
          className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain"
          data-ui="timing-correction"
        >
          <div className="grid min-w-0 gap-2">
            <label htmlFor={`${id}-mode`} className="text-xs">
              {copy.mode}
            </label>
            <Select
              value={mode}
              onValueChange={value => {
                invalidate();
                setMode(value as Mode);
              }}
              disabled={busy}
            >
              <SelectTrigger id={`${id}-mode`} className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["offset", "anchors"] as const).map(value => (
                  <SelectItem key={value} value={value}>
                    {copy[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === "offset" && (
            <div className="grid gap-2">
              <label htmlFor={`${id}-offset`} className="text-xs">
                {copy.offsetLabel}
              </label>
              <Input
                id={`${id}-offset`}
                inputMode="decimal"
                value={offset}
                disabled={busy}
                aria-describedby={`${id}-offset-hint`}
                onChange={event => {
                  invalidate();
                  setOffset(event.target.value);
                }}
              />
              <p id={`${id}-offset-hint`} className="text-xs leading-relaxed">
                {copy.offsetHint}
              </p>
            </div>
          )}
          {mode === "anchors" && (
            <div className="grid gap-3">
              <p className="text-ui-body">{copy.anchorsHint}</p>
              {(Object.keys(anchors) as (keyof typeof anchors)[]).map(key => (
                <div key={key} className="grid gap-2">
                  <label htmlFor={`${id}-${key}`} className="text-xs">
                    {copy[key]}
                  </label>
                  <Input
                    id={`${id}-${key}`}
                    value={anchors[key]}
                    disabled={busy}
                    aria-describedby={`${id}-time-hint`}
                    onChange={event => {
                      invalidate();
                      setAnchors(current => ({ ...current, [key]: event.target.value }));
                    }}
                  />
                </div>
              ))}
              <p id={`${id}-time-hint`} className="text-xs leading-relaxed">
                {copy.timeHint}
              </p>
            </div>
          )}
          <Button variant="outline" onClick={() => void calculate()} disabled={busy}>
            {copy.preview}
          </Button>
          {(error || stale) && (
            <p role="alert" className="text-ui-body text-destructive">
              {error || copy.stale}
            </p>
          )}
          {preview && !stale && (
            <div className="grid min-w-0 gap-3" aria-live="polite">
              <p role="status" className="text-ui-body">
                {preview.changes.length
                  ? `${copy.changed}: ${preview.changes.length}`
                  : copy.unchanged}
              </p>
              {preview.changes.length > 0 && (
                <>
                  <ol className="divide-y divide-border">
                    {preview.changes.slice(0, 5).map(change => {
                      const cue = originals.get(change.id)!;
                      return (
                        <li key={change.id} className="grid gap-1 py-3">
                          <p
                            className="line-clamp-2 text-ui-body wrap-anywhere"
                            title={cue.originalText}
                          >
                            {cue.originalText}
                          </p>
                          <p className="text-xs tabular-nums wrap-anywhere">
                            {copy.before}: {formatDisplayTime(cue.startMs!)} →{" "}
                            {formatDisplayTime(cue.endMs!)}
                          </p>
                          <p className="text-xs tabular-nums wrap-anywhere">
                            {copy.after}: {formatDisplayTime(change.startMs)} →{" "}
                            {formatDisplayTime(change.endMs)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {(["before", "after"] as const).map(kind => {
                              const key = `${change.id}-${kind}`;
                              return (
                                <Button
                                  key={kind}
                                  variant="outline"
                                  size="sm"
                                  disabled={playBusy || busy}
                                  onClick={() =>
                                    listen(
                                      key,
                                      kind === "before" ? cue.startMs! : change.startMs,
                                      kind === "before" ? cue.endMs! : change.endMs,
                                    )
                                  }
                                >
                                  {playing === key
                                    ? subtitleEditorCopy[locale].stop
                                    : subtitleEditorCopy[locale].preview}{" "}
                                  · {copy[kind]}
                                </Button>
                              );
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="text-xs leading-relaxed">{copy.previewHint}</p>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button disabled={busy || !preview?.changes.length || stale} onClick={apply}>
            {copy.apply}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
