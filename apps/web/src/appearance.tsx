import React, { useEffect, useState } from "react";
import { LayoutGrid, List, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";

export type Theme = "system" | "light" | "dark";
export type Layout = "cards" | "list";
const THEME_KEY = "cll-web-theme";
const LAYOUT_KEY = "cll-web-layout";
function readTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {}
  return "system";
}
function readLayout(): Layout {
  try {
    if (localStorage.getItem(LAYOUT_KEY) === "list") return "list";
  } catch {}
  return "cards";
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current page still works when browser storage is unavailable.
  }
}
export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [layout, setLayout] = useState<Layout>(readLayout);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#262624" : "#faf9f5");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) setTheme(readTheme());
      if (event.key === LAYOUT_KEY || event.key === null) setLayout(readLayout());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return {
    theme,
    layout,
    changeTheme(value: Theme) {
      save(THEME_KEY, value);
      setTheme(value);
    },
    changeLayout(value: Layout) {
      save(LAYOUT_KEY, value);
      setLayout(value);
    },
  };
}
export function ThemeSwitch({ value, onChange }: { value: Theme; onChange(value: Theme): void }) {
  const Icon = value === "system" ? Monitor : value === "dark" ? Moon : Sun;
  return (
    <Select
      value={value}
      onValueChange={value => {
        if (value === "system" || value === "light" || value === "dark") onChange(value);
      }}
    >
      <SelectTrigger
        aria-label="外觀主題"
        title={
          "外觀主題：" + (value === "system" ? "跟隨系統" : value === "dark" ? "深色" : "淺色")
        }
        className="size-9 justify-center rounded-full p-0 [&>svg:last-child]:hidden"
      >
        <Icon aria-hidden="true" />
        <span className="sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="system">跟隨系統</SelectItem>
        <SelectItem value="light">淺色</SelectItem>
        <SelectItem value="dark">深色</SelectItem>
      </SelectContent>
    </Select>
  );
}
export function LayoutSwitch({
  value,
  onChange,
}: {
  value: Layout;
  onChange(value: Layout): void;
}) {
  return (
    <div className="layout-switch" role="group" aria-label="顯示方式">
      <Button
        size="icon"
        variant={value === "cards" ? "secondary" : "ghost"}
        aria-label="卡片顯示"
        title="卡片顯示"
        aria-pressed={value === "cards"}
        onClick={() => onChange("cards")}
      >
        <LayoutGrid />
      </Button>
      <Button
        size="icon"
        variant={value === "list" ? "secondary" : "ghost"}
        aria-label="列表顯示"
        title="列表顯示"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <List />
      </Button>
    </div>
  );
}
