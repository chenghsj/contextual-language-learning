import { tw } from "../utility-classes";
import React, { useEffect, useRef } from "react";
import { Info } from "lucide-react";

type SettingInfoItem = { value: string; label: string; description: string };

/**
 * A click/keyboard-accessible info tooltip. Native <details> supports touch
 * screens and does not rely on hover (unlike the browser's title attribute).
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
    <details className={tw("detailsBase settingInfo")} ref={ref}>
      <summary className={tw("summaryBase settingInfoSummary")} aria-label={infoLabel + " " + label} aria-controls={contentId}>
        <Info aria-hidden="true" size={15} />
      </summary>
      <div className={tw("settingInfoPopover")} id={contentId} role="note">
        <p>{explanation}</p>
        {items && items.length > 0 && <ul className={tw("settingInfoLevels")}>
          {items.map(item => <li key={item.value}>
            <strong>{item.value} · {item.label}</strong>
            <span>{item.description}</span>
          </li>)}
        </ul>}
      </div>
    </details>
  );
}
