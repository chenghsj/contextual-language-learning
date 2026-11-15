import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Bookmark, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getFavoritesStore, favoriteStateKey } from "../lib/favorites-store";
import { favoritesCopy } from "../i18n/favorites";
import type { UiLocale } from "../i18n/messages";
import { IconTooltip } from "./icon-tooltip";
import { Button } from "./ui/button";
import { RemoveFavoritePopover } from "./remove-favorite-popover";

export function SceneFavoriteButton({
  documentId,
  sceneId,
  sceneTitle,
  sceneIds,
  locale,
  ready = true,
  kind = "scene",
}: {
  documentId: string;
  sceneId: string;
  sceneTitle: string;
  sceneIds: string[];
  locale: UiLocale;
  ready?: boolean;
  kind?: "scene" | "custom";
}) {
  const store = getFavoritesStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const ids = sceneIds.join(",");
  useEffect(() => {
    void store.track(documentId, ids.split(","));
    return () => store.untrack(documentId);
  }, [store, documentId, ids]);
  const key = favoriteStateKey(documentId, sceneId);
  const [confirming, setConfirming] = useState(false);
  const collectionKey = state.collection.kind === "local" ? "local" : state.collection.accountId;
  useEffect(() => setConfirming(false), [key, collectionKey]);
  const saved = state.states[key];
  const pending = state.pending.has(key);
  const copy = favoritesCopy(locale);
  const label =
    kind === "custom"
      ? saved
        ? copy.removeCustom
        : copy.saveCustom
      : saved
        ? copy.remove
        : copy.save;
  function updateFavorite(desired: boolean) {
    void store
      .set(documentId, sceneId, desired)
      .then(confirmed =>
        confirmed === undefined
          ? undefined
          : toast.success(
              kind === "custom"
                ? confirmed
                  ? copy.savedCustom
                  : copy.removedCustom
                : confirmed
                  ? copy.saved
                  : copy.removed,
              {
                id: "scene-favorite",
                position: "bottom-center",
                duration: 2500,
                closeButton: true,
              },
            ),
      )
      .catch(() =>
        toast.error(copy.error, {
          id: "scene-favorite",
          position: "bottom-center",
          duration: 2500,
          closeButton: true,
        }),
      );
  }
  if (saved === undefined && state.error)
    return (
      <IconTooltip label={copy.error + " " + copy.retry}>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 [&_svg]:size-3.5"
          aria-label={copy.retry}
          onClick={() => {
            void store.refreshStates();
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      </IconTooltip>
    );
  const button = (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 shrink-0 [&_svg]:size-3.5"
      aria-label={label}
      aria-pressed={saved === true}
      aria-busy={pending}
      disabled={!ready || saved === undefined || pending}
      onClick={() => {
        if (!saved) updateFavorite(true);
      }}
    >
      <Bookmark aria-hidden="true" fill={saved ? "currentColor" : "none"} />
    </Button>
  );
  return saved ? (
    <RemoveFavoritePopover
      locale={locale}
      title={sceneTitle}
      triggerLabel={label}
      open={confirming}
      onOpenChange={setConfirming}
      onConfirm={() => updateFavorite(false)}
    >
      {button}
    </RemoveFavoritePopover>
  ) : (
    <IconTooltip label={label}>{button}</IconTooltip>
  );
}
