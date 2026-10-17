import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { LearningDocumentV7 } from "@contextual/core";
import type { VideoAdapter } from "../video/types";

for (const playbackTarget of ["sentence", "scene", "youtube", "youtube-group", "youtube-scene"])
  test(`reader playback, highlight and calibration: ${playbackTarget}`, async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
      url: "https://extension.test",
    });
    const previous = new Map<string, PropertyDescriptor | undefined>();
    const globals: Record<string, unknown> = {};
    for (const key of [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "HTMLInputElement",
      "HTMLButtonElement",
      "HTMLFormElement",
      "Element",
      "Node",
      "NodeFilter",
      "DocumentFragment",
      "MutationObserver",
      "Event",
      "CustomEvent",
      "MouseEvent",
      "KeyboardEvent",
      "FocusEvent",
    ])
      globals[key] = dom.window[key as keyof typeof dom.window];
    Object.assign(globals, {
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
      cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, tabs: {} },
    });
    for (const [key, value] of Object.entries(globals)) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const polls = new Map<number, { callback: () => void; ms?: number }>();
    let timerId = 0;
    dom.window.setInterval = ((callback: () => void, ms?: number) => {
      polls.set(++timerId, { callback, ms });
      return timerId;
    }) as typeof dom.window.setInterval;
    dom.window.clearInterval = id => {
      if (id !== undefined) polls.delete(id);
    };
    let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
    const React = await import("react");
    try {
      const { createRoot } = await import("react-dom/client");
      const { ContextualSceneReader } = await import("../components/contextual-scene-reader");
      let state = { currentMs: 0, playing: false };
      let finishPause: (() => void) | undefined;
      let pauseCalls = 0;
      const pendingPause = new Promise<void>(resolve => {
        finishPause = resolve;
      });
      const requests: unknown[] = [];
      const adapter: VideoAdapter = {
        id: playbackTarget.startsWith("youtube") ? "youtube" : "netflix",
        label: "Netflix",
        getVideoId: () => "81234567",
        status: async () => ({ ...state }),
        stopLoop: async () => {},
        loop: async (_url, options) => {
          requests.push(options);
          state = { currentMs: options.startMs + 100, playing: true };
        },
        pause: async () => {
          pauseCalls++;
          await pendingPause;
          state.playing = false;
        },
      };
      let lesson: LearningDocumentV7 = {
        schemaVersion: 7,
        id: "00000000-0000-4000-8000-000000000001",
        createdAt: "2026-10-04T00:00:00Z",
        source: {
          platform: "netflix",
          title: "Playback test",
          url: "https://www.netflix.com/watch/81234567",
        },
        profile: {
          targetLanguage: "en",
          instructionLanguage: "zh-TW",
          level: "B1",
          sceneCount: 2,
          contextualExampleCount: 2,
        },
        generation: { provider: "anthropic", modelId: "" },
        cues: [
          { id: "a", startMs: 1000, endMs: 2000, originalText: "First sentence." },
          { id: "b", startMs: 3000, endMs: 4000, originalText: "Second sentence." },
        ],
        points: [],
        reusableItems: [],
        sections: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            title: "Scene",
            context: { text: "Dialogue", evidenceCueIds: ["a"] },
            contextCueIds: [],
            startMs: 1000,
            endMs: 4000,
            cueIds: ["a", "b"],
            translations: [],
            utterances: [
              {
                id: "u-a",
                cueIds: ["a"],
                sourceSpans: [{ cueId: "a", start: 0, end: 15 }],
                meaning: "First sentence",
                contextExplanation: "",
                contextCueIds: [],
                decision: "basic_only",
                pointIds: [],
              },
              {
                id: "u-b",
                cueIds: ["b"],
                sourceSpans: [{ cueId: "b", start: 0, end: 16 }],
                meaning: "Second sentence",
                contextExplanation: "",
                contextCueIds: [],
                decision: "basic_only",
                pointIds: [],
              },
            ],
          },
        ],
      };
      const youtube = playbackTarget.startsWith("youtube");
      if (youtube) {
        adapter.pause = async () => {
          state.playing = false;
        };
        lesson.source = {
          platform: "youtube",
          title: "Playback test",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        };
        lesson.cues.push({ id: "c", startMs: 8000, endMs: 9000, originalText: "Outside scene." });
        if (playbackTarget === "youtube-group")
          lesson.sections[0].utterances = [
            {
              id: "complete",
              cueIds: ["a", "b"],
              sourceSpans: [
                { cueId: "a", start: 0, end: 15 },
                { cueId: "b", start: 0, end: 16 },
              ],
              meaning: "Two cues, one utterance",
              contextExplanation: "",
              contextCueIds: [],
              decision: "basic_only",
              pointIds: [],
            },
          ];
      }
      const container = dom.window.document.createElement("div");
      dom.window.document.body.append(container);
      root = createRoot(container);
      const saved: unknown[] = [];
      function renderReader() {
        root!.render(
          React.createElement(ContextualSceneReader, {
            document: lesson,
            adapter,
            locale: "zh-TW",
            repeat: "2",
            setRepeat: () => {},
            delay: 0,
            setDelay: () => {},
            sceneRepeat: "2",
            setSceneRepeat: () => {},
            sceneDelay: 0,
            setSceneDelay: () => {},
            playbackRate: 1,
            setPlaybackRate: () => {},
            onError: message => {
              throw new Error(message);
            },
            onNotice: () => {},
            onSaveRange: async (id, range) => {
              saved.push({ id, range });
              const overrides = { ...lesson.playbackOverrides };
              if (range) overrides[id] = range;
              else delete overrides[id];
              lesson = { ...lesson, playbackOverrides: overrides };
              renderReader();
            },
            onSaveSceneRange: async () => {},
          }),
        );
      }
      await React.act(async () => {
        renderReader();
      });
      const lines = [...container.querySelectorAll<HTMLElement>('[data-ui="sourceSentence"]')];
      const playButtons = [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[data-ui="sentence-actions"] > button[aria-label]',
        ),
      ];
      assert.equal(lines.length, 2);
      assert.equal(container.querySelector('[aria-current="true"]'), null);
      async function poll() {
        await React.act(async () => {
          for (const item of [...polls.values()]) if (item.ms === 300) item.callback();
          await new Promise<void>(resolve => setImmediate(resolve));
        });
      }
      if (youtube) {
        async function clickButton(label: string) {
          const button = [
            ...dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
          ].find(item => item.getAttribute("aria-label") === label || item.textContent === label);
          assert.ok(button, label);
          await React.act(async () => {
            button.click();
          });
        }
        const endMs = playbackTarget === "youtube-group" ? 8000 : 3000;
        if (playbackTarget === "youtube-scene") {
          assert.equal(
            container.querySelector<HTMLInputElement>('input[type="range"]')!.max,
            "8000",
          );
          await clickButton("播放");
          assert.equal(
            (requests.at(-1) as { endMs: number }).endMs,
            8000,
            "scene extends to next source cue outside the section",
          );
          return;
        }
        await React.act(async () => {
          playButtons[0].click();
        });
        await poll();
        assert.equal((requests.at(-1) as { endMs: number }).endMs, endMs);
        assert.equal(
          container.querySelector<HTMLInputElement>('input[type="range"]')!.max,
          String(endMs),
        );
        state = { currentMs: playbackTarget === "youtube-group" ? 5000 : 2500, playing: true };
        await poll();
        assert.equal(
          lines[playbackTarget === "youtube-group" ? 1 : 0].getAttribute("aria-current"),
          "true",
        );
        await clickButton("播放選項");
        await clickButton("調整時間");
        const delta = playbackTarget === "youtube-group" ? -100 : 100;
        await clickButton(delta > 0 ? "結尾 +0.1s" : "結尾 -0.1s");
        await clickButton("完成");
        assert.deepEqual(saved.at(-1), { id: "a", range: { startMs: 1000, endMs: endMs + delta } });
        await React.act(async () => {
          container
            .querySelector<HTMLButtonElement>('[data-ui="sentence-actions"] > button[aria-label]')!
            .click();
        });
        assert.equal((requests.at(-1) as { endMs: number }).endMs, endMs + delta);
        await clickButton("播放選項");
        await clickButton("調整時間");
        await clickButton("重設時間");
        await clickButton("試聽整段");
        assert.equal(
          (requests.at(-1) as { endMs: number }).endMs,
          endMs,
          "reset preview uses inferred default",
        );
        await clickButton("完成");
        assert.deepEqual(saved.at(-1), { id: "a", range: null });
        assert.equal(
          container.querySelector<HTMLInputElement>('input[type="range"]')!.max,
          String(endMs),
        );
        assert.equal(lesson.cues[0].endMs, 2000, "source end remains intact");
        await React.act(async () => {
          container
            .querySelector<HTMLButtonElement>('[data-ui="sentence-actions"] > button[aria-label]')!
            .click();
        });
        assert.equal((requests.at(-1) as { endMs: number }).endMs, endMs);
        return;
      }
      await React.act(async () => {
        if (playbackTarget === "sentence") playButtons[0].click();
        else container.querySelector<HTMLButtonElement>('button[aria-label="播放"]')!.click();
      });
      await poll();
      assert.equal((requests[0] as { repeats: number }).repeats, 1);
      assert.equal(lines[0].getAttribute("aria-current"), "true");
      assert.ok(lines[0].classList.contains("bg-accent"));
      assert.ok(lines[0].classList.contains("text-accent-foreground"));
      assert.ok(lines[0].classList.contains("bg-accent"));
      assert.equal(lines[1].getAttribute("aria-current"), null);
      state = { currentMs: 1500, playing: true };
      await poll();
      await React.act(async () => {
        container.querySelector<HTMLButtonElement>('button[aria-label="暫停"]')!.click();
      });
      assert.equal(playButtons[0].disabled, false, "pending pause must not dim the dialogue");
      assert.equal(playButtons[1].disabled, false, "pending pause must not dim other sentences");
      const pauseButton = container.querySelector<HTMLButtonElement>('button[aria-label="暫停"]')!;
      assert.equal(
        pauseButton.disabled,
        false,
        "pending pause keeps the player's appearance stable",
      );
      await React.act(async () => {
        pauseButton.click();
      });
      assert.equal(pauseCalls, 1, "repeated clicks cannot overlap pending pause commands");
      await React.act(async () => {
        finishPause!();
      });
      assert.equal(
        lines[0].getAttribute("aria-current"),
        "true",
        "pause keeps the highlight immediately",
      );
      await poll();
      assert.equal(
        playButtons[0].getAttribute("aria-pressed"),
        String(playbackTarget === "sentence"),
      );
      assert.equal(lines[0].getAttribute("aria-current"), "true");
      assert.ok(lines[0].classList.contains("bg-accent"));
      assert.ok(lines[0].classList.contains("text-accent-foreground"));
      assert.ok(
        lines[0].classList.contains("grid"),
        "pausing retains the row layout without shifting the text",
      );
      state = { currentMs: 1900, playing: true };
      await poll();
      state = { currentMs: 2000, playing: false };
      await poll();
      await poll();
      assert.equal(
        lines[0].getAttribute("aria-current"),
        "true",
        "range completion keeps its last sentence",
      );
      state = { currentMs: 2400, playing: false };
      await poll();
      assert.equal(
        lines[0].getAttribute("aria-current"),
        null,
        "seeking into a gap clears the old sentence",
      );
      state = { currentMs: 3500, playing: false };
      await poll();
      assert.equal(lines[0].getAttribute("aria-current"), null);
      assert.equal(
        lines[1].getAttribute("aria-current"),
        "true",
        "paused seek follows the new sentence",
      );
      state = { currentMs: 2400, playing: true };
      await poll();
      assert.equal(
        container.querySelector('[aria-current="true"]'),
        null,
        "playing gaps have no active sentence",
      );
      await React.act(async () => {
        playButtons[1].click();
      });
      await poll();
      assert.equal(lines[0].getAttribute("aria-current"), null);
      assert.equal(lines[1].getAttribute("aria-current"), "true");
      assert.ok(lines[1].classList.contains("bg-accent"));
      assert.ok(lines[1].classList.contains("text-accent-foreground"));
      state = { currentMs: 3900, playing: true };
      await poll();
      state = { currentMs: 4000, playing: true };
      await poll();
      assert.equal(lines[1].getAttribute("aria-current"), null);
      state = { currentMs: 4100, playing: false };
      await poll();
      await poll();
      assert.equal(
        lines[1].getAttribute("aria-current"),
        "true",
        "pause in a gap keeps the most recent sentence",
      );
    } catch (error) {
      if (error instanceof AggregateError)
        throw new Error(error.errors.map(item => item.stack ?? String(item)).join("\n"));
      throw error;
    } finally {
      if (root) await React.act(async () => root!.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
