import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureId = "/selection-position-fixture.tsx";
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  plugins: [
    {
      name: "selection-position-fixture",
      resolveId: id => (id === fixtureId ? "\0" + fixtureId : undefined),
      load: id =>
        id === "\0" + fixtureId
          ? `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { SelectionSpeech } from "/src/components/selection-speech.tsx";
      import { SystemSpeechProvider } from "/src/components/system-speech.tsx";
      import { SpeechController } from "/src/native/speech-controller.ts";
      import { LEARNING_LANGUAGES } from "@contextual/core";
      import "/src/styles.css";
      window.spoken = [];
      const controller = new SpeechController(onMessage => ({
        send(request) {
          if (request.type === "listSpeechVoices") onMessage({id:request.id,type:"speechVoices",supported:true,
            voices:LEARNING_LANGUAGES.map(language => ({id:language,name:language,language,neural:true}))});
          if (request.type === "stopSpeech") onMessage({id:request.id,type:"speechStopped"});
          if (request.type === "speak") {
            window.spoken.push(request.input);
            onMessage({id:request.id,type:"speechFinished",status:"completed"});
          }
        },
        close() {},
      }));
      const locale = new URLSearchParams(location.search).get("locale") || "zh-TW";
      createRoot(document.getElementById("root")).render(
        React.createElement(SystemSpeechProvider, {controller},
        React.createElement(SelectionSpeech, {locale,scope:"position-test"},
          React.createElement("div", {id:"fixture",lang:"zh-TW",style:{marginLeft:innerWidth < 800 ? 24 : 240,marginTop:240,width:innerWidth < 800 ? innerWidth - 48 : 600,fontSize:16,lineHeight:"32px"}},
            React.createElement("p", {id:"first"}, "選取這一整行文字來確認浮動視窗的位置。"),
            React.createElement("p", {id:"last"}, "跨行選取也應該跟隨最後選到的字元。")
          )
        ))
      );
    `
          : undefined,
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url?.split("?")[0] !== "/selection-position-fixture.html") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await server.transformIndexHtml(
              req.url,
              `<div id="root"></div><script type="module" src="${fixtureId}"></script>`,
            ),
          );
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0] + "selection-position-fixture.html");
  await page.locator("#last").waitFor();
  const textRect = id =>
    page.locator(id).evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, y: rect.y + rect.height / 2 };
    });
  const first = await textRect("#first");
  const last = await textRect("#last");
  const popup = page.locator('[data-ui="selection-speech-popup"]');
  const failures = [];
  async function check(name, expected, side) {
    await popup.waitFor();
    await popup.evaluate(el =>
      Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))),
    );
    // Wait for language detection and floating-position updates to settle.
    await page.waitForTimeout(100);
    const focus = await page.evaluate(() => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(selection.focusNode, selection.focusOffset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      const selected = selection.getRangeAt(0).getBoundingClientRect();
      return {
        x: rect.x,
        top: rect.top,
        bottom: rect.bottom,
        text: selection.toString(),
        selectedTop: selected.top,
        selectedBottom: selected.bottom,
        side:
          selection.focusNode === selection.getRangeAt(0).startContainer &&
          selection.focusOffset === selection.getRangeAt(0).startOffset
            ? "top"
            : "bottom",
      };
    });
    if (expected) Object.assign(focus, expected);
    assert.ok(focus.text.length > 0, name + " selects text");
    const box = await popup.boundingBox();
    try {
      assert.ok(
        Math.abs(box.x - focus.x) <= 2,
        `${name}: popup x=${box.x}, selection focus x=${focus.x}`,
      );
      const actualSide = await popup.getAttribute("data-side");
      assert.equal(actualSide, side ?? focus.side, name + ": follows selection direction");
      assert.ok(
        actualSide === "bottom"
          ? Math.abs(box.y - focus.selectedBottom - 8) <= 2
          : Math.abs(box.y + box.height + 8 - focus.selectedTop) <= 2,
        `${name}: popup must stay outside the entire selected range`,
      );
      assert.ok(box.width <= 130, `${name}: compact popup width=${box.width}`);
      const play = await popup
        .getByRole("button", { name: "朗讀選取原文", exact: true })
        .boundingBox();
      assert.ok(play.width >= 32 && play.height >= 32, "speech button remains usable");
      console.log("PASS " + name);
    } catch (error) {
      failures.push(error.message);
      console.error("FAIL " + error.message);
    }
  }
  for (const multiline of [false, true]) {
    const end = multiline ? last : first;
    for (const backward of [false, true]) {
      await page.mouse.click(1000, 100);
      const startPoint = backward
        ? { x: end.right - 1, y: end.y }
        : { x: first.left + 1, y: first.y };
      const endPoint = backward
        ? { x: first.left - 160, y: first.y }
        : { x: end.right + 160, y: end.y };
      await page.mouse.move(startPoint.x, startPoint.y);
      await page.mouse.down();
      await page.mouse.move(endPoint.x, endPoint.y, { steps: 12 });
      await page.mouse.up();
      await check(
        `${multiline ? "multiline" : "single line"} ${backward ? "right to left" : "left to right"}, pointer outside text`,
      );
    }
  }
  for (const backward of [false, true]) {
    await page.evaluate(backward => {
      const first = document.querySelector("#first").firstChild;
      const last = document.querySelector("#last").firstChild;
      window
        .getSelection()
        .setBaseAndExtent(
          backward ? last : first,
          backward ? last.length : 0,
          backward ? first : last,
          backward ? 0 : last.length,
        );
      document.dispatchEvent(new Event("selectionchange"));
    }, backward);
    await check("programmatic selection " + (backward ? "backward" : "forward"));
    await page.keyboard.press(backward ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    await check("keyboard adjusts selection " + (backward ? "backward" : "forward"));
  }
  await page.locator("#last").evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await check("element-boundary selection", { x: last.right, top: last.top });
  assert.equal(await popup.getByRole("combobox").textContent(), "繁中");
  await popup.getByRole("combobox").click();
  await page.getByRole("option", { name: "自動偵測 (中文（繁體）)", exact: true }).waitFor();
  await page.getByRole("option", { name: "日語", exact: true }).click();
  assert.equal(await popup.getByRole("combobox").textContent(), "日語");
  await popup.getByRole("button", { name: "朗讀選取原文", exact: true }).click();
  await page.waitForFunction(() => window.spoken.length === 1);
  assert.equal(await page.evaluate(() => window.spoken[0].language), "ja");
  await popup.getByRole("combobox").click();
  await page.getByRole("option", { name: "自動偵測 (中文（繁體）)", exact: true }).click();
  assert.equal(await popup.getByRole("combobox").textContent(), "繁中");
  console.log("PASS compact language control, automatic detection, manual selection and speech");
  await page.mouse.click(1000, 100);
  await popup.waitFor({ state: "hidden" });
  console.log("PASS outside click closes popup");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await page.close();

  for (const [width, theme] of [
    [320, "light"],
    [480, "dark"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + "selection-position-fixture.html");
    await page.locator("#last").waitFor();
    await page.evaluate(
      theme => document.documentElement.classList.toggle("dark", theme === "dark"),
      theme,
    );
    const popup = page.locator('[data-ui="selection-speech-popup"]');
    for (const [edge, backward, side] of [
      ["middle", false, "bottom"],
      ["middle", true, "top"],
      ["bottom", false, "top"],
      ["top", true, "bottom"],
    ]) {
      await page.mouse.click(width - 2, 798);
      await page.evaluate(
        ({ edge, backward }) => {
          const fixture = document.querySelector("#fixture");
          fixture.style.marginTop =
            (edge === "top"
              ? 16
              : edge === "bottom"
                ? innerHeight - fixture.getBoundingClientRect().height - 16
                : 240) + "px";
          const first = document.querySelector("#first").firstChild;
          const last = document.querySelector("#last").firstChild;
          window
            .getSelection()
            .setBaseAndExtent(
              backward ? last : first,
              backward ? last.length : 0,
              backward ? first : last,
              backward ? 0 : last.length,
            );
          document.dispatchEvent(new Event("selectionchange"));
        },
        { edge, backward },
      );
      await popup.waitFor();
      await popup.getByRole("combobox").filter({ hasText: "繁中" }).waitFor();
      await popup.evaluate(el =>
        Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))),
      );
      await page.waitForTimeout(100);
      assert.equal(await popup.getAttribute("data-side"), side);
      const box = await popup.boundingBox();
      assert.ok(box.width <= 130);
      const languageGap = await popup.getByRole("combobox").evaluate(el => {
        const label = el.querySelector('[data-slot="select-value"]').getBoundingClientRect();
        const arrow = el.querySelector("svg").getBoundingClientRect();
        return arrow.left - label.right;
      });
      assert.ok(Math.abs(languageGap - 4) <= 0.5, `language-to-arrow gap=${languageGap}`);
      assert.ok(box.x >= 12 && box.x + box.width <= width - 12);
      assert.ok(box.y >= 12 && box.y + box.height <= 788);
      const selected = await page.evaluate(() => {
        const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
      assert.ok(
        side === "bottom" ? box.y >= selected.bottom + 7 : box.y + box.height <= selected.top - 7,
        "edge collision must still clear the whole selection",
      );
      if (edge === "middle" && !backward)
        await page.screenshot({ path: `/tmp/selection-speech-compact-${width}.png` });
      console.log(
        `PASS ${width}px ${theme}: ${edge} ${backward ? "backward" : "forward"}, width=${box.width}, side=${side}`,
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
