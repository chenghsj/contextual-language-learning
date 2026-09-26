import React, { useEffect, useRef } from "react";
import { Info } from "lucide-react";

type SettingInfoItem = { value: string; label: string; description: string };

/**
 * Click/keyboard-accessible help, anchored to the nearest positioned field
 * heading or controls row. Keep this separate from the native details styles
 * used by collapsible form sections, which have margins, borders and padding.
 */
export function SettingInfo({
  label, infoLabel, explanation, items
}: {
  label: string;
  infoLabel: string;
  explanation: string;
  items?: readonly SettingInfoItem[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const contentId = React.useId();

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node &&
        !ref.current.contains(event.target)) {
        ref.current.open = false;
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);

  return (
    <details className="group m-0 inline-flex size-7 shrink-0 items-center justify-center self-center border-0 bg-transparent p-0" ref={ref}>
      <summary className="grid size-7 cursor-pointer list-none place-items-center rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 group-open:bg-muted group-open:text-primary [&::-webkit-details-marker]:hidden"
        aria-label={infoLabel + " " + label} aria-controls={contentId}>
        <Info aria-hidden="true" size={15} />
      </summary>
      <div className="absolute top-[calc(100%+6px)] right-0 z-50 max-h-[min(340px,55vh)] w-[min(292px,calc(100vw-44px))] max-w-[calc(100vw-44px)] overflow-y-auto rounded-[var(--radius)] border border-border bg-popover p-3 text-xs leading-[1.5] font-normal text-popover-foreground shadow-[0_8px_26px_#00000028] wrap-anywhere [&_p]:m-0 [&_p]:text-foreground"
        id={contentId} role="note">
        <p>{explanation}</p>
        {items && items.length > 0 && <ul className="mt-[10px] grid list-none gap-2 p-0 [&_li]:min-w-0 [&_li]:border-t [&_li]:border-border [&_li]:pt-2 [&_strong]:block [&_strong]:text-xs [&_strong]:font-[650] [&_strong]:text-foreground [&_span]:block [&_span]:text-[11px] [&_span]:leading-[1.5] [&_span]:text-muted-foreground [&_span]:wrap-anywhere">
          {items.map(item => <li key={item.value}>
            <strong>{item.value} · {item.label}</strong>
            <span>{item.description}</span>
          </li>)}
        </ul>}
      </div>
    </details>
  );
}
