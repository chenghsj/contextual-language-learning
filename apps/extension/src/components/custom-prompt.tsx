import { useEffect, useRef, useState } from "react";
import { customContentCopy, promptTemplates } from "../i18n/custom-content";
import { createFlowCopy } from "../i18n/create-flow";
import type { UiLocale } from "../i18n/messages";
import { readDraft, writeDraft } from "../lib/draft-db";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { SelectField } from "./ui/select";
import { Switch } from "./ui/switch";
import { Disclosure } from "./disclosure";
type Template = { id: string; name: string; prompt: string };
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
    ux = createFlowCopy(locale);
  const [template, setTemplate] = useState("__custom__"),
    [templates, setTemplates] = useState<Template[]>([]),
    [name, setName] = useState(""),
    [loaded, setLoaded] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    let live = true;
    void readDraft<Template[]>("prompt-templates")
      .then(saved => {
        if (live && Array.isArray(saved))
          setTemplates(
            saved.filter(
              item =>
                typeof item?.id === "string" &&
                typeof item?.name === "string" &&
                typeof item?.prompt === "string" &&
                item.prompt.length <= 20000,
            ),
          );
      })
      .catch(() => {
        if (live) setStatus(ux.saveFailed);
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const saving = useRef(false);
  async function save(next: Template[]) {
    if (saving.current) return false;
    saving.current = true;
    setStatus(ux.saving);
    try {
      await writeDraft("prompt-templates", next);
      setTemplates(next);
      setStatus(ux.saved);
      return true;
    } catch {
      setStatus(ux.saveFailed);
      return false;
    } finally {
      saving.current = false;
    }
  }
  const current = templates.find(item => item.id === template);
  function apply(key: string) {
    const next =
      templates.find(item => item.id === key)?.prompt ??
      promptTemplates[key as keyof typeof promptTemplates] + `\nWrite in ${locale}.`;
    if (prompt !== next && prompt.trim() && !window.confirm(ux.replacePrompt)) return;
    setTemplate(key);
    setName(templates.find(item => item.id === key)?.name ?? "");
    onPrompt(next);
  }
  return (
    <div className="grid gap-4">
      <label className="grid gap-2 text-xs">
        {ui.template}
        <SelectField
          ariaLabel={ui.template}
          value={template}
          disabled={!loaded}
          onValueChange={apply}
          options={[
            { value: "__custom__", label: ui.prompt, disabled: true },
            ...Object.keys(promptTemplates).map(key => ({
              value: key,
              label: ui[key as keyof typeof promptTemplates],
            })),
            ...templates.map(item => ({ value: item.id, label: item.name })),
          ]}
        />
      </label>
      <label className="grid gap-2 text-xs">
        {ui.prompt}
        <Textarea
          className="min-h-48"
          maxLength={20000}
          value={prompt}
          onChange={event => onPrompt(event.target.value)}
        />
      </label>
      <Disclosure title={ux.templates}>
        <label className="grid gap-1 text-xs">
          {ux.name}
          <Input value={name} maxLength={100} onChange={event => setName(event.target.value)} />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded || status === ux.saving || !name.trim() || !prompt.trim()}
            onClick={() => {
              const id = crypto.randomUUID();
              void save([...templates, { id, name: name.trim(), prompt }]).then(saved => {
                if (saved) setTemplate(id);
              });
            }}
          >
            {ux.saveTemplate}
          </Button>
          {current && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!name.trim() || !prompt.trim()}
                onClick={() =>
                  void save(
                    templates.map(item =>
                      item.id === template ? { ...item, name: name.trim(), prompt } : item,
                    ),
                  )
                }
              >
                {ux.done}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(ux.deleteAction + " · " + current.name + "?"))
                    void save(templates.filter(item => item.id !== template)).then(saved => {
                      if (!saved) return;
                      setTemplate("__custom__");
                      setName("");
                    });
                }}
              >
                {ux.deleteAction}
              </Button>
            </>
          )}
        </div>
        {status && (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {status}
          </p>
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
    </div>
  );
}
