import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
const { act, useRef } = React;
const { createRoot } = await import("react-dom/client");
const { useContentMotion } = await import("../hooks/use-content-motion");
const { motionController } = await import("../lib/motion");
const { motionCopy } = await import("./motion");

test("navigation preserves DOM, ignores data refreshes, interrupts previous motion and cleans up on unmount", async () => {
  const animations: { frames: Keyframe[]; cancelled: boolean }[] = [];
  dom.window.HTMLElement.prototype.animate = function (frames) {
    const record = { frames: frames as Keyframe[], cancelled: false };
    animations.push(record);
    let finish!: () => void;
    return {
      finished: new Promise<void>(resolve => {
        finish = resolve;
      }),
      cancel() {
        record.cancelled = true;
        finish();
      },
    } as unknown as Animation;
  };
  function Page({
    step,
    status,
    active = true,
  }: {
    step: number;
    status: string;
    active?: boolean;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useContentMotion(ref, step, { depth: step, directional: true, active });
    return (
      <div ref={ref}>
        <input defaultValue="draft" />
        <span>{status}</span>
      </div>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (step: number, status = "ready", active = true) => {
    await act(async () => root.render(<Page step={step} status={status} active={active} />));
  };
  try {
    await render(0);
    const input = container.querySelector("input")!;
    input.value = "unsaved edit";
    assert.equal(animations.length, 0, "initial App render has no choreography");
    await render(1);
    assert.equal(animations.length, 1);
    assert.equal(animations[0].frames[0].transform, "translateX(12px)");
    await render(1, "loading changed");
    assert.equal(animations[0].cancelled, false);
    assert.equal(animations.length, 1, "polling never restarts a navigation transition");
    await render(0);
    assert.equal(animations[0].cancelled, true);
    assert.equal(animations[1].frames[0].transform, "translateX(-12px)");
    assert.equal(container.querySelector("input"), input);
    assert.equal(input.value, "unsaved edit");
    await act(async () => motionController()!.setPreference("reduced"));
    assert.equal(animations[1].cancelled, true);
    await render(1);
    assert.equal(animations.length, 2);
    await act(async () => motionController()!.setPreference("full"));
    assert.equal(animations.length, 2, "changing preference does not replay a page");
    await render(0);
    await render(0, "hidden", false);
    assert.equal(animations[2].cancelled, true);
    await render(1, "hidden", false);
    assert.equal(animations.length, 3, "inactive pages never animate");
    await render(1);
    assert.equal(animations.length, 4);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
  assert.equal(animations.at(-1)?.cancelled, true);
});

test("all five languages expose the same motion switch label and a helpful description", () => {
  for (const copy of Object.values(motionCopy)) {
    assert.deepEqual(Object.keys(copy).sort(), ["hint", "label"]);
    for (const text of Object.values(copy)) assert.ok(text.trim());
  }
});
