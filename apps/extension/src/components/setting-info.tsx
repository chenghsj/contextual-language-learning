import { useEffect, useId, useRef } from "react";
import { Info } from "lucide-react";

export type SettingHelpChoice = { label: string; description: string };

/**
 * A click/keyboard-accessible info tooltip. Native <details> supports touch
 * screens and does not rely on hover (unlike the browser's title attribute).
 */
export function SettingInfo({
  label, infoLabel, explanation, choices = [],
}: {
  label: string;
  infoLabel: string;
  explanation: string;
  choices?: readonly SettingHelpChoice[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const contentId = useId();

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
    <details className="settingInfo" ref={ref}>
      <summary aria-label={infoLabel + " " + label} aria-controls={contentId}>
        <Info aria-hidden="true" size={15} />
      </summary>
      <div className="settingInfoPopover" id={contentId} role="note">
        <p>{explanation}</p>
        {choices.length > 0 && (
          <ul>
            {choices.map(choice => (
              <li key={choice.label}>
                <strong>{choice.label}</strong>
                <span>{choice.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
