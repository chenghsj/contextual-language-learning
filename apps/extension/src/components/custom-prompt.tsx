import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { customContentCopy, promptTemplates } from "../i18n/custom-content";
import { createFlowCopy } from "../i18n/create-flow";
import { promptTemplateCopy } from "../i18n/prompt-templates";
import { builtinPrompt, identifyBuiltinPrompt } from "../i18n/builtin-prompts";
import type { UiLocale } from "../i18n/messages";
import { readDraft, writeDraft } from "../lib/draft-db";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button, destructiveOutlineClassName } from "./ui/button";
import { SelectField } from "./ui/select";
import { Switch } from "./ui/switch";
import { Disclosure } from "./disclosure";
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogFooter } from "./ui/dialog";
import { DialogTitleBar } from "./dialog-title-bar";

type Template = { id: string; name: string; prompt: string };
type TemplateEditor = { id?: string; name: string; prompt: string };
const builtins = Object.keys(promptTemplates) as (keyof typeof promptTemplates)[];
export function CustomPrompt({
  locale,
  prompt,
  onPrompt,
  context,
  onContext,
}: {
  locale: UiLocale;
  prompt: string;
  onPrompt: (value: string) => void;
  context: { title: boolean; subtitles: boolean };
  onContext: (value: { title: boolean; subtitles: boolean }) => void;
}) {
  const ui = customContentCopy(locale),
    ux = createFlowCopy(locale),
    copy = promptTemplateCopy(locale);
  const [template, setTemplate] = useState<string>(
    () => identifyBuiltinPrompt(prompt) ?? "__custom__",
  );
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<TemplateEditor | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [undo, setUndo] = useState<{ template: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false),
    fieldId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  function restoreFocus(event: Event) {
    event.preventDefault();
    (returnFocus.current?.isConnected ? returnFocus.current : addButton.current)?.focus();
  }
  const selectedPrompt =
    templates.find(item => item.id === template)?.prompt ??
    (builtins.includes(template as keyof typeof promptTemplates)
      ? builtinPrompt(template as keyof typeof promptTemplates, locale)
      : undefined);
  const selection = selectedPrompt === prompt ? template : "__custom__";
  useEffect(() => {
    if (!builtins.includes(template as keyof typeof promptTemplates)) return;
    const key = identifyBuiltinPrompt(prompt);
    if (!key) return;
    const localized = builtinPrompt(key, locale);
    if (template !== key) setTemplate(key);
    if (prompt !== localized) onPrompt(localized);
  }, [locale, prompt, template, onPrompt]);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoaded(false);
    setLoadError("");
    try {
      const saved = await readDraft<Template[]>("prompt-templates");
      if (version !== loadVersion.current) return;
      setTemplates(
        Array.isArray(saved)
          ? saved.filter(
              item =>
                typeof item?.id === "string" &&
                typeof item?.name === "string" &&
                typeof item?.prompt === "string" &&
                item.prompt.length <= 20000,
            )
          : [],
      );
      setLoaded(true);
    } catch {
      if (version === loadVersion.current) setLoadError(copy.loadFailed);
    }
  }, [copy.loadFailed]);
  useEffect(() => {
    void load();
    return () => {
      ++loadVersion.current;
    };
  }, [load]);
  async function save(next: Template[]) {
    if (!loaded || saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await writeDraft("prompt-templates", next);
      setTemplates(next);
      return true;
    } catch {
      setError(ux.saveFailed);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function apply(key: string) {
    const saved = templates.find(item => item.id === key);
    const builtin = builtins.find(item => item === key);
    if (!saved && !builtin) return;
    const next = saved?.prompt ?? builtinPrompt(builtin!, locale);
    if (prompt !== next) setUndo({ template: selection, prompt });
    setTemplate(key);
    onPrompt(next);
  }
  async function saveEditor() {
    if (!editor?.name.trim() || !editor.prompt.trim() || saving.current) return;
    const item = {
      id: editor.id ?? crypto.randomUUID(),
      name: editor.name.trim(),
      prompt: editor.prompt,
    };
    const next = editor.id
      ? templates.map(entry => (entry.id === item.id ? item : entry))
      : [...templates, item];
    if (!(await save(next))) return;
    if (!editor.id || selection === item.id) {
      setTemplate(item.id);
      onPrompt(item.prompt);
    }
    setUndo(null);
    setEditor(null);
  }
  return (
    <div className="grid gap-4" data-ui="custom-prompt">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs">{ui.template}</span>
          <div className="flex items-center gap-1">
            {undo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setTemplate(undo.template);
                  onPrompt(undo.prompt);
                  setUndo(null);
                }}
              >
                {copy.undo}
              </Button>
            )}
            <Button
              ref={addButton}
              variant="outline"
              size="sm"
              disabled={!loaded || busy}
              onClick={event => {
                returnFocus.current = event.currentTarget;
                setError("");
                setEditor({ name: "", prompt });
              }}
            >
              {copy.add}
            </Button>
          </div>
        </div>
        <SelectField
          ariaLabel={ui.template}
          value={selection}
          disabled={!loaded || busy}
          onValueChange={apply}
          options={[
            { value: "__custom__", label: copy.custom, disabled: true },
            ...builtins.map(key => ({ value: key, label: ui[key] })),
            ...templates.map(item => ({ value: item.id, label: item.name })),
          ]}
        />
      </div>
      {loadError && (
        <div className="flex items-center justify-between gap-2">
          <p role="alert" className="text-xs text-destructive">
            {loadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {copy.retry}
          </Button>
        </div>
      )}
      <label className="grid gap-2 text-xs">
        {ui.prompt}
        <Textarea
          className="min-h-48"
          maxLength={20000}
          value={prompt}
          onChange={event => {
            setTemplate("__custom__");
            setUndo(null);
            onPrompt(event.target.value);
          }}
        />
      </label>
      <Disclosure title={ux.templates}>
        {templates.length ? (
          <ul className="grid gap-2">
            {templates.map(item => (
              <li key={item.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words text-xs">{item.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${ux.edit} · ${item.name}`}
                  onClick={event => {
                    returnFocus.current = event.currentTarget;
                    setError("");
                    setEditor({ ...item });
                  }}
                >
                  {ux.edit}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${ux.deleteAction} · ${item.name}`}
                  onClick={event => {
                    returnFocus.current = event.currentTarget;
                    setError("");
                    setDeleting(item);
                  }}
                >
                  {ux.deleteAction}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{copy.empty}</p>
        )}
      </Disclosure>
      {(["subtitles", "title"] as const).map(key => (
        <label key={key} className="flex items-center justify-between gap-3 text-xs">
          {ui[key]}
          <Switch
            checked={context[key]}
            onCheckedChange={checked => onContext({ ...context, [key]: checked })}
          />
        </label>
      ))}
      <Dialog
        open={!!editor}
        onOpenChange={open => {
          if (!open && !busy) {
            setEditor(null);
            setError("");
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto motion-reduce:animate-none"
        >
          <DialogHeader className="text-left">
            <DialogTitleBar closeLabel={ux.close} closeDisabled={busy}>
              {editor?.id ? ux.edit : copy.add}
            </DialogTitleBar>
            <DialogDescription className="text-xs">
              {editor?.id ? copy.editHelp : copy.createHelp}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={event => {
              event.preventDefault();
              void saveEditor();
            }}
          >
            <label className="grid gap-1 text-xs" htmlFor={fieldId + "-name"}>
              {ux.name}
              <Input
                id={fieldId + "-name"}
                autoFocus
                maxLength={100}
                value={editor?.name ?? ""}
                disabled={busy}
                onChange={event => {
                  setError("");
                  setEditor(current =>
                    current ? { ...current, name: event.target.value } : current,
                  );
                }}
              />
            </label>
            <label className="grid gap-1 text-xs" htmlFor={fieldId + "-prompt"}>
              {ui.prompt}
              <Textarea
                id={fieldId + "-prompt"}
                className="min-h-48"
                maxLength={20000}
                value={editor?.prompt ?? ""}
                disabled={busy}
                onChange={event => {
                  setError("");
                  setEditor(current =>
                    current ? { ...current, prompt: event.target.value } : current,
                  );
                }}
              />
            </label>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setEditor(null)}>
                {ux.cancel}
              </Button>
              <Button
                type="submit"
                disabled={busy || !editor?.name.trim() || !editor.prompt.trim()}
              >
                {busy ? ux.saving : editor?.id ? copy.update : copy.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={open => {
          if (!open && !busy) {
            setDeleting(null);
            setError("");
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          showCloseButton={false}
          className="motion-reduce:animate-none"
        >
          <DialogHeader className="text-left">
            <DialogTitleBar closeLabel={ux.close} closeDisabled={busy}>
              {ux.deleteAction} · {deleting?.name}
            </DialogTitleBar>
            <DialogDescription className="text-xs">{copy.deleteHelp}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 sm:space-x-0">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(null)}>
              {ux.cancel}
            </Button>
            <Button
              variant="outline"
              className={destructiveOutlineClassName}
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!deleting || saving.current) return;
                const item = deleting;
                void save(templates.filter(entry => entry.id !== item.id)).then(saved => {
                  if (!saved) return;
                  if (template === item.id) setTemplate("__custom__");
                  setUndo(null);
                  setDeleting(null);
                });
              }}
            >
              {busy ? ux.saving : ux.deleteAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
