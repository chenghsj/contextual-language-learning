import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { animateContent, motionController, type MotionPreference } from "../lib/motion";

const noSubscribe = () => () => {};
const serverSnapshot = () => "full" as const;

export function useMotionPreference(preference: MotionPreference) {
  useLayoutEffect(() => {
    motionController()?.setPreference(preference);
  }, [preference]);
}

/** Animate the existing DOM only on navigation, never on data refresh or mode changes. */
export function useContentMotion(
  ref: RefObject<HTMLElement | null>,
  identity: string | number,
  {
    active = true,
    depth = 0,
    duration = 240,
    enter = false,
    activate = true,
    directional = false,
    entryOffset = 0,
    entryDuration = duration,
  }: {
    active?: boolean;
    depth?: number;
    duration?: number;
    enter?: boolean;
    activate?: boolean;
    directional?: boolean;
    entryOffset?: number;
    entryDuration?: number;
  } = {},
) {
  const controller = motionController();
  const mode = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  );
  const previous = useRef<{
    identity: string | number;
    active: boolean;
    depth: number;
    element: HTMLElement | null;
    mode: string;
  } | null>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    const last = previous.current;
    const changed =
      !last || last.identity !== identity || last.active !== active || last.element !== element;
    previous.current = { identity, active, depth, element, mode };
    if (last?.mode !== mode || changed) {
      stop.current?.();
      stop.current = undefined;
    }
    if (!changed || !active || !element || mode !== "full") return;
    if ((!last && !enter) || (last && (!last.active || last.element !== element) && !activate))
      return;
    const moved =
      directional && last && last.element === element && (last.active || last.depth !== depth);
    const back = moved && depth < last.depth;
    stop.current = animateContent(
      element,
      controller,
      moved ? (back ? -12 : 12) : entryOffset,
      back ? 240 : last?.active ? duration : entryDuration,
    );
  });
  useLayoutEffect(
    () => () => {
      stop.current?.();
    },
    [],
  );
}
