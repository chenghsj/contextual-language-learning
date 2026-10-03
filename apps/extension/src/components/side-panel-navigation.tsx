import React from "react";
import { Library, WandSparkles } from "lucide-react";
import type { MessageKey } from "../i18n/messages";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export type SidePanelPage = "create" | "lessons" | "lesson" | "settings" | "activity";
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
    page === "lesson" ? "lessons" : page === "create" || page === "lessons" ? page : "";
  return (
    <nav className="shrink-0 border-b border-border pb-2" aria-label={t("navLabel")}>
      <ul className="flex flex-wrap items-center gap-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <Button
              variant="ghost"
              size="sm"
              id={"page-nav-" + id}
              aria-current={active === id ? "page" : undefined}
              aria-controls={"page-panel-" + id}
              onClick={() => onNavigate(id)}
              className={cn(
                "h-12 gap-1.5",
                active === id ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
