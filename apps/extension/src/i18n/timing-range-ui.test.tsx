import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("timing adjustments keep the ruler and grab position stable", async t => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "https://extension.test",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = { IS_REACT_ACT_ENVIRONMENT: true };
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "MutationObserver",
  ])
    globals[key] = dom.window[key as keyof typeof dom.window];
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { TimingRangeTimeline } = await import("../components/timing-range-controls");
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    async function fixture() {
      if (root) await React.act(async () => root!.unmount());
      dom.window.document.body.replaceChildren();
      const container = dom.window.document.createElement("div");
      dom.window.document.body.append(container);
      const seeks: number[] = [];
      let update!: React.Dispatch<React.SetStateAction<{ start: number; end: number }>>;
      function Harness() {
        const [range, setRange] = React.useState({ start: 55_000, end: 59_600 });
        update = setRange;
        return (
          <TimingRangeTimeline
            locale="zh-TW"
            startMs={range.start}
            endMs={range.end}
            currentMs={56_000}
            disabled={false}
            onChange={(boundary, value) => setRange(current => ({ ...current, [boundary]: value }))}
            onSeek={value => seeks.push(value)}
          />
        );
      }
      root = createRoot(container);
      await React.act(async () => root!.render(<Harness />));
      const start = container.querySelector<HTMLButtonElement>('[role="slider"]')!;
      const end = container.querySelectorAll<HTMLButtonElement>('[role="slider"]')[1];
      const track = start.parentElement!;
      track.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: 400,
        height: 48,
        right: 400,
        bottom: 48,
        toJSON: () => ({}),
      });
      const ruler = () => [...track.nextElementSibling!.children].map(el => el.textContent);
      async function pointer(type: string, clientX: number) {
        await React.act(async () => {
          const event = new dom.window.MouseEvent(type, { clientX, bubbles: true });
          Object.defineProperty(event, "pointerId", { value: 1 });
          start.dispatchEvent(event);
        });
      }
      return { start, end, track, ruler, seeks, pointer, update, container };
    }

    await t.test(
      "releasing a handle leaves the time scale and untouched boundary in place",
      async () => {
        const ui = await fixture();
        const ruler = ui.ruler();
        const untouchedPosition = ui.end.style.left;
        await ui.pointer("pointerdown", 93);
        await ui.pointer("pointermove", 133);
        const releasedPosition = ui.start.style.left;
        await ui.pointer("pointerup", 133);
        assert.deepEqual(ui.ruler(), ruler, "releasing must not recenter the ruler");
        assert.equal(
          ui.start.style.left,
          releasedPosition,
          "released handle stays under the pointer",
        );
        assert.equal(ui.end.style.left, untouchedPosition, "the other handle does not jump");
      },
    );

    await t.test("grabbing the edge of a handle does not move its value", async () => {
      const ui = await fixture();
      const original = ui.start.getAttribute("aria-valuenow");
      await ui.pointer("pointerdown", 105);
      await ui.pointer("pointermove", 105);
      await ui.pointer("pointerup", 105);
      assert.equal(
        ui.start.getAttribute("aria-valuenow"),
        original,
        "zero pointer movement means zero timing change",
      );
    });

    await t.test(
      "adjusting a boundary does not seek the video; clicking the ruler does",
      async () => {
        const ui = await fixture();
        await ui.pointer("pointerdown", 93);
        await ui.pointer("pointermove", 133);
        await ui.pointer("pointerup", 133);
        assert.deepEqual(ui.seeks, [], "editing a range must not jump playback");
        await React.act(async () =>
          ui.track.dispatchEvent(
            new dom.window.MouseEvent("click", { clientX: 200, bubbles: true }),
          ),
        );
        assert.equal(ui.seeks.length, 1, "explicit ruler click still seeks");
      },
    );

    await t.test(
      "out-of-view field edits are reframed only by the explicit fit action",
      async () => {
        const ui = await fixture();
        const ruler = ui.ruler();
        await React.act(async () => ui.update({ start: 75_000, end: 79_600 }));
        assert.deepEqual(ui.ruler(), ruler, "field and nudge edits must not change the time scale");
        const fit = ui.container.querySelector<HTMLButtonElement>('[data-ui="timing-fit-range"]');
        assert.ok(fit, "there is an explicit way to show the edited range");
        await React.act(async () => fit.click());
        assert.notDeepEqual(ui.ruler(), ruler);
        assert.deepEqual(ui.seeks, [], "fitting the ruler does not jump playback");
      },
    );
  } finally {
    if (root) await React.act(async () => root!.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
