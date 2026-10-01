import React from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";

/** A single application section using the standard shadcn Accordion. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  ...props
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "defaultValue" | "dir">) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? "content" : undefined}
      {...props}
    >
      <AccordionItem value="content">
        <AccordionTrigger>{title}</AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
