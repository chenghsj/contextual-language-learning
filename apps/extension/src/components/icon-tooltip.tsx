import React, { useId, useState } from "react";

/** Shared tooltip surface for header and reader icon controls. */
export function IconTooltipContent({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      id={id}
      className="pointer-events-none absolute right-0 top-full z-50 pt-1"
    >
      <span className="block w-max max-w-[min(240px,80vw)] rounded-md bg-foreground px-2 py-1 text-[11px] font-normal text-background shadow-sm">
        {children}
      </span>
    </span>
  );
}

/** Descriptive icon help is available to pointer and keyboard users. */
export function IconTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
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
      onFocus={() => setOpen(true)}
      onBlur={close}
      onClick={close}
      onKeyDown={event => {
        if (event.key === "Escape") close();
      }}
    >
      {React.cloneElement(children, {
        "aria-describedby": open ? id : children.props["aria-describedby"],
      })}
      {open && <IconTooltipContent id={id}>{label}</IconTooltipContent>}
    </span>
  );
}
