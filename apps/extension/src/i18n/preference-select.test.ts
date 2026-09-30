import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

test("language and appearance settings use Radix Select", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const preferences = app.slice(
    app.indexOf('<h2>{t("uiLanguage")} · {t("appearance")}</h2>'),
    app.indexOf('<h2 id="agent-settings-heading" tabIndex={-1}>{t("agentHeading")}</h2>'),
  );
  assert.match(preferences, /<Select value=\{localePreference\} onValueChange=/);
  assert.match(preferences, /<Select value=\{themePreference\} onValueChange=/);
  assert.match(preferences, /<SelectTrigger id="ui-language-select"/);
  assert.match(preferences, /<SelectTrigger id="appearance-select"/);
  assert.match(preferences, /<SelectItem value="auto">/);
  assert.match(preferences, /<SelectItem value="zh-TW">/);
  for (const value of ["system", "light", "dark"]) {
    assert.ok(preferences.includes('<SelectItem value="' + value + '">'));
  }
  assert.doesNotMatch(preferences, /<NativeSelect|<option\b|<select\b/);
  assert.doesNotMatch(app, /<NativeSelect\b|<option\b|<select\b/);
  assert.match(preferences, /isLocalePreference\(next\)/);
  assert.match(preferences, /isThemePreference\(next\)/);
});

test("shadcn Select renders an accessible, keyboard-controlled combobox", () => {
  const html = renderToStaticMarkup(createElement(Select, { value: "light" },
    createElement(SelectTrigger, { id: "appearance-select", "aria-label": "Appearance" },
      createElement(SelectValue)),
    createElement(SelectContent, null,
      createElement(SelectItem, { value: "light" }, "Light"),
      createElement(SelectItem, { value: "dark" }, "Dark")),
  ));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Appearance"/);
  assert.match(html, /data-slot="select-trigger"/);
});

test("Radix popup and trigger follow the warm theme without an unstyled native dropdown", async () => {
  const select = await readFile(new URL("../components/ui/select.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(select, /SelectPrimitive\.Root/);
  assert.match(select, /SelectPrimitive\.Portal/);
  assert.match(select, /SelectPrimitive\.Content/);
  assert.match(select, /SelectPrimitive\.Item/);
  assert.match(select, /bg-popover text-popover-foreground/);
  assert.match(select, /focus:bg-accent focus:text-accent-foreground/);
  assert.match(css, /--primary: oklch\(0\.6171 0\.1375 39\.0427\)/);
  assert.match(select, /data-slot="select-trigger"/);
  assert.ok((await readFile(new URL("../App.tsx", import.meta.url), "utf8")).includes("[&_[data-slot=select-trigger]]:w-full"));
});
