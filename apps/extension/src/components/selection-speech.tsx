import React, { useEffect, useRef, useState, type ReactNode } from "react";
import type { LearningLanguage } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { selectionSpeechCopy, selectionSpeechLanguageName } from "../i18n/selection-speech";
import { speechCopy } from "../i18n/speech";
import { learningLanguageName, learningLanguageOptions } from "../i18n/preferences";
import { detectSelectionLanguage, type ReadingSelection } from "../lib/selection-language";
import { SpeechButton, SpeechStatus, useSystemSpeech } from "./system-speech";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";

/** Selection-only speech controls shared by Markdown and standard lesson readers. */
export function SelectionSpeech({
  children,
  locale,
  scope,
  disabled = false,
  beforeSpeak,
}: {
  children: ReactNode;
  locale: UiLocale;
  scope: string;
  disabled?: boolean;
  beforeSpeak?: (isCurrent: () => boolean) => Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const speech = useSystemSpeech();
  const ui = selectionSpeechCopy(locale);
  const [selection, setSelection] = useState<ReadingSelection>({
    text: "",
    context: "",
    reading: "",
  });
  const selectedText = selection.text;
  const [detectedLanguage, setDetectedLanguage] = useState<{
    selection: ReadingSelection;
    language?: LearningLanguage;
  }>();
  const [manualLanguage, setManualLanguage] = useState<{
    selection: ReadingSelection;
    language: LearningLanguage;
  }>();
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [selectionSide, setSelectionSide] = useState<"top" | "bottom">("bottom");
  const selectionRange = useRef<Range | null>(null);
  const selectionFocusRange = useRef<Range | null>(null);
  const boundary = useRef<HTMLElement | null>(null);
  const selecting = useRef(false);
  const [anchor, setAnchor] = useState({ getBoundingClientRect: () => new DOMRect() });
  const selectionAnchor = useRef(anchor);
  selectionAnchor.current = anchor;
  const closeSelection = () => {
    setSelectionOpen(false);
    void speech?.controller.stop(scope).catch(() => {});
  };
  const selectedLanguage =
    manualLanguage?.selection === selection
      ? manualLanguage.language
      : detectedLanguage?.selection === selection
        ? detectedLanguage.language
        : undefined;
  const detectingLanguage =
    !!selectedText &&
    detectedLanguage?.selection !== selection &&
    manualLanguage?.selection !== selection;
  useEffect(() => {
    if (!selection.text) return;
    let live = true;
    void detectSelectionLanguage(selection, locale === "zh-CN" ? "zh-CN" : "zh-TW").then(
      language => {
        if (live) setDetectedLanguage({ selection, language });
      },
    );
    return () => {
      live = false;
    };
  }, [selection, locale]);
  const speechUi = speechCopy(locale);
  const fullLanguageName = selectedLanguage ? learningLanguageName(selectedLanguage, locale) : "";
  const automaticLanguageName =
    detectedLanguage?.selection === selection && detectedLanguage.language
      ? `${ui.automaticLanguage} (${learningLanguageName(detectedLanguage.language, locale)})`
      : ui.automaticLanguage;
  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.focusNode) {
      closeSelection();
      return;
    }
    const range = selection.getRangeAt(0);
    const markdown = rootRef.current;
    if (!markdown?.contains(range.startContainer) || !markdown.contains(range.endContainer)) return;
    let scrollParent = markdown.parentElement;
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY))
      scrollParent = scrollParent.parentElement;
    boundary.current = scrollParent;
    const rectangle = range.getBoundingClientRect();
    const viewport = scrollParent?.getBoundingClientRect();
    if (
      rectangle.bottom < (viewport?.top ?? 0) ||
      rectangle.top > (viewport?.bottom ?? innerHeight)
    ) {
      closeSelection();
      return;
    }
    const fragment = range.cloneContents();
    fragment.querySelectorAll("rt, rp").forEach(node => node.remove());
    const element =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const ruby = element?.closest("ruby");
    const sameRuby = ruby?.contains(range.endContainer);
    const block = element?.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote");
    const endElement =
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    const tagged = element?.closest("[lang]");
    const languageHint =
      tagged && rootRef.current?.contains(tagged) && endElement?.closest("[lang]") === tagged
        ? (tagged.getAttribute("lang") ?? undefined)
        : undefined;
    const next = {
      text: fragment.textContent?.trim() ?? "",
      context: block?.textContent ?? "",
      reading: sameRuby ? (ruby?.dataset.reading ?? "") : "",
      languageHint,
    };
    if (!next.text) {
      closeSelection();
      return;
    }
    const previousRange = selectionRange.current;
    const previousFocus = selectionFocusRange.current;
    if (
      !previousRange ||
      previousRange.startContainer !== range.startContainer ||
      previousRange.startOffset !== range.startOffset ||
      previousRange.endContainer !== range.endContainer ||
      previousRange.endOffset !== range.endOffset ||
      previousFocus?.startContainer !== selection.focusNode ||
      previousFocus?.startOffset !== selection.focusOffset
    ) {
      const savedRange = range.cloneRange();
      selectionRange.current = savedRange;
      const focusRange = range.cloneRange();
      focusRange.setStart(selection.focusNode, selection.focusOffset);
      focusRange.collapse(true);
      selectionFocusRange.current = focusRange;
      const focusAtStart =
        selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
      setSelectionSide(focusAtStart ? "top" : "bottom");
      setAnchor({
        getBoundingClientRect: () => {
          // Follow the focus horizontally, but let collision flipping clear every selected line.
          const selected = savedRange.getBoundingClientRect();
          const focus = focusRange.getBoundingClientRect();
          let x = focus.x;
          // Element-boundary selections can have no collapsed caret rectangle.
          if (focus.height === 0) {
            const parts = Array.from(savedRange.getClientRects()).filter(part => part.height > 0);
            const part = (focusAtStart ? parts[0] : parts[parts.length - 1]) ?? selected;
            x = focusAtStart ? part.left : part.right;
          }
          return new DOMRect(x, selected.top, 0, selected.height);
        },
      });
    }
    if (!selecting.current) setSelectionOpen(!!next.text);
    setSelection(previous =>
      previous.text === next.text &&
      previous.context === next.context &&
      previous.reading === next.reading &&
      previous.languageHint === next.languageHint
        ? previous
        : next,
    );
  };
  useEffect(() => {
    const start = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        selecting.current = true;
      }
    };
    const finish = () => {
      const wasSelecting = selecting.current;
      selecting.current = false;
      if (wasSelecting) {
        captureSelection();
      }
    };
    window.document.addEventListener("selectionchange", captureSelection);
    window.document.addEventListener("pointerdown", start);
    window.document.addEventListener("pointerup", finish);
    return () => {
      window.document.removeEventListener("selectionchange", captureSelection);
      window.document.removeEventListener("pointerdown", start);
      window.document.removeEventListener("pointerup", finish);
    };
  }, []);
  useEffect(() => {
    if (!selectionOpen) return;
    const enterPopup = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const popup = popupRef.current;
      if (!popup || popup.contains(window.document.activeElement)) return;
      const controls = popup.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      const control = event.shiftKey ? controls[controls.length - 1] : controls[0];
      if (control) {
        event.preventDefault();
        control.focus();
      }
    };
    window.document.addEventListener("keydown", enterPopup);
    return () => window.document.removeEventListener("keydown", enterPopup);
  }, [selectionOpen]);

  useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target;
      const root = rootRef.current;
      if (
        target === window.document ||
        (target instanceof Element && root && (root.contains(target) || target.contains(root)))
      )
        closeSelection();
    };
    window.document.addEventListener("scroll", onScroll, true);
    return () => window.document.removeEventListener("scroll", onScroll, true);
  }, [speech?.controller, scope]);
  useEffect(
    () => () => {
      void speech?.controller.stop(scope).catch(() => {});
    },
    [speech?.controller, scope],
  );
  return (
    <div
      ref={rootRef}
      className="min-w-0"
      data-ui="selection-speech-region"
      onMouseUp={captureSelection}
      onKeyUp={event => {
        if (
          event.key !== "Escape" &&
          event.target instanceof Node &&
          rootRef.current?.contains(event.target)
        ) {
          captureSelection();
        }
      }}
    >
      {children}
      <Popover
        open={selectionOpen && !!selectedText}
        onOpenChange={open => {
          if (!open) closeSelection();
        }}
      >
        <PopoverAnchor virtualRef={selectionAnchor} />
        <PopoverContent
          ref={popupRef}
          side={selectionSide}
          sideOffset={8}
          collisionPadding={12}
          collisionBoundary={boundary.current ?? undefined}
          align="start"
          className="w-auto max-w-[calc(100vw-24px)] p-1"
          aria-label={ui.selectedOriginal}
          data-ui="selection-speech-popup"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
        >
          <div className="flex items-center gap-1">
            <SpeechButton
              locale={locale}
              scope={scope}
              speechKey="selection"
              text={selectedText}
              language={selectedLanguage ?? "en"}
              beforeSpeak={beforeSpeak}
              label={ui.selectedOriginal}
              disabled={disabled || !selectedText || !selectedLanguage}
              className="size-8"
              onPointerDown={event => event.preventDefault()}
            />
            <Select
              value={manualLanguage?.selection === selection ? manualLanguage.language : "auto"}
              onValueChange={value => {
                setManualLanguage(
                  value === "auto" ? undefined : { selection, language: value as LearningLanguage },
                );
                void speech?.controller.stop(scope).catch(() => {});
              }}
            >
              <SelectTrigger
                aria-label={
                  fullLanguageName ? `${speechUi.language}: ${fullLanguageName}` : speechUi.language
                }
                title={
                  manualLanguage?.selection === selection ? fullLanguageName : automaticLanguageName
                }
                className="h-8 w-auto max-w-44 justify-start gap-1 border-0 px-2 text-xs shadow-none"
              >
                <SelectValue>
                  {selectedLanguage
                    ? selectionSpeechLanguageName(selectedLanguage, locale)
                    : detectingLanguage
                      ? ui.detectingLanguage
                      : ui.chooseLanguage}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{automaticLanguageName}</SelectItem>
                {learningLanguageOptions(locale).map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedLanguage && (
            <div className="max-w-64">
              <SpeechStatus locale={locale} language={selectedLanguage} />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
