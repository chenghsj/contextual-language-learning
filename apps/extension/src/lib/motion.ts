export type MotionPreference = "reduced" | "full";
export type MotionMode = MotionPreference;
export const MOTION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

/** One mode for CSS (including portals) and interruptible content animations. */
export class MotionController {
  private mode: MotionMode = "full";
  private listeners = new Set<() => void>();
  private animations = new Set<Animation>();
  constructor(private root: HTMLElement) {
    root.dataset.motion = this.mode;
  }
  getSnapshot = (): MotionMode => this.mode;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setPreference(preference: MotionPreference) {
    const mode = preference;
    this.root.dataset.motion = mode;
    if (mode === this.mode) return;
    this.mode = mode;
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    for (const listener of this.listeners) listener();
  }
  track(animation: Animation) {
    this.animations.add(animation);
    const remove = () => {
      this.animations.delete(animation);
    };
    void animation.finished.then(remove, remove);
    return () => {
      remove();
      animation.cancel();
    };
  }
  dispose() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.listeners.clear();
  }
}

const controllers = new WeakMap<Document, MotionController>();
export function motionController(): MotionController | undefined {
  if (typeof window === "undefined") return;
  let controller = controllers.get(window.document);
  if (!controller) {
    controller = new MotionController(window.document.documentElement);
    controllers.set(window.document, controller);
  }
  return controller;
}

export function animateContent(
  element: HTMLElement,
  controller: MotionController | undefined,
  offset: number,
  duration: number,
): (() => void) | undefined {
  if (controller?.getSnapshot() !== "full" || !element.animate) return;
  const animation = element.animate(
    [
      { opacity: 0.8, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: "translateX(0px)" },
    ],
    { duration, easing: MOTION_EASING, fill: "none" },
  );
  return controller.track(animation);
}
