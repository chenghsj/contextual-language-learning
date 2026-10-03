import { useEffect, useRef, useState } from "react";
import { readDraft, writeDraft } from "../lib/draft-db";
import { parseCreateDraft, type CreateDraft } from "../lib/create-draft";
export function useCreateDraft(
  snapshot: CreateDraft,
  enabled: boolean,
  onRestore: (saved: CreateDraft | undefined) => void,
  onError: (message: string) => void,
) {
  const [loadedKey, setLoadedKey] = useState(""),
    [hasSaved, setHasSaved] = useState(false);
  const latest = useRef(snapshot),
    restore = useRef(onRestore),
    report = useRef(onError);
  latest.current = snapshot;
  restore.current = onRestore;
  report.current = onError;
  const key = snapshot.sourceKey;
  const committed = useRef<{ key: string; snapshot: CreateDraft } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    setLoadedKey("");
    void readDraft<unknown>("create:" + key)
      .then(raw => {
        if (!live) return;
        const saved = parseCreateDraft(raw, key);
        restore.current(saved);
        setHasSaved(!!saved);
        setLoadedKey(key);
      })
      .catch(error => {
        if (live) {
          report.current(String(error));
          setLoadedKey(key);
        }
      });
    return () => {
      live = false;
    };
  }, [enabled, key]);
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    if (!enabled || loadedKey !== key) return;
    const value = structuredClone(snapshot);
    committed.current = { key, snapshot: value };
    const timer = setTimeout(() => {
      void writeDraft("create:" + key, value).catch(error => report.current(String(error)));
    }, 250);
    return () => clearTimeout(timer);
  }, [enabled, key, loadedKey, serialized]);
  useEffect(() => {
    const flush = () => {
      const value = committed.current;
      if (value) void writeDraft("create:" + value.key, value.snapshot).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  return { ready: enabled && loadedKey === key, hasSaved };
}
