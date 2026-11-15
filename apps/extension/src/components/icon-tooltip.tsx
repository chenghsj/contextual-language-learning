import React, { useId, useState } from "react";

const restoredFocusTargets = new WeakSet<EventTarget>();

/** Restore dialog focus without reopening help that was dismissed on entry. */
export function restoreFocusWithoutTooltip(target: HTMLElement | null): void {
  if (!target) return;
  restoredFocusTargets.add(target);
  try {
    target.focus({ preventScroll: true });
  } finally {
    restoredFocusTargets.delete(target);
  }
}

/** Shared tooltip surface for header and reader icon controls. */
export function IconTooltipContent({
  id,
  children,
  side = "bottom",
}: {
  id: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span
      role="tooltip"
      id={id}
      className={
        "pointer-events-none absolute z-50 " +
        (side === "top" ? "left-0 bottom-full pb-1" : "right-0 top-full pt-1")
      }
    >
      <span className="block w-max max-w-[min(240px,80vw)] rounded-md bg-foreground px-2 py-1 text-ui-label font-normal text-background shadow-sm">
        {children}
      </span>
    </span>
  );
}

/** Descriptive icon help is available to pointer and keyboard users. */
export function IconTooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  function close(): void {
    setOpen(false);
  }
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onFocus={event =>
        setOpen(!restoredFocusTargets.has(event.target) && event.target.matches(":focus-visible"))
      }
      onBlur={close}
      onPointerDown={close}
      onClick={close}
      onKeyDown={event => {
        if (event.key === "Escape") close();
      }}
    >
      {React.cloneElement(children, {
        "aria-describedby": open ? id : children.props["aria-describedby"],
      })}
      {open && (
        <IconTooltipContent id={id} side={side}>
          {label}
        </IconTooltipContent>
      )}
    </span>
  );
}
