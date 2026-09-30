import React, { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

type SettingInfoItem = { value: string; label: string; description: string };
type Placement = { top: number; left: number; width: number };

/**
 * Click/keyboard-accessible field help. The popup is positioned from the
 * trigger's actual viewport rectangle, not a possibly unrelated "relative"
 * form row. This also keeps it within a narrow, scrolling Chrome Side Panel.
 */
export function SettingInfo({
  label, infoLabel, explanation, items,
}: {
  label: string;
  infoLabel: string;
  explanation: string;
  items?: readonly SettingInfoItem[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = React.useId();
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    const reposition = () => {
      const details = ref.current;
      if (!details?.open) { setPlacement(null); return; }
      const trigger = details.querySelector("summary");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(292, window.innerWidth - margin * 2);
      const height = Math.min(340, window.innerHeight * 0.55,
        contentRef.current?.scrollHeight ?? 220);
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin,
        rect.left + rect.width / 2 - width / 2));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - margin ? below
        : Math.max(margin, Math.min(rect.top - height - 6,
          window.innerHeight - height - margin));
      setPlacement({ top, left, width });
    };
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node &&
        !ref.current.contains(event.target)) {
        ref.current.open = false;
        setPlacement(null);
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      ref.current.open = false;
      setPlacement(null);
      ref.current.querySelector("summary")?.focus();
    };
    const details = ref.current;
    details?.addEventListener("toggle", reposition);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      details?.removeEventListener("toggle", reposition);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  return (
    <details className="group m-0 inline-flex size-7 shrink-0 items-center justify-center self-center border-0 bg-transparent p-0" ref={ref}>
      <summary className="grid size-7 cursor-pointer list-none place-items-center rounded-md p-0 text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 group-open:bg-muted group-open:text-primary [&::-webkit-details-marker]:hidden"
        aria-label={infoLabel + " " + label} aria-controls={contentId} aria-expanded={placement !== null}>
        <Info aria-hidden="true" size={15} />
      </summary>
      <div ref={contentRef} className="fixed z-50 max-h-[min(340px,55vh)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-[var(--radius)] border border-border bg-popover p-3 text-xs leading-[1.5] font-normal text-popover-foreground shadow-[0_8px_26px_#00000028] wrap-anywhere [&_p]:m-0 [&_p]:text-foreground"
        style={placement ?? { visibility: "hidden" }} id={contentId} role="note">
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
