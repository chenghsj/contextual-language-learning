import React, { useId, useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

/** File selection and pasted text are separate, explicit import actions. */
export function SubtitleImport({ value, onValueChange, onFile, onPaste, disabled, importedFileLabel, copy }: {
  value: string;
  onValueChange: (value: string) => void;
  onFile: (file: File) => void | Promise<void>;
  onPaste: (text: string) => void;
  disabled?: boolean;
  importedFileLabel?: string;
  copy: { hint: string; fileTab: string; pasteTab: string; fileHint: string; fileButton: string; pasteLabel: string; pasteButton: string; placeholder: string };
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const pasteId = useId();
  return <div className="my-3 grid gap-3">
    <p className="text-sm text-muted-foreground">{copy.hint}</p>
    <Input ref={fileInput} type="file" className="hidden" tabIndex={-1}
      aria-label={copy.fileButton} accept=".srt,.vtt,.txt,text/plain" disabled={disabled}
      onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void onFile(file);
      }} />
    <Tabs defaultValue="file">
      <TabsList aria-label={copy.hint}>
        <TabsTrigger value="file" disabled={disabled}>{copy.fileTab}</TabsTrigger>
        <TabsTrigger value="paste" disabled={disabled}>{copy.pasteTab}</TabsTrigger>
      </TabsList>
      <TabsContent value="file" className="grid gap-3">
        <p className="text-xs text-muted-foreground">{copy.fileHint}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="w-fit" disabled={disabled}
            onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden="true" />{copy.fileButton}
          </Button>
          {importedFileLabel && <span className="min-w-0 text-xs text-muted-foreground wrap-anywhere">{importedFileLabel}</span>}
        </div>
      </TabsContent>
      <TabsContent value="paste" className="grid gap-2">
        <label htmlFor={pasteId} className="text-xs font-semibold">{copy.pasteLabel}</label>
        <Textarea id={pasteId} className="resize-y" rows={5} value={value} disabled={disabled}
          placeholder={copy.placeholder} onChange={event => onValueChange(event.target.value)} />
        <Button variant="outline" className="w-fit" disabled={disabled || !value.trim()}
          onClick={() => onPaste(value)}>{copy.pasteButton}</Button>
      </TabsContent>
    </Tabs>
  </div>;
}
