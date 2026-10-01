import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { getBrowserLocale, resolveTheme } from "./i18n/preferences";

// Apply browser-language and system-theme defaults before React first renders.
document.documentElement.lang = getBrowserLocale();
const initialTheme = resolveTheme(
  "system",
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.documentElement.dataset.theme = initialTheme;
document.documentElement.classList.toggle("dark", initialTheme === "dark");

createRoot(document.getElementById("root")!).render(<App />);
