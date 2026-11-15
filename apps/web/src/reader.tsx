import React from "react";
import { SafeMarkdown } from "@contextual/reader-ui";
import type { FavoriteSnapshot } from "@contextual/core";
export function CustomFavoriteReader({
  snapshot,
}: {
  snapshot: Extract<FavoriteSnapshot, { snapshotVersion: 2 }>;
}) {
  return (
    <article className="markdown reading" aria-label="自訂教材內容">
      <SafeMarkdown markdown={snapshot.document.markdown} imageBlocked="遠端圖片未載入" />
    </article>
  );
}
