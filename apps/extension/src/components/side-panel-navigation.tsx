import React from "react";
import { Library, WandSparkles } from "lucide-react";
import type { MessageKey } from "../i18n/messages";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export type SidePanelPage = "create" | "lessons" | "lesson" | "settings" | "activity" | "custom";
export type PrimaryPage = "create" | "lessons";
type Tab = PrimaryPage;
const tabs: { id: Tab; label: MessageKey; icon: typeof Library }[] = [
  { id: "create", label: "create", icon: WandSparkles },
  { id: "lessons", label: "lessonLibrary", icon: Library },
];

export function SidePanelNavigation({
  page,
  onNavigate,
  t,
}: {
  page: SidePanelPage;
  onNavigate: (page: Tab) => void;
  t: (key: MessageKey) => string;
}) {
  if (page === "settings" || page === "activity") return null;
  const active =
    page === "lesson" || page === "custom"
      ? "lessons"
      : page === "create" || page === "lessons"
        ? page
        : "";
  return (
    <nav className="@container shrink-0 border-b border-border pb-2" aria-label={t("navLabel")}>
      <ul className="grid grid-cols-2 items-stretch gap-1 @sm:flex">
        {tabs.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex min-w-0">
            <Button
              variant="ghost"
              size="sm"
              id={"page-nav-" + id}
              aria-current={active === id ? "page" : undefined}
              aria-controls={"page-panel-" + id}
              onClick={() => onNavigate(id)}
              className={cn(
                "h-auto min-h-9 w-full min-w-0 gap-1.5 px-2 py-1 whitespace-normal",
                active === id ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden="true" />
              <span className="min-w-0 wrap-anywhere">{t(label)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
