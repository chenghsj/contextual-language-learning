import React from "react";
import type { UiLocale } from "../i18n/messages";
import { createFlowCopy } from "../i18n/create-flow";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/** Keep the destination visible while its full path remains available on demand. */
export function RequestFolderSelection({
  locale,
  directory,
  defaultPath,
  disabled,
  onChoose,
}: {
  locale: UiLocale;
  directory?: string;
  defaultPath: string;
  disabled: boolean;
  onChoose(): void;
}) {
  const copy = createFlowCopy(locale);
  const fullPath = directory ?? defaultPath;
  const folder = directory
    ? directory
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .at(-1) || directory
    : copy.defaultFolderName;
  return (
    <div className="flex min-w-0 items-start gap-2" data-ui="request-folder-selection">
      <Disclosure
        key={fullPath}
        className="min-w-0 flex-1 [&>div]:border-b-0 [&_h3>button]:min-h-8 [&_h3>button]:py-1 [&_h3>button]:text-xs [&_h3>button]:font-normal [&_h3>button]:hover:no-underline"
        title={
          <span className="min-w-0 truncate text-left" title={fullPath}>
            {folder}
            <span className="sr-only"> · {copy.folderDetails}</span>
          </span>
        }
      >
        <p
          className="pt-1 text-xs leading-5 text-muted-foreground break-all"
          data-ui="request-folder-path"
        >
          {fullPath}
        </p>
      </Disclosure>
      <Button variant="ghost" size="sm" className="shrink-0" disabled={disabled} onClick={onChoose}>
        {copy.changeFolder}
      </Button>
    </div>
  );
}
