import React from "react";
import { ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";

export function MaterialCard({
  title,
  sourceTitle,
  description,
  kindLabel,
  language,
  date,
  Icon,
  action,
  busy,
  disabled,
  conflict,
  onOpen,
  children,
}: {
  title: string;
  sourceTitle?: string;
  description: string;
  kindLabel: string;
  language: string;
  date?: string;
  Icon: LucideIcon;
  action: string;
  busy: boolean;
  disabled: boolean;
  conflict?: boolean;
  onOpen(): void;
  children?: React.ReactNode;
}) {
  const created = date ? new Date(date) : null;
  return (
    <Card className="material-shell flex h-full flex-col overflow-hidden">
      <Button
        variant="ghost"
        className="material-card"
        aria-busy={busy}
        disabled={disabled}
        onClick={onOpen}
      >
        <Icon className="entry-icon" aria-hidden="true" />
        <div className="entry-main">
          <span className="card-line">
            <Badge>{kindLabel}</Badge>
            {conflict && <Badge>備份待確認</Badge>}
            <span className="tiny muted">{language}</span>
            {created && Number.isFinite(created.getTime()) && (
              <time className="entry-date tiny muted" dateTime={date}>
                {created.toLocaleString("zh-TW", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            )}
            <Icon className="card-kind-icon" aria-hidden="true" />
          </span>
          <h3>{title}</h3>
          {sourceTitle && sourceTitle !== title && <p className="card-source">{sourceTitle}</p>}
          <p className="excerpt">{description}</p>
        </div>
        <span className="card-bottom">
          <span className="action-label">{busy ? "正在開啟…" : action}</span>
          {busy ? (
            <Loader2 className="spinning" aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </span>
      </Button>
      {children}
    </Card>
  );
}
