import "./url-runtime.js";
import { readLearningDocument } from "../../../packages/core/src/jobs";
import { readerPresentation } from "../../../packages/core/src/reader-model";
import type { ReaderDocument } from "../../../packages/core/src/reader-model";
import { CustomDocumentSchema } from "../../../packages/core/src/custom";
import type { LearningSceneV7, LearningDocument } from "../../../packages/core/src/schema";
import {
  playbackCueMap,
  effectiveCueWindow,
  cuePlaybackWindow,
  scenePlaybackWindow,
} from "../../extension/src/video/reader-playback";
import type { SourceSpan } from "../../../packages/core/src/explanations";
import {
  FavoriteRecordSchema,
  parseFavoriteSnapshot,
  favoriteReaderDocument,
} from "../../../packages/core/src/favorites";
import {
  FavoriteCatalogOperationSchema,
  catalogWinners,
  verifyFavoriteCatalogCoverage,
  favoriteIdentityBytes,
  captureFavoriteCatalog,
} from "../../../packages/core/src/favorite-catalog";
import type { FavoriteFileReference } from "../../../packages/core/src/favorite-catalog";

declare const CLLNativeSHA256: (text: string) => string;

type ExternalPlaybackLink = { startMs: number; endMs: number; webURL: string };
type PlaybackDocument = ReaderDocument &
  Pick<LearningDocument, "source" | "playbackOverrides" | "scenePlaybackOverrides">;

function youtubeVideoID(sourceURL: string | undefined): string | null {
  if (!sourceURL) return null;
  try {
    const url = new URL(sourceURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port)
      return null;
    const hosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"];
    let id: string | null = null;
    if (url.hostname === "youtu.be") id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    else if (hosts.includes(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else id = /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function netflixVideoID(sourceURL: string | undefined): string | null {
  if (!sourceURL) return null;
  try {
    const url = new URL(sourceURL);
    if (
      url.protocol !== "https:" ||
      !["netflix.com", "www.netflix.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    // A series title ID need not identify the episode in this lesson.
    return /^\/watch\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function playbackProjection(document: PlaybackDocument) {
  const videoID = youtubeVideoID(document.source.url);
  const netflixID = netflixVideoID(document.source.url);
  const cues = playbackCueMap(
    document.cues,
    document.source.platform,
    document.playbackOverrides ?? {},
  );
  const link = (window: { startMs: number; endMs: number } | null): ExternalPlaybackLink | null => {
    if (
      (!videoID && !netflixID) ||
      !window ||
      !Number.isFinite(window.startMs) ||
      !Number.isFinite(window.endMs) ||
      window.startMs < 0 ||
      window.endMs <= window.startMs ||
      window.endMs > 43_200_000
    )
      return null;
    return {
      startMs: window.startMs,
      endMs: window.endMs,
      // Netflix times are reading references, not native seek requests.
      webURL: videoID
        ? `https://www.youtube.com/watch?v=${videoID}&t=${Math.floor(window.startMs / 1000)}s`
        : `https://www.netflix.com/watch/${netflixID}`,
    };
  };
  return {
    row: (cueID: string) => link(effectiveCueWindow(cues.get(cueID), {})),
    scene: (scene: LearningSceneV7) =>
      link(
        document.scenePlaybackOverrides?.[scene.id] ??
          (document.source.platform === "youtube" ? cuePlaybackWindow(scene.cueIds, cues) : null) ??
          scenePlaybackWindow(scene.startMs, scene.endMs),
      ),
  };
}

function sourceText(document: ReaderDocument, spans: SourceSpan[]) {
  return spans
    .map((span, index) => {
      const previous = spans[index - 1];
      const separator =
        !previous || (previous.cueId === span.cueId && previous.end === span.start) ? "" : " ";
      const cue = document.cues.find(value => value.id === span.cueId);
      if (!cue) throw new Error("教材引用的原文不存在。");
      return separator + cue.originalText.slice(span.start, span.end);
    })
    .join("");
}

function groups(
  document: PlaybackDocument,
  scene: LearningSceneV7,
  translationVisible: boolean,
  playback: ReturnType<typeof playbackProjection>,
) {
  const presentation = readerPresentation(document, scene, translationVisible);
  return presentation.groups.map(group => ({
    id: group.id,
    rows: group.sourceCueIds.map(cueId => ({
      id: cueId,
      text: document.cues.find(cue => cue.id === cueId)!.originalText,
      translation: scene.translations.find(value => value.cueId === cueId)?.text ?? "",
      pronunciation: scene.pronunciations?.find(value => value.cueId === cueId)?.segments ?? [],
      playbackLink: playback.row(cueId),
    })),
    analyses: group.analyses.map(analysis => ({
      id: analysis.id,
      title: analysis.title ?? "",
      basics: (analysis.basics ?? []).map((basic, index) => ({
        id: analysis.id + ":basic:" + index,
        ...basic,
      })),
      chunks: (analysis.chunks ?? []).map(chunk => ({
        id: chunk.id,
        text: sourceText(document, chunk.spans),
        meaning: chunk.meaning,
        role: chunk.role ?? "",
      })),
      notes: analysis.notes,
      items: analysis.focusIndexes.map(index => {
        const item = presentation.focusItems[index];
        const itemId = item.id ?? analysis.id + ":item:" + index;
        return {
          id: itemId,
          expression: item.expression,
          examples: item.examples.map((example, exampleIndex) => ({
            id: itemId + ":example:" + exampleIndex,
            situation: example.situation,
            dialogue: example.dialogue.map((line, lineIndex) => ({
              id: itemId + ":example:" + exampleIndex + ":line:" + lineIndex,
              ...line,
            })),
          })),
        };
      }),
    })),
  }));
}

export function importJSON(
  text: string,
  pairedMarkdown: string | null,
  markdownHash: string | null,
) {
  const value = JSON.parse(text);
  if (value.schemaVersion === "custom-v1") {
    if (pairedMarkdown !== null) {
      if (typeof value.markdownHash !== "string" || value.markdownHash !== markdownHash)
        throw new Error("自訂教材內容與備份資訊不一致。");
      if (value.markdown !== undefined && value.markdown !== pairedMarkdown)
        throw new Error("自訂教材的兩份 Markdown 不一致。");
      value.markdown = pairedMarkdown;
    }
    const document = CustomDocumentSchema.parse(value);
    return JSON.stringify({
      contractVersion: 1,
      kind: "custom",
      documentID: document.id,
      title: document.title,
      language: "unspecified",
      createdAt: document.createdAt,
      sourceTitle: document.request.source.title,
      sourceURL: document.request.source.url ?? null,
      scenes: [],
      markdown: document.markdown,
    });
  }
  if (pairedMarkdown !== null) throw new Error("標準教材不需要配對 Markdown，請分別匯入。");
  const document = readLearningDocument(value);
  const playback = playbackProjection(document);
  return JSON.stringify({
    contractVersion: 1,
    kind: "standard",
    documentID: document.id,
    title: document.source.title,
    language: document.profile.targetLanguage,
    createdAt: document.createdAt,
    sourceTitle: document.source.title,
    sourceURL: document.source.url ?? null,
    scenes: document.sections.map(scene => ({
      id: scene.id,
      title: scene.title,
      context: scene.context.text,
      playbackLink: playback.scene(scene),
      groups: groups(document, scene, true, playback),
      untranslatedGroups: groups(document, scene, false, playback),
    })),
    markdown: null,
  });
}

export function graphemeBoundaries(text: string) {
  return JSON.stringify(
    Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      part => part.index,
    ),
  );
}

export function projectFavorites(collectionID: string, sourcesJSON: string, catalogsJSON: string) {
  const sources: FavoriteFileReference[] = JSON.parse(sourcesJSON);
  const catalogs: { file: FavoriteFileReference; text: string }[] = JSON.parse(catalogsJSON);
  const records = catalogs.map(({ file, text }) => {
    const record = FavoriteCatalogOperationSchema.parse(JSON.parse(text));
    if (
      file.schema !== "1" ||
      record.operationId !== file.operationId ||
      record.collectionId !== collectionID ||
      record.key !== CLLNativeSHA256(favoriteIdentityBytes(record.origin)) ||
      CLLNativeSHA256(JSON.stringify(record)) !== file.hash
    )
      throw new Error("收藏索引識別或校驗失敗，已保留上次有效清單。");
    return record;
  });
  return JSON.stringify(
    catalogWinners(verifyFavoriteCatalogCoverage(sources, records, collectionID)).map(record => ({
      key: record.key,
      title: record.summary.title,
      sourceTitle: record.summary.sourceTitle,
      language: record.summary.language,
      excerpt: record.summary.excerpt,
      catalog: JSON.stringify(record),
      source: {
        ...record.source,
        operationId: record.operationId,
        schema: "1",
      },
    })),
  );
}

export function importFavoriteJSON(text: string) {
  const envelope: {
    collectionID: string;
    key: string;
    catalog: string;
    operation: string;
  } = JSON.parse(text);
  const catalog = FavoriteCatalogOperationSchema.parse(JSON.parse(envelope.catalog));
  const record = FavoriteRecordSchema.parse(JSON.parse(envelope.operation));
  if (
    record.action !== "add" ||
    catalog.action !== "add" ||
    record.collectionId !== envelope.collectionID ||
    record.key !== envelope.key ||
    record.key !== CLLNativeSHA256(favoriteIdentityBytes(record.origin)) ||
    CLLNativeSHA256(JSON.stringify(record)) !== catalog.source.hash ||
    JSON.stringify(captureFavoriteCatalog(record, catalog.source)) !== JSON.stringify(catalog)
  )
    throw new Error("收藏內容與索引不一致，原資料已保留。");
  const snapshot = parseFavoriteSnapshot(record.snapshot);
  if (snapshot.snapshotVersion === 2) {
    return JSON.stringify({
      contractVersion: 1,
      kind: "custom",
      documentID: snapshot.origin.documentId,
      title: snapshot.document.title,
      language: "unspecified",
      createdAt: snapshot.document.createdAt,
      sourceTitle: snapshot.source.title,
      sourceURL: snapshot.source.url ?? null,
      scenes: [],
      markdown: snapshot.document.markdown,
    });
  }
  const document = favoriteReaderDocument(snapshot, snapshot.origin.documentId);
  const playback = playbackProjection(document);
  return JSON.stringify({
    contractVersion: 1,
    kind: "standard",
    documentID: snapshot.origin.documentId,
    title: snapshot.scene.title,
    language: document.profile.targetLanguage,
    createdAt: document.createdAt,
    sourceTitle: document.source.title,
    sourceURL: document.source.url ?? null,
    scenes: [
      {
        id: snapshot.scene.id,
        title: snapshot.scene.title,
        context: snapshot.scene.context.text,
        playbackLink: playback.scene(snapshot.scene),
        groups: groups(document, snapshot.scene, true, playback),
        untranslatedGroups: groups(document, snapshot.scene, false, playback),
      },
    ],
    markdown: null,
  });
}
