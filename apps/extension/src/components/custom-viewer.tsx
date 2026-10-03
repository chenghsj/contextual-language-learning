import React, { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { formatRangeTime, type CustomDocument } from "@immersive/core";
import { translate, type UiLocale } from "../i18n/messages";
import { analysisRangeCopy } from "../i18n/analysis-range";
import { customContentCopy } from "../i18n/custom-content";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Disclosure } from "./disclosure";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { ExecutionDetails } from "./execution-details";
export function exportMarkdown(markdown: string, title: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SafeMarkdown({ markdown, locale }: { markdown: string; locale: UiLocale }) {
  const ui = customContentCopy(locale);
  return (
    <div className="min-w-0 space-y-3 text-sm leading-relaxed wrap-anywhere [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_a]:text-primary [&_a]:underline">
      <ReactMarkdown
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        urlTransform={url => (/^(https?:\/\/|mailto:|#)/i.test(url) ? url : "")}
        components={{
          img: ({ alt }) => (
            <span className="text-xs text-muted-foreground">
              {ui.imageBlocked}
              {alt ? ` · ${alt}` : ""}
            </span>
          ),
          a: ({ node: _node, ...props }) =>
            props.href ? (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ) : (
              <span>{props.children}</span>
            ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
export function CustomViewer({
  document,
  locale,
  busy,
  onRename,
  onDelete,
  onReuse,
  onRegenerate,
}: {
  document: CustomDocument;
  locale: UiLocale;
  busy: boolean;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReuse: () => void;
  onRegenerate: () => void;
}) {
  const ui = customContentCopy(locale),
    [title, setTitle] = useState(document.title),
    [action, setAction] = useState<"delete" | "regenerate" | null>(null),
    [renaming, setRenaming] = useState(false);
  const actionFocus = useRef<HTMLElement | null>(null);
  const openAction = (next: "delete" | "regenerate") => {
    actionFocus.current =
      window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    setAction(next);
  };
  return (
    <article className="grid gap-4 py-4">
      <h1 className="text-base font-semibold wrap-anywhere">{document.title}</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onReuse} disabled={busy}>
          {ui.reuse}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openAction("regenerate")}
          disabled={busy}
        >
          {ui.regenerate}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTitle(document.title);
            setRenaming(!renaming);
          }}
          disabled={busy}
        >
          {ui.rename}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportMarkdown(document.markdown, document.title)}
        >
          {ui.exportMarkdown}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openAction("delete")} disabled={busy}>
          {ui.deleteLocal}
        </Button>
      </div>
      {renaming && (
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            void onRename(title)
              .then(() => setRenaming(false))
              .catch(() => {});
          }}
        >
          <Input
            aria-label={ui.rename}
            value={title}
            maxLength={200}
            onChange={event => setTitle(event.target.value)}
          />
          <Button type="submit" disabled={busy || !title.trim()}>
            {ui.rename}
          </Button>
        </form>
      )}
      <Disclosure title={ui.viewPrompt}>
        <pre className="whitespace-pre-wrap text-xs wrap-anywhere">{document.request.prompt}</pre>
      </Disclosure>
      <Disclosure title={ui.details}>
        <ExecutionDetails execution={document.execution} locale={locale} />
      </Disclosure>
      <SafeMarkdown markdown={document.markdown} locale={locale} />
      <Dialog
        open={action !== null}
        onOpenChange={open => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          closeLabel={translate(locale, "cancel")}
          closeDisabled={busy}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = actionFocus.current?.isConnected
              ? actionFocus.current
              : window.document.getElementById("page-nav-lessons");
            target?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{action === "delete" ? ui.deleteLocal : ui.regenerate}</DialogTitle>
            <DialogDescription>
              {action === "delete" ? ui.deleteHint : ui.regenerateHint}
            </DialogDescription>
          </DialogHeader>
          {action === "regenerate" && (
            <div className="grid gap-2 text-xs">
              <p>{document.request.source.title}</p>
              <p>
                {document.execution.provider} · {document.execution.modelId}
              </p>
              <p>
                {document.request.cues.length} ·{" "}
                {document.request.analysisRange
                  ? `${formatRangeTime(document.request.analysisRange.startMs)}–${formatRangeTime(document.request.analysisRange.endMs)}`
                  : analysisRangeCopy(locale).full}
              </p>
              <p>
                {ui.subtitles}: {document.request.context.subtitles ? "✓" : "—"} · {ui.title}:{" "}
                {document.request.context.title ? "✓" : "—"}
              </p>
              <p className="wrap-anywhere">
                {translate(locale, "localFolder")}:{" "}
                {document.request.destination?.kind === "local" &&
                document.request.destination.directory
                  ? document.request.destination.directory
                  : translate(locale, "defaultFolder")}
              </p>
              <p>
                {translate(locale, "backupAccount")}:{" "}
                {document.request.backup?.enabled
                  ? (document.request.backup.accountId ?? ui.unknown)
                  : "—"}
              </p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-anywhere">
                {document.request.prompt}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>
              {ui.previous}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (action === "delete")
                  void onDelete()
                    .then(() => setAction(null))
                    .catch(() => {});
                else {
                  setAction(null);
                  onRegenerate();
                }
              }}
            >
              {action === "delete" ? ui.deleteLocal : ui.regenerate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
