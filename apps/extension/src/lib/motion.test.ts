import assert from "node:assert/strict";
import test from "node:test";
import { MotionController, animateContent } from "./motion";

function fixture() {
  const root = { dataset: {} } as HTMLElement;
  const controller = new MotionController(root);
  return { root, controller };
}

test("switch updates the shared mode and only notifies on a real change", () => {
  const f = fixture();
  let updates = 0;
  const unsubscribe = f.controller.subscribe(() => updates++);
  assert.equal(f.root.dataset.motion, "full");
  f.controller.setPreference("reduced");
  assert.equal(f.root.dataset.motion, "reduced");
  assert.equal(updates, 1);
  f.controller.setPreference("reduced");
  assert.equal(updates, 1);
  f.controller.setPreference("full");
  assert.equal(f.root.dataset.motion, "full");
  assert.equal(updates, 2);
  unsubscribe();
  f.controller.dispose();
});

test("mode changes cancel active animation; reduced mode and unsupported browsers stay visible", async () => {
  const f = fixture();
  let cancels = 0,
    starts = 0;
  let finish!: () => void;
  const animation = {
    finished: new Promise<void>(resolve => {
      finish = resolve;
    }),
    cancel() {
      cancels++;
      finish();
    },
  };
  const element = {
    animate() {
      starts++;
      return animation;
    },
  } as unknown as HTMLElement;
  const stop = animateContent(element, f.controller, 12, 180);
  assert.equal(starts, 1);
  f.controller.setPreference("reduced");
  assert.equal(cancels, 1);
  assert.equal(animateContent(element, f.controller, 12, 180), undefined);
  f.controller.setPreference("full");
  assert.equal(animateContent({} as HTMLElement, f.controller, 0, 180), undefined);
  stop?.();
  f.controller.dispose();
});

test("finished animations are released and are not canceled by later preference changes", async () => {
  const f = fixture();
  let cancel = 0;
  const animation = {
    finished: Promise.resolve(),
    cancel() {
      cancel++;
    },
  } as unknown as Animation;
  f.controller.track(animation);
  await Promise.resolve();
  f.controller.setPreference("reduced");
  assert.equal(cancel, 0);
  f.controller.dispose();
});
