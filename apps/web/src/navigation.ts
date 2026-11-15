import { useCallback, useEffect, useRef, useState } from "react";

export type ReaderRoute =
  { kind: "library" | "favorites" } | { kind: "material" | "favorite"; key: string };
export function routeHash(route: ReaderRoute): string {
  return "#/" + route.kind + ("key" in route ? "/" + encodeURIComponent(route.key) : "");
}
export function readRoute(hash: string): ReaderRoute {
  try {
    const [kind, encoded, extra] = hash.replace(/^#\/?/, "").split("/");
    if (kind === "favorites" && !encoded) return { kind: "favorites" };
    const key = decodeURIComponent(encoded ?? "");
    if (!extra && kind === "material" && /^(standard|custom):[a-f0-9-]{36}$/i.test(key))
      return { kind, key };
    if (!extra && kind === "favorite" && /^[a-f0-9]{64}$/i.test(key)) return { kind, key };
  } catch {
    /* Malformed links return to the library. */
  }
  return { kind: "library" };
}
function scrollPosition() {
  return {
    page: window.scrollY,
    material:
      document.querySelector<HTMLElement>('[data-reading-scroll="material"]')?.scrollTop ?? 0,
    scene: document.querySelector<HTMLElement>('[data-ui="lessonContent"]')?.scrollTop ?? 0,
  };
}
function position(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
export function useReaderNavigation(owner: string | null) {
  const [route, setRoute] = useState(() => readRoute(location.hash));
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const restoring = useRef(true),
    href = useRef(location.href),
    restoration = useRef(0);
  const save = useCallback(() => {
    if (restoring.current) return;
    history.replaceState(
      { ...history.state, cllOwner: ownerRef.current, cllPosition: scrollPosition() },
      "",
    );
  }, []);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    history.replaceState({ ...history.state, cllPage: true }, "");
    const changed = () => {
      if (href.current === location.href) return;
      href.current = location.href;
      restoring.current = true;
      restoration.current++;
      setRoute(readRoute(location.hash));
    };
    let frame = 0;
    const scrolled = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      cancelAnimationFrame(frame);
      history.scrollRestoration = previous;
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("pagehide", save);
    };
  }, [save]);
  const navigate = useCallback(
    (next: ReaderRoute, replace = false) => {
      const hash = routeHash(next);
      if (!replace && hash === location.hash) return;
      save();
      restoring.current = true;
      restoration.current++;
      const state = { cllPage: true, cllCanReturn: !replace, cllOwner: ownerRef.current };
      const url = new URL(location.href);
      url.hash = hash;
      if (replace) history.replaceState(state, "", url);
      else history.pushState(state, "", url);
      href.current = location.href;
      setRoute(next);
    },
    [save],
  );
  const back = useCallback(
    (fallback: ReaderRoute) => {
      save();
      if (history.state?.cllCanReturn) history.back();
      else navigate(fallback, true);
    },
    [navigate, save],
  );
  const restore = useCallback(() => {
    const id = ++restoration.current;
    const saved = history.state?.cllOwner === ownerRef.current ? history.state?.cllPosition : null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (id !== restoration.current) return;
        window.scrollTo(0, position(saved?.page));
        const material = document.querySelector<HTMLElement>('[data-reading-scroll="material"]');
        const scene = document.querySelector<HTMLElement>('[data-ui="lessonContent"]');
        if (material) material.scrollTop = position(saved?.material);
        if (scene) scene.scrollTop = position(saved?.scene);
        restoring.current = false;
      }),
    );
  }, []);
  return { route, navigate, back, restore };
}
