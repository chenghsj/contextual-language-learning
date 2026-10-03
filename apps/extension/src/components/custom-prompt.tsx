import React, { useState } from "react";
import { customContentCopy, promptTemplates } from "../i18n/custom-content";
import type { UiLocale } from "../i18n/messages";
import { Textarea } from "./ui/textarea";
import { SelectField } from "./ui/select";
import { Switch } from "./ui/switch";
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
    [template, setTemplate] = useState("summary");
  return (
    <div className="grid gap-4">
      <label className="grid gap-2 text-xs">
        {ui.template}
        <SelectField
          ariaLabel={ui.template}
          value={template}
          onValueChange={key => {
            setTemplate(key);
            onPrompt(
              promptTemplates[key as keyof typeof promptTemplates] + `\nWrite in ${locale}.`,
            );
          }}
          options={Object.keys(promptTemplates).map(key => ({
            value: key,
            label: ui[key as keyof typeof promptTemplates],
          }))}
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
