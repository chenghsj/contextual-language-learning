import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import {
  favoriteIdentityBytes,
  type FavoriteIdentity,
  type FavoriteSnapshot,
} from "@contextual/core";
import { RemoveFavoritePopover } from "../../extension/src/components/remove-favorite-popover";
import { Button } from "./components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@contextual/ui/popover";
import { BrowserFavorites } from "./favorite-writer";
import { sha256 } from "./drive";
export function WebFavoriteButton({
  store,
  origin,
  title,
  snapshot,
  onChanged,
}: {
  store: BrowserFavorites;
  origin: FavoriteIdentity;
  title: string;
  snapshot?: (at: string) => FavoriteSnapshot;
  onChanged(): void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let live = true;
    setKey("");
    void sha256(favoriteIdentityBytes(origin)).then(key => {
      if (live) setKey(key);
    });
    void store.refresh().catch(error => {
      if (live) setError(error.message);
    });
    return () => {
      live = false;
    };
  }, [store, origin.documentId, origin.sceneId]);
  const saved = state.items.some(item => item.key === key);
  const pending = state.pending.has(key);
  async function set(desired: boolean) {
    setBusy(true);
    setError("");
    try {
      await store.set(origin, desired, snapshot);
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "收藏同步失敗，請重試。");
    } finally {
      setBusy(false);
    }
  }
  const label = saved ? "取消收藏此情境" : "收藏此情境";
  const button = (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 [&_svg]:size-3.5"
      aria-label={label}
      aria-pressed={saved}
      aria-busy={busy || pending}
      title={!store.writable ? "連線並連結 Google Drive 後可變更收藏" : label}
      disabled={!key || busy || !store.writable || (!saved && !snapshot)}
      onClick={!saved ? () => void set(true) : undefined}
    >
      {busy || pending ? (
        <Loader2 className="spinning" />
      ) : (
        <Bookmark fill={saved ? "currentColor" : "none"} />
      )}
    </Button>
  );
  const control = saved ? (
    <RemoveFavoritePopover
      locale="zh-TW"
      title={title}
      open={confirm}
      onOpenChange={setConfirm}
      onConfirm={() => void set(false)}
      triggerLabel={label}
    >
      {button}
    </RemoveFavoritePopover>
  ) : (
    button
  );
  return (
    <span className="inline-flex items-center gap-1">
      {control}
      {(error || state.error) && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="收藏同步失敗">
              重試同步
            </Button>
          </PopoverTrigger>
          <PopoverContent className="space-y-3 text-sm">
            <p>{error || state.error}</p>
            <Button
              size="sm"
              disabled={busy || !store.writable}
              onClick={async () => {
                setBusy(true);
                try {
                  await store.refresh();
                  setError("");
                  onChanged();
                } catch (error) {
                  setError(error instanceof Error ? error.message : "收藏同步失敗");
                } finally {
                  setBusy(false);
                }
              }}
            >
              重試同步
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
