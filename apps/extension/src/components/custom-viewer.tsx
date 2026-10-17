import React, { useEffect, useRef, useState } from "react";
import { useContentMotion } from "../hooks/use-content-motion";
import { ArrowLeft, MoreHorizontal, WholeWord } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { type CustomDocument, type LearningLanguage } from "@contextual/core";
import { formatDisplayTime } from "../lib/time-display";
import { translate, type UiLocale } from "../i18n/messages";
import { analysisRangeCopy } from "../i18n/analysis-range";
import { customContentCopy } from "../i18n/custom-content";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { unifiedPlayerMessages } from "../i18n/unified-player";
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogFooter } from "./ui/dialog";
import { DialogTitleBar } from "./dialog-title-bar";
import { ExecutionDetails } from "./execution-details";
import { useSystemSpeech } from "./system-speech";
import { speechCopy } from "../i18n/speech";
import { pronunciationCopy } from "../i18n/pronunciation";
import { learningLanguageOptions } from "../i18n/preferences";
import { SelectField } from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  pronunciationModes,
  defaultPronunciationMode,
  type PronunciationMode,
} from "./pronunciation";
import { annotatedMarkdownText } from "./custom-pronunciation";
import { SelectionSpeech } from "./selection-speech";
import { exportMarkdown } from "../lib/export-markdown";
export { exportMarkdown };
export const SafeMarkdown = React.memo(function SafeMarkdown({
  markdown,
  locale,
  language,
  pronunciationMode = "off",
}: {
  markdown: string;
  locale: UiLocale;
  language?: LearningLanguage;
  pronunciationMode?: PronunciationMode;
}) {
  const ui = customContentCopy(locale);
  return (
    <div
      data-ui="custom-markdown"
      className="min-w-0 space-y-3 text-ui-body wrap-anywhere [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_rt]:text-[10px] [&_rt]:font-normal [&_ruby]:leading-loose"
    >
      <ReactMarkdown
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        urlTransform={url => (/^(https?:\/\/|mailto:|#)/i.test(url) ? url : "")}
        components={{
          ...Object.fromEntries(
            ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"].map(tag => [
              tag,
              ({
                node: _node,
                children,
                ...props
              }: {
                node?: unknown;
                children?: React.ReactNode;
              }) =>
                React.createElement(
                  tag,
                  props,
                  language
                    ? annotatedMarkdownText(children, language, pronunciationMode)
                    : children,
                ),
            ]),
          ),
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
});
export function CustomViewer({
  document,
  locale,
  busy,
  onRename,
  onDelete,
  onReuse,
  onRegenerate,
  onBack,
  backLabel,
  menuActions = [],
}: {
  document: CustomDocument;
  locale: UiLocale;
  busy: boolean;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onReuse: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  backLabel: string;
  menuActions?: { label: string; onSelect: () => void }[];
}) {
  const ui = customContentCopy(locale),
    [title, setTitle] = useState(document.title),
    [action, setAction] = useState<"delete" | "regenerate" | null>(null),
    [renaming, setRenaming] = useState(false);
  const actionFocus = useRef<HTMLElement | null>(null);
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const renameInput = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const readingMotionRef = useRef<HTMLDivElement>(null);
  useContentMotion(readingMotionRef, document.id, { enter: true });
  const readingScroll = useRef(0);
  const speech = useSystemSpeech();
  const scope = "custom:" + document.id;
  const [language, setLanguage] = useState<LearningLanguage>(() => {
    const source = document.request.cues.map(cue => cue.originalText).join("");
    return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(source)
      ? "ja"
      : /\p{Script=Hangul}/u.test(source)
        ? "ko"
        : "en";
  });
  const [pronunciationMode, setPronunciationMode] = useState<PronunciationMode>(
    defaultPronunciationMode(language),
  );
  const phonetics = pronunciationCopy(locale, language);
  const speechUi = speechCopy(locale);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [panel, setPanel] = useState<"prompt" | "details" | null>(null);
  useEffect(
    () => () => {
      void speech?.controller.stop(scope).catch(() => {});
    },
    [speech?.controller, scope, panel],
  );
  const pendingAction = useRef<(() => void) | null>(null);
  const selectAction = (run: () => void) => {
    pendingAction.current = run;
    setOptionsOpen(false);
  };
  const showPanel = (next: "prompt" | "details") => {
    if (!panel) readingScroll.current = contentRef.current?.scrollTop ?? 0;
    setPanel(next);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };
  const closePanel = () => {
    setPanel(null);
    window.requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = readingScroll.current;
      renameTrigger.current?.focus();
    });
  };
  const cancelLabel = translate(locale, "cancel");
  const closeRename = () => {
    setRenaming(false);
    renameTrigger.current?.focus();
  };
  const openAction = (next: "delete" | "regenerate") => {
    actionFocus.current = renameTrigger.current;
    setAction(next);
  };
  return (
    <article
      className="@container/reader flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card"
      data-ui="customReader"
    >
      <header className="shrink-0 border-b border-border px-3 py-2" data-ui="reader-header">
        <div className="mx-auto flex w-full min-w-0 max-w-[720px] items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 [&_svg]:size-3.5"
            aria-label={backLabel}
            title={backLabel}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] text-muted-foreground">
              {ui.custom} · {language.toUpperCase()}
            </p>
            <h1 className="truncate text-xs font-semibold" title={document.title}>
              {document.title}
            </h1>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 [&_svg]:size-3.5"
                aria-label={phonetics.title}
              >
                <WholeWord aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-3">
              <label htmlFor="custom-reading-language" className="mb-2 block text-xs font-semibold">
                {speechUi.language}
              </label>
              <SelectField
                id="custom-reading-language"
                ariaLabel={speechUi.language}
                value={language}
                options={learningLanguageOptions(locale)}
                onValueChange={value => {
                  const next = value as LearningLanguage;
                  setLanguage(next);
                  setPronunciationMode(defaultPronunciationMode(next));
                  void speech?.controller.stop(scope).catch(() => {});
                }}
              />
              <p className="mb-2 mt-3 text-xs font-semibold">{phonetics.title}</p>
              <ToggleGroup
                type="single"
                value={pronunciationMode}
                aria-label={phonetics.title}
                className="flex flex-wrap justify-start gap-1"
                onValueChange={value => {
                  if (value) setPronunciationMode(value as PronunciationMode);
                }}
              >
                {pronunciationModes(language).map(mode => (
                  <ToggleGroupItem key={mode} value={mode} className="h-8 px-2 text-xs">
                    {phonetics.option(mode)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {ui.annotationsHint}
              </p>
            </PopoverContent>
          </Popover>
          <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
            <PopoverTrigger asChild>
              <Button
                ref={renameTrigger}
                id="custom-reader-options"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 [&_svg]:size-3.5"
                aria-label={unifiedPlayerMessages[locale].options}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 max-w-[calc(100vw-24px)] p-1"
              onCloseAutoFocus={event => {
                const run = pendingAction.current;
                if (run) {
                  event.preventDefault();
                  pendingAction.current = null;
                  renameTrigger.current?.focus();
                  // Let the closing popover remove its keyboard layer before opening another surface.
                  window.requestAnimationFrame(run);
                }
              }}
            >
              {[
                { label: ui.viewPrompt, run: () => showPanel("prompt") },
                { label: ui.details, run: () => showPanel("details") },
                {
                  label: ui.exportMarkdown,
                  run: () => exportMarkdown(document.markdown, document.title),
                },
                { label: ui.reuse, run: onReuse, disabled: busy },
                { label: ui.regenerate, run: () => openAction("regenerate"), disabled: busy },
                {
                  label: ui.rename,
                  run: () => {
                    setTitle(document.title);
                    setRenaming(true);
                    if (contentRef.current) contentRef.current.scrollTop = 0;
                    window.requestAnimationFrame(() => renameInput.current?.focus());
                  },
                  disabled: busy,
                },
                { label: ui.deleteLocal, run: () => openAction("delete"), disabled: busy },
              ].map(item => (
                <Button
                  key={item.label}
                  variant="ghost"
                  className="min-h-8 h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-xs"
                  disabled={item.disabled}
                  onClick={() => selectAction(item.run)}
                >
                  {item.label}
                </Button>
              ))}
              {menuActions.length > 0 && <div className="my-1 border-t border-border" />}
              {menuActions.map(item => (
                <Button
                  key={item.label}
                  variant="ghost"
                  className="h-8 min-h-8 w-full justify-start px-2 text-xs"
                  onClick={() => selectAction(item.onSelect)}
                >
                  {item.label}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-[max(24px,env(safe-area-inset-bottom))] @min-[774px]/reader:[scrollbar-gutter:stable_both-edges]"
        data-ui="customContent"
      >
        <div ref={readingMotionRef} className="mx-auto grid w-full min-w-0 max-w-[720px] gap-4">
          {renaming && (
            <form
              className="grid gap-2"
              onKeyDown={event => {
                if (event.key === "Escape" && !busy) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeRename();
                }
              }}
              onSubmit={event => {
                event.preventDefault();
                if (busy || !title.trim()) return;
                void onRename(title)
                  .then(closeRename)
                  .catch(() => {});
              }}
            >
              <Input
                ref={renameInput}
                autoFocus
                aria-label={ui.rename}
                value={title}
                maxLength={200}
                disabled={busy}
                onFocus={event => event.currentTarget.select()}
                onChange={event => setTitle(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={closeRename}>
                  {cancelLabel}
                </Button>
                <Button type="submit" disabled={busy || !title.trim()}>
                  {ui.save}
                </Button>
              </div>
            </form>
          )}
          {panel ? (
            <section
              className="grid min-w-0 gap-3"
              aria-label={panel === "prompt" ? ui.viewPrompt : ui.details}
            >
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 [&_svg]:size-3.5"
                  aria-label={ui.custom}
                  onClick={closePanel}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <h2 className="text-sm font-semibold">
                  {panel === "prompt" ? ui.viewPrompt : ui.details}
                </h2>
              </div>
              {panel === "prompt" ? (
                <pre className="whitespace-pre-wrap text-xs wrap-anywhere">
                  {document.request.prompt}
                </pre>
              ) : (
                <ExecutionDetails execution={document.execution} locale={locale} />
              )}
            </section>
          ) : (
            <SelectionSpeech locale={locale} scope={scope} disabled={busy}>
              <SafeMarkdown
                markdown={document.markdown}
                locale={locale}
                language={language}
                pronunciationMode={pronunciationMode}
              />
            </SelectionSpeech>
          )}
        </div>
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={open => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] max-w-[min(400px,calc(100%-2rem))] overflow-y-auto p-4 sm:max-w-[400px]"
          showCloseButton={false}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = actionFocus.current?.isConnected
              ? actionFocus.current
              : window.document.getElementById("page-nav-lessons");
            window.requestAnimationFrame(() => target?.focus());
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitleBar closeLabel={cancelLabel} closeDisabled={busy}>
              {action === "delete" ? ui.deleteLocal : ui.regenerate}
            </DialogTitleBar>
            <DialogDescription className="text-xs">
              {action === "delete" ? ui.deleteHint : ui.regenerateHint}
            </DialogDescription>
          </DialogHeader>
          {action === "regenerate" && (
            <div className="grid min-w-0 gap-2 text-xs wrap-anywhere">
              <p>{document.request.source.title}</p>
              <p>
                {document.execution.provider} · {document.execution.modelId}
              </p>
              <p>
                {document.request.cues.length} ·{" "}
                {document.request.analysisRange
                  ? `${formatDisplayTime(document.request.analysisRange.startMs)}–${formatDisplayTime(document.request.analysisRange.endMs)}`
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
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>
              {cancelLabel}
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
