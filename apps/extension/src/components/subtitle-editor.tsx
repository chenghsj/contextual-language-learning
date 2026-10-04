import { useEffect, useMemo, useRef, useState } from "react";
import { formatRangeTime, parseRangeTime, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { createFlowCopy } from "../i18n/create-flow";
import { analysisRangeCopy } from "../i18n/analysis-range";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import type { SubtitleDraft } from "../lib/subtitle-draft";
const ROW_HEIGHT = 108;
export function SubtitleEditor({
  draft,
  cues,
  locale,
  duration,
  connected,
  onSeek,
  onBack,
  saveStatus,
}: {
  draft: SubtitleDraft;
  cues: SubtitleCue[];
  locale: UiLocale;
  duration?: number;
  connected: boolean;
  onSeek: (ms: number) => void;
  onBack: () => void;
  saveStatus: "saving" | "saved" | "failed";
}) {
  const ux = createFlowCopy(locale),
    range = analysisRangeCopy(locale);
  const [search, setSearch] = useState(""),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(500);
  const viewport = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<SubtitleCue | null>(null),
    [text, setText] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [error, setError] = useState("");
  const filtered = useMemo(
    () =>
      cues.filter(cue => cue.originalText.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [cues, search],
  );
  useEffect(() => {
    setScroll(0);
    viewport.current?.scrollTo(0, 0);
  }, [search]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 3),
    last = Math.min(filtered.length, Math.ceil((scroll + height) / ROW_HEIGHT) + 3);
  const open = (cue: SubtitleCue) => {
    setEditing(cue);
    setText(cue.originalText);
    setStart(cue.startMs === null ? "" : formatRangeTime(cue.startMs));
    setEnd(cue.endMs === null ? "" : formatRangeTime(cue.endMs));
    setError("");
  };
  function apply() {
    if (!editing) return true;
    try {
      draft.editCue(
        editing.id,
        {
          originalText: text,
          startMs: editing.startMs === null ? null : parseRangeTime(start),
          endMs: editing.endMs === null ? null : parseRangeTime(end),
        },
        duration,
      );
      setError("");
      return true;
    } catch {
      setError(range.invalid);
      return false;
    }
  }
  return (
    <section data-ui="subtitle-editor" className="flex min-h-0 flex-1 flex-col gap-3 pt-2">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {ux.video}
        </Button>
        <span role="status" className="text-xs">
          {saveStatus === "saving" ? ux.saving : saveStatus === "failed" ? ux.saveFailed : ux.saved}
        </span>
      </header>
      <label className="grid shrink-0 gap-1 text-xs">
        {ux.search}
        <Input value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {!connected && <p className="text-xs text-muted-foreground">{ux.disconnected}</p>}
      <p className="text-xs tabular-nums">
        {filtered.length} / {cues.length}
      </p>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={event => setScroll(event.currentTarget.scrollTop)}
      >
        <ol className="relative" style={{ height: filtered.length * ROW_HEIGHT }}>
          {filtered.slice(first, last).map((cue, index) => (
            <li
              key={cue.id}
              className="absolute inset-x-0 overflow-hidden border-b border-border px-2 py-2"
              style={{ top: (first + index) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 text-xs tabular-nums"
                  disabled={!connected || cue.startMs === null}
                  onClick={() => onSeek(cue.startMs!)}
                >
                  {cue.startMs === null
                    ? "—"
                    : formatRangeTime(cue.startMs) + " → " + formatRangeTime(cue.endMs!)}
                </Button>
                <Button variant="outline" size="sm" onClick={() => open(cue)}>
                  {ux.edit}
                </Button>
              </div>
              <p className="line-clamp-2 text-xs wrap-anywhere">{cue.originalText}</p>
            </li>
          ))}
        </ol>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (window.confirm(ux.restoreConfirm)) draft.restoreOriginal();
        }}
      >
        {ux.restore}
      </Button>
      <Dialog
        open={!!editing}
        onOpenChange={open => {
          if (!open && apply()) setEditing(null);
        }}
      >
        <DialogContent closeLabel={ux.close} className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{ux.edit}</DialogTitle>
            <DialogDescription>{ux.subtitleText}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-xs">
            {ux.subtitleText}
            <Textarea
              value={text}
              maxLength={1500}
              onChange={event => setText(event.target.value)}
              onBlur={apply}
            />
          </label>
          {editing?.startMs !== null && (
            <div className="grid gap-2">
              <label className="grid gap-1 text-xs">
                {range.start}
                <Input
                  value={start}
                  onChange={event => setStart(event.target.value)}
                  onBlur={apply}
                  aria-invalid={!!error}
                />
              </label>
              <label className="grid gap-1 text-xs">
                {range.end}
                <Input
                  value={end}
                  onChange={event => setEnd(event.target.value)}
                  onBlur={apply}
                  aria-invalid={!!error}
                />
              </label>
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            onClick={() => {
              if (apply()) setEditing(null);
            }}
          >
            {ux.done}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
