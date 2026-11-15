import React, { useMemo, useState } from "react";
import type { LearningDocument, FavoriteReaderDocument, FavoriteIdentity } from "@contextual/core";
import { ContextualSceneReader } from "../../extension/src/components/contextual-scene-reader";
import type { PreferencesStorage } from "../../extension/src/lib/preferences-store";
import { VideoReadingLayout } from "./video-reading-layout";
import { YouTubeController } from "./youtube-controller";
import { Alert, AlertDescription } from "./components/ui/alert";

type ReaderInput = {
  accountId: string;
  favoriteControl: (scene: LearningDocument["sections"][number]) => React.ReactNode;
} & (
  | { document: LearningDocument; origin?: never }
  | { document: FavoriteReaderDocument; origin: FavoriteIdentity }
);

export function SharedReader({ document, accountId, origin, favoriteControl }: ReaderInput) {
  const [error, setError] = useState("");
  const [rate, setRate] = useState(1);
  const controller = useMemo(
    () => new YouTubeController(document.source.url, setError),
    [document.id, document.source.url],
  );
  const storage = useMemo<PreferencesStorage>(
    () => ({
      async get(keys) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          try {
            result[key] = JSON.parse(
              localStorage.getItem(`cll-reader:${accountId}:${key}`) ?? "null",
            );
          } catch {}
        }
        return result;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values))
          localStorage.setItem(`cll-reader:${accountId}:${key}`, JSON.stringify(value));
      },
    }),
    [accountId],
  );
  const shared = {
    adapter: controller.adapter,
    readerStorage: storage,
    favoriteControl,
    canEditTiming: false,
    locale: "zh-TW" as const,
    repeat: "3" as const,
    setRepeat: () => {},
    delay: 1,
    setDelay: () => {},
    sceneRepeat: "3" as const,
    setSceneRepeat: () => {},
    sceneDelay: 1,
    setSceneDelay: () => {},
    playbackRate: rate,
    setPlaybackRate: setRate,
    onError: setError,
    onNotice: setError,
    onOpenVideo: async () => {
      window.open(document.source.url, "_blank", "noopener,noreferrer");
    },
  };
  return (
    <>
      {error && (
        <Alert role="status" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <VideoReadingLayout
        url={document.source.url}
        title={document.source.title}
        controller={controller}
      >
        <div className="web-shared-reader">
          {origin ? (
            <ContextualSceneReader
              {...shared}
              mode="favorite"
              document={document as FavoriteReaderDocument}
              favoriteOrigin={origin}
            />
          ) : (
            <ContextualSceneReader {...shared} document={document as LearningDocument} />
          )}
        </div>
      </VideoReadingLayout>
    </>
  );
}
