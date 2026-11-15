import React, { useEffect, useMemo, useRef, useState } from "react";
import { captureFavorite, captureCustomFavorite } from "@contextual/core";
import { SafeMarkdown } from "@contextual/reader-ui";
import { ArrowLeft, BookOpen, FileText, RefreshCw, Search } from "lucide-react";
import { DriveAccessError } from "./drive";
import {
  DriveLibraryRepository,
  MaterialConnectionError,
  libraryContentKey,
  legacyLibraryContentKey,
  type LibraryCache,
  type LibraryReadPort,
  type LibraryDocument,
  type LibraryItem,
} from "./library";
import { SharedReader } from "./shared-reader";
import { WebFavoriteButton } from "./web-favorite-button";
import type { BrowserFavorites } from "./favorite-writer";
import type { Layout } from "./appearance";
import { languageNames } from "./ui-labels";
import { Button } from "./components/ui/button";
import { VideoReadingLayout } from "./video-reading-layout";
import { LanguageFilter } from "./language-filter";
import { MaterialCard } from "./material-card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Alert, AlertDescription } from "./components/ui/alert";

export type OpenMaterial = { item: LibraryItem; content: LibraryDocument };
export function LibraryBrowser({
  accountId,
  layout,
  drive,
  cache,
  onOpen,
  onExpired,
  onReconnect,
  canConnect,
}: {
  accountId: string;
  layout: Layout;
  drive: LibraryReadPort | null;
  cache: LibraryCache;
  onOpen(value: OpenMaterial): void;
  onExpired(): void;
  onReconnect(item: LibraryItem): Promise<string | undefined>;
  canConnect: boolean;
}) {
  const repo = useMemo(
    () => new DriveLibraryRepository(accountId, drive, cache),
    [accountId, drive, cache],
  );
  const [items, setItems] = useState<LibraryItem[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [language, setLanguage] = useState("all"),
    [limit, setLimit] = useState(40),
    [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<{
    key: string;
    message: string;
    connect: boolean;
  } | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openError) feedback.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [openError]);
  const [cacheIssue, setCacheIssue] = useState("");
  const [cachedItems, setCachedItems] = useState<ReadonlySet<string>>(new Set());
  async function readCachedItems(values: LibraryItem[]) {
    const keys = new Set(await cache.libraryDocumentKeys(accountId).catch(() => []));
    const entries = await Promise.all(
      values.map(async item => {
        const [current, legacy] = await Promise.all([
          libraryContentKey(item),
          legacyLibraryContentKey(item),
        ]);
        return keys.has(current) || keys.has(legacy) ? item.key : null;
      }),
    );
    return new Set(entries.filter((key): key is string => key !== null));
  }
  const [hydrated, setHydrated] = useState(false);
  const live = useRef(false),
    refreshing = useRef(false);
  const epoch = useRef(0);
  async function refresh() {
    if (refreshing.current || !drive) return;
    refreshing.current = true;
    const requestEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      await repo.refresh();
      const cached = await readCachedItems(repo.list());
      if (!live.current || requestEpoch !== epoch.current) return;
      setItems(repo.list());
      setCachedItems(cached);
      setCacheIssue(repo.cacheIssue);
    } catch (cause) {
      if (!live.current || requestEpoch !== epoch.current) return;
      setError(cause instanceof Error ? cause.message : "無法讀取教材清單。");
      if (cause instanceof DriveAccessError && cause.status === 401) onExpired();
    } finally {
      if (requestEpoch === epoch.current) {
        refreshing.current = false;
        if (live.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    live.current = true;
    const currentEpoch = ++epoch.current;
    refreshing.current = false;
    setItems([]);
    setError("");
    setBusy(false);
    setOpening(null);
    setOpenError(null);
    setReconnecting(false);
    setCachedItems(new Set());
    setHydrated(false);
    void repo
      .hydrate()
      .then(async () => {
        const cached = await readCachedItems(repo.list());
        if (!live.current || currentEpoch !== epoch.current) return;
        setItems(repo.list());
        setCachedItems(cached);
        setCacheIssue(repo.cacheIssue);
        setHydrated(true);
        if (drive) void refresh();
      })
      .catch(() => {
        if (live.current && currentEpoch === epoch.current)
          setError("無法開啟本機教材，請重新連結 Google Drive。");
      });
    const visible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      live.current = false;
      epoch.current++;
      repo.dispose();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [repo]);
  const shown = items.filter(
    item =>
      (language === "all" || item.language === language) &&
      [item.title, item.sourceTitle]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  function needsConnection(item: LibraryItem) {
    return !drive && navigator.onLine && !cachedItems.has(item.key) && !item.conflict;
  }
  async function reconnect(item: LibraryItem) {
    if (reconnecting || !canConnect) return;
    const requestEpoch = epoch.current;
    setOpenError(null);
    setReconnecting(true);
    setOpening(item.key);
    try {
      const message = await onReconnect(item);
      if (live.current && requestEpoch === epoch.current && message)
        setOpenError({ key: item.key, message, connect: true });
    } finally {
      if (live.current && requestEpoch === epoch.current) {
        setReconnecting(false);
        setOpening(null);
      }
    }
  }
  async function open(item: LibraryItem) {
    if (opening || reconnecting) return;
    if (needsConnection(item)) {
      await reconnect(item);
      return;
    }
    setOpening(item.key);
    const requestEpoch = epoch.current;
    setOpenError(null);
    try {
      const content = await repo.get(item);
      if (!live.current || requestEpoch !== epoch.current) return;
      setCacheIssue(repo.cacheIssue);
      onOpen({ item, content });
    } catch (cause) {
      if (!live.current || requestEpoch !== epoch.current) return;
      setOpenError({
        key: item.key,
        message: cause instanceof Error ? cause.message : "無法開啟教材。",
        connect:
          cause instanceof MaterialConnectionError ||
          (cause instanceof DriveAccessError && cause.status === 401),
      });
      if (cause instanceof DriveAccessError && cause.status === 401) onExpired();
    } finally {
      if (live.current && requestEpoch === epoch.current) setOpening(null);
    }
  }
  return (
    <section className="collection" aria-label="Google Drive 教材清單">
      <div className="collection-heading">
        <h2>
          所有教材 <span>{items.length}</span>
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="重新整理教材"
          title="重新整理教材"
          disabled={busy || !drive || !navigator.onLine}
          onClick={() => void refresh()}
        >
          <RefreshCw className={busy ? "spinning" : ""} />
        </Button>
      </div>
      <div className="filters">
        <label className="search-field">
          <Search size={16} />
          <Input
            type="search"
            aria-label="搜尋教材"
            placeholder="搜尋教材標題或來源"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setLimit(40);
            }}
          />
        </label>
        <LanguageFilter
          value={language}
          onChange={value => {
            setLanguage(value);
            setLimit(40);
          }}
        />
      </div>
      {(!hydrated || busy) && !items.length && (
        <p role="status" className="loading">
          正在讀取 Google Drive 教材…
        </p>
      )}
      {hydrated && !busy && !shown.length && (
        <div className="empty">
          <BookOpen />
          <h3>{items.length ? "沒有符合條件的教材" : "這裡會顯示你的雲端教材"}</h3>
          <p>
            {items.length
              ? "試試其他關鍵字或語言。"
              : drive
                ? "在桌面備份標準教材或自訂內容後，重新整理即可讀取。"
                : "連結 Google Drive 以讀取已備份的教材。"}
          </p>
        </div>
      )}
      <ul className={`cards${layout === "list" ? " list-view" : ""}`}>
        {shown.slice(0, limit).map(item => (
          <li key={item.key}>
            <MaterialCard
              title={item.title}
              sourceTitle={item.sourceTitle}
              description={item.kind === "custom" ? "完整自訂內容" : "完整情境、翻譯與重點解析"}
              kindLabel={item.kind === "custom" ? "自訂教材" : "標準教材"}
              language={languageNames[item.language] ?? item.language}
              date={item.createdAt}
              Icon={item.kind === "custom" ? FileText : BookOpen}
              action={needsConnection(item) ? "連結並開啟" : "開啟教材"}
              busy={opening === item.key}
              disabled={!!opening || reconnecting || (needsConnection(item) && !canConnect)}
              conflict={item.conflict}
              onOpen={() => void open(item)}
            >
              {openError?.key === item.key && (
                <div ref={feedback} className="entry-feedback">
                  <Alert variant="destructive">
                    <AlertDescription>{openError.message}</AlertDescription>
                    {openError.connect && (canConnect || reconnecting) && navigator.onLine && (
                      <Button
                        size="sm"
                        disabled={reconnecting}
                        onClick={() => void reconnect(item)}
                      >
                        {reconnecting ? "正在連結並開啟…" : "連結並開啟"}
                      </Button>
                    )}
                  </Alert>
                </div>
              )}
            </MaterialCard>
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <Button variant="outline" className="more" onClick={() => setLimit(limit + 40)}>
          載入更多
        </Button>
      )}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {cacheIssue && (
        <Alert role="status" className="mt-4">
          <AlertDescription>{cacheIssue}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export function LibraryReader({
  value,
  onBack,
  accountId,
  favorites,
  onFavoriteChanged,
  toolbarActions,
}: {
  value: OpenMaterial;
  onBack(): void;
  accountId: string;
  favorites: BrowserFavorites;
  onFavoriteChanged(): void;
  toolbarActions?: React.ReactNode;
}) {
  const { item, content } = value;
  return (
    <>
      <div className="reader-top video-reading-header reading-toolbar">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          返回內容庫
        </Button>
        <h1 className="reader-context-title" title={item.title}>
          {item.title}
        </h1>
        <div className="reader-top-actions">
          <Badge>{item.kind === "custom" ? "自訂教材" : "標準教材"}</Badge>
          {content.kind === "markdown" && (
            <WebFavoriteButton
              store={favorites}
              origin={{ documentId: item.documentId, sceneId: item.documentId }}
              title={item.title}
              snapshot={
                content.document
                  ? at => captureCustomFavorite(content.document!, at, item.key)
                  : undefined
              }
              onChanged={onFavoriteChanged}
            />
          )}
          {toolbarActions}
        </div>
      </div>
      {content.kind === "standard" ? (
        <SharedReader
          accountId={accountId}
          document={content.document}
          favoriteControl={scene => (
            <WebFavoriteButton
              store={favorites}
              origin={{ documentId: content.document.id, sceneId: scene.id }}
              title={scene.title}
              snapshot={at => captureFavorite(content.document, scene.id, at, content.revision)}
              onChanged={onFavoriteChanged}
            />
          )}
        />
      ) : (
        <>
          <VideoReadingLayout url={content.sourceUrl} title={item.title}>
            <article className="markdown reading" aria-label="教材內容">
              <SafeMarkdown markdown={content.markdown} imageBlocked="遠端圖片未載入" />
            </article>
          </VideoReadingLayout>
        </>
      )}
    </>
  );
}
