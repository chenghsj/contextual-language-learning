import test from "node:test";
import assert from "node:assert/strict";
import { YouTubeController } from "./youtube-controller";
test("stopping before YouTube readiness is safe and a remounted frame waits for its own player", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const ready: (() => void)[] = [];
  let pauses = 0,
    destroyed = 0;
  class Player {
    pauseVideo?: () => void;
    getCurrentTime?: () => number;
    getDuration?: () => number;
    getPlayerState?: () => number;
    constructor(_frame: unknown, options: { events: { onReady(): void } }) {
      ready.push(() => {
        this.pauseVideo = () => {
          pauses++;
        };
        this.getCurrentTime = () => 2;
        this.getDuration = () => 60;
        this.getPlayerState = () => 2;
        options.events.onReady();
      });
    }
    destroy() {
      destroyed++;
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { YT: { Player } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const errors: string[] = [];
  const controller = new YouTubeController("https://youtu.be/M7lc1UVf-VE", message =>
    errors.push(message),
  );
  const adapter = controller.adapter;
  const detach = controller.attach({} as HTMLIFrameElement);
  await Promise.resolve();
  await adapter.stopLoop!("");
  assert.equal(pauses, 0, "YouTube constructor does not expose playback methods before ready");
  ready[0]();
  await adapter.stopLoop!("");
  assert.equal(pauses, 1);
  assert.equal((await adapter.status!("")).currentMs, 2000);
  detach();
  const detachNext = controller.attach({} as HTMLIFrameElement);
  await Promise.resolve();
  let settled = false;
  const status = adapter.status!("").then(value => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false, "remount cannot reuse the destroyed player");
  ready[1]();
  assert.equal((await status).currentMs, 2000);
  detachNext();
  assert.equal(destroyed, 2);
  assert.deepEqual(errors, []);
});
