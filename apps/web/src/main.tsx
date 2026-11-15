import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  Cloud,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  favoriteReaderDocument,
  type FavoriteSnapshot,
  type FavoriteSummary,
} from "@contextual/core";
import {
  authorizeGoogle,
  loadGoogleIdentity,
  readGoogleSession,
  saveGoogleSession,
  clearGoogleSession,
  type GoogleAccount,
} from "./auth";
import { createBrowserDrive, DriveAccessError, type FavoriteReadPort } from "./drive";
import { createFavoriteCache } from "./cache";
import { FavoriteReadRepository } from "./repository";
import { SharedReader } from "./shared-reader";
import { WebFavoriteButton } from "./web-favorite-button";
import { BrowserFavorites, type FavoriteWritePort } from "./favorite-writer";
import { PwaInstall } from "./pwa-install";
import { youtubeVideo } from "./youtube";
import { VideoReadingLayout } from "./video-reading-layout";
import { CustomFavoriteReader } from "./reader";
import { useReaderNavigation } from "./navigation";
import { LibraryBrowser, LibraryReader, type OpenMaterial } from "./library-browser";
import { DriveLibraryRepository, type LibraryItem, type LibraryReadPort } from "./library";
import { LanguageFilter } from "./language-filter";
import { MaterialCard } from "./material-card";
import { languageNames } from "./ui-labels";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";

import { useAppearance, ThemeSwitch, LayoutSwitch } from "./appearance";
import "./styles.css";
export type DemoSession = {
  account: GoogleAccount;
  drive: FavoriteReadPort & Partial<LibraryReadPort & FavoriteWritePort>;
};
const ACCOUNT_KEY = "cll-favorite-account";
const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined;

function savedAccount(): GoogleAccount | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null");
    return typeof value?.id === "string" && typeof value.email === "string" ? value : null;
  } catch {
    return null;
  }
}
function App({ demo }: { demo?: DemoSession }) {
  const { theme, layout, changeTheme, changeLayout } = useAppearance();
  const cache = useMemo(createFavoriteCache, []);
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [favorites, setFavorites] = useState<BrowserFavorites | null>(null);
  const [repository, setRepository] = useState<FavoriteReadRepository | null>(null);
  const [libraryDrive, setLibraryDrive] = useState<LibraryReadPort | null>(null);
  const [loadedMaterial, setSelectedMaterial] = useState<OpenMaterial | null>(null);
  const { route, navigate, back, restore } = useReaderNavigation(account?.id ?? null);
  const view = route.kind === "favorites" || route.kind === "favorite" ? "favorites" : "library";
  const [routeError, setRouteError] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [items, setItems] = useState<FavoriteSummary[]>([]);
  const [loadedFavorite, setSelected] = useState<{
    summary: FavoriteSummary;
    snapshot: FavoriteSnapshot;
  } | null>(null);
  const [search, setSearch] = useState(""),
    [language, setLanguage] = useState(""),
    [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState(false),
    [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [cacheIssue, setCacheIssue] = useState("");
  const [connected, setConnected] = useState(false),
    [googleReady, setGoogleReady] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null),
    [hydrated, setHydrated] = useState(false);
  const session = useRef<{
    repo: FavoriteReadRepository;
    controller: AbortController;
    favorites: BrowserFavorites;
  } | null>(null);
  const sequence = useRef(0),
    refreshing = useRef(false);
  const authorizing = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  function stop() {
    sequence.current++;
    session.current?.favorites.dispose();
    session.current?.repo.dispose();
    session.current?.controller.abort();
    session.current = null;
    refreshing.current = false;
  }
  async function install(
    next: GoogleAccount,
    drive: (FavoriteReadPort & Partial<LibraryReadPort & FavoriteWritePort>) | null,
    controller = new AbortController(),
  ) {
    stop();
    const seq = sequence.current,
      repo = new FavoriteReadRepository(next.id, drive, cache);
    const favorites = new BrowserFavorites(
      next.id,
      repo,
      drive && typeof drive.writeFavorite === "function" && typeof drive.reserve === "function"
        ? (drive as FavoriteWritePort)
        : null,
      cache,
    );
    session.current = { repo, controller, favorites };
    setFavorites(favorites);
    setRepository(repo);
    setLibraryDrive(
      drive && typeof drive.listLibrary === "function" && typeof drive.readLibrary === "function"
        ? { listLibrary: drive.listLibrary.bind(drive), readLibrary: drive.readLibrary.bind(drive) }
        : null,
    );
    setSelectedMaterial(null);
    setAccount(next);
    setSelected(null);
    setItems([]);
    setError("");
    setSearch("");
    setLanguage("");
    setHydrated(false);
    setUpdatedAt(null);
    setCacheIssue("");
    setConnected(!!drive);
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
    } catch {
      /* Reading remains available without account persistence. */
    }
    try {
      await repo.hydrate();
    } catch (error) {
      if (seq !== sequence.current) return;
      throw error;
    }
    if (seq !== sequence.current) return;
    setItems(repo.list());
    setUpdatedAt(repo.updatedAt);
    setCacheIssue(repo.cacheIssue);
    setHydrated(true);
    return repo;
  }
  async function refresh(repo = session.current?.repo) {
    if (!repo || refreshing.current) return;
    refreshing.current = true;
    const seq = sequence.current;
    setBusy(true);
    setError("");
    try {
      const active = session.current;
      if (!active || active.repo !== repo) return;
      await active.favorites.refresh();
      if (seq !== sequence.current) return;
      setItems(repo.list());
      setUpdatedAt(repo.updatedAt);
      setCacheIssue(repo.cacheIssue);
    } catch (e) {
      if (seq !== sequence.current) return;
      setError(e instanceof Error ? e.message : "無法更新收藏。");
      if (e instanceof DriveAccessError && e.status === 401) expireGoogleSession();
    } finally {
      if (seq === sequence.current) {
        refreshing.current = false;
        setBusy(false);
      }
    }
  }
  function expireGoogleSession() {
    clearGoogleSession();
    setConnected(false);
    setLibraryDrive(null);
  }
  async function connect(material?: LibraryItem): Promise<string | undefined> {
    const startingHash = location.hash;
    if (busy) return;
    const attempt = ++authorizing.current;
    setBusy(true);
    setError("");
    let materialRepo: DriveLibraryRepository | undefined;
    let disconnect: (() => void) | undefined;
    try {
      const authorization =
        (account ? readGoogleSession(clientId!, account) : null) ??
        (await authorizeGoogle(clientId!, account));
      if (attempt !== authorizing.current) return;
      const current = account;
      stop();
      if (current && current.id !== authorization.account.id) {
        await cache.clear(current.id).catch(() => {});
        channel.current?.postMessage({ account: current.id });
      }
      if (attempt !== authorizing.current) return;
      const controller = new AbortController();
      saveGoogleSession(clientId!, authorization);
      const drive = createBrowserDrive(authorization.token, controller.signal, () => {
        if (session.current?.controller === controller) expireGoogleSession();
      });
      const repo = await install(authorization.account, drive, controller);
      if (material && current?.id === authorization.account.id && location.hash === startingHash) {
        materialRepo = new DriveLibraryRepository(authorization.account.id, drive, cache);
        const dispose = () => materialRepo?.dispose();
        controller.signal.addEventListener("abort", dispose, { once: true });
        disconnect = () => controller.signal.removeEventListener("abort", dispose);
        if (controller.signal.aborted) dispose();
        await materialRepo.refresh();
        const latest = materialRepo.list().find(item => item.key === material.key);
        if (!latest) throw new Error("此教材已不在雲端，請從更新後的清單重新選擇。");
        const content = await materialRepo.get(latest);
        if (attempt !== authorizing.current) return;
        setSelectedMaterial({ item: latest, content });
        navigate({ kind: "material", key: latest.key });
      }
      if (repo && view === "favorites") await refresh(repo);
    } catch (e) {
      if (attempt !== authorizing.current) return;
      const message = e instanceof Error ? e.message : "Google 連結未完成。";
      if (!material) setError(message);
      return message;
    } finally {
      materialRepo?.dispose();
      disconnect?.();
      if (attempt === authorizing.current) setBusy(false);
    }
  }
  async function logout(broadcast = true) {
    authorizing.current++;
    navigate({ kind: "library" }, true);
    clearGoogleSession();
    const owner = account?.id;
    stop();
    setRepository(null);
    setFavorites(null);
    setLibraryDrive(null);
    setSelectedMaterial(null);
    setAccount(null);
    setSelected(null);
    setItems([]);
    setConnected(false);
    setError("");
    setCacheIssue("");
    setBusy(false);
    setOpening(null);
    setUpdatedAt(null);
    setHydrated(false);
    try {
      localStorage.removeItem(ACCOUNT_KEY);
    } catch {}
    if (owner) {
      if (broadcast) channel.current?.postMessage({ account: owner });
      await cache
        .clear(owner)
        .catch(() => setError("無法清除本機副本，請使用瀏覽器清除網站資料。"));
    }
  }
  useEffect(() => {
    const saved = demo?.account ?? savedAccount();
    if (!saved) clearGoogleSession();
    const restored = saved && clientId && !demo ? readGoogleSession(clientId, saved) : null;
    const controller = new AbortController();
    const drive =
      demo?.drive ??
      (restored
        ? createBrowserDrive(restored.token, controller.signal, () => {
            if (session.current?.controller === controller) expireGoogleSession();
          })
        : null);
    if (saved)
      void install(saved, drive, controller)
        .then(repo => {
          if (repo && demo) void refresh(repo);
        })
        .catch(() => setError("無法開啟本機收藏，請重新連結 Google Drive。"));
    if (clientId)
      void loadGoogleIdentity()
        .then(() => setGoogleReady(true))
        .catch(e => setError(e.message));
    const onNetwork = () => setOnline(navigator.onLine);
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        session.current &&
        connectedRef.current &&
        viewRef.current === "favorites"
      )
        void refresh();
    };
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  useEffect(() => {
    if (connected && hydrated && view === "favorites") void refresh();
  }, [connected, hydrated, view]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const broadcast = new BroadcastChannel("cll-favorite-session");
    channel.current = broadcast;
    broadcast.onmessage = event => {
      if (event.data?.account === account?.id) void logout(false);
    };
    return () => {
      broadcast.close();
      channel.current = null;
    };
  }, [account?.id]);
  const selectedMaterial =
    route.kind === "material" && loadedMaterial?.item.key === route.key ? loadedMaterial : null;
  const selected =
    route.kind === "favorite" && loadedFavorite?.summary.key === route.key ? loadedFavorite : null;
  const reading = route.kind === "material" || route.kind === "favorite";
  useEffect(() => {
    if (!reading) {
      setSelectedMaterial(null);
      setSelected(null);
      setRouteError("");
      setRouteLoading(false);
      return;
    }
    if (!account || !repository || !hydrated || selectedMaterial || selected) return;
    let live = true;
    const materialRepo = new DriveLibraryRepository(account.id, libraryDrive, cache);
    setRouteLoading(true);
    setRouteError("");
    void (async () => {
      if (route.kind === "material") {
        await materialRepo.hydrate();
        let item = materialRepo.list().find(item => item.key === route.key);
        if (!item && libraryDrive && navigator.onLine) {
          await materialRepo.refresh();
          item = materialRepo.list().find(item => item.key === route.key);
        }
        if (!item)
          throw new Error(
            libraryDrive
              ? "此帳號沒有這份教材，請返回內容庫重新選擇。"
              : "此裝置沒有這份教材的副本，請連結 Google Drive。",
          );
        const content = await materialRepo.get(item);
        if (live) setSelectedMaterial({ item, content });
      } else if (route.kind === "favorite") {
        let summary = repository.list().find(item => item.key === route.key);
        if (!summary && connected && navigator.onLine) {
          await repository.refresh();
          summary = repository.list().find(item => item.key === route.key);
        }
        if (!summary)
          throw new Error(
            connected
              ? "此收藏已取消或不屬於目前帳號。"
              : "此裝置沒有這份收藏的副本，請連結 Google Drive。",
          );
        const snapshot = await repository.get(summary.key);
        if (live) setSelected({ summary, snapshot });
      }
    })()
      .catch(cause => {
        if (!live) return;
        setRouteError(cause instanceof Error ? cause.message : "無法開啟教材。");
        if (cause instanceof DriveAccessError && cause.status === 401) expireGoogleSession();
      })
      .finally(() => {
        if (live) setRouteLoading(false);
      });
    return () => {
      live = false;
      materialRepo.dispose();
    };
  }, [route, account?.id, repository, hydrated, libraryDrive, loadedMaterial, loadedFavorite]);
  useEffect(() => {
    if (!reading || selectedMaterial || selected) restore();
  }, [route, selectedMaterial, selected, restore]);
  const visible = items.filter(
    item =>
      (!language || item.language === language) &&
      [item.title, item.sourceTitle, item.excerpt]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  async function open(summary: FavoriteSummary) {
    if (!repository || opening) return;
    const startingHash = location.hash;
    const seq = sequence.current;
    setOpening(summary.key);
    setError("");
    try {
      const snapshot = await repository.get(summary.key);
      if (seq !== sequence.current || location.hash !== startingHash) return;
      setSelected({ summary, snapshot });
      setCacheIssue(repository.cacheIssue);
      navigate({ kind: "favorite", key: summary.key });
    } catch (e) {
      if (seq === sequence.current) {
        setError(e instanceof Error ? e.message : "無法開啟收藏。");
        if (e instanceof DriveAccessError && e.status === 401) expireGoogleSession();
      }
    } finally {
      if (seq === sequence.current) setOpening(null);
    }
  }
  return (
    <div className={`app-shell${reading && account ? " reader-mode" : ""}`}>
      {!(reading && account) && (
        <header className="app-header">
          <a
            className="brand"
            href="#"
            onClick={e => {
              e.preventDefault();
              navigate({ kind: "library" });
            }}
          >
            <img className="brand-icon" src="/icons/icon192.png" alt="" />
            <span>
              Contextual<span className="brand-sub">Language Learning</span>
            </span>
          </a>
          <div className="header-actions">
            <PwaInstall />
            <ThemeSwitch value={theme} onChange={changeTheme} />
          </div>
        </header>
      )}
      <main>
        {selectedMaterial && account && favorites ? (
          <LibraryReader
            key={selectedMaterial.item.key}
            accountId={account.id}
            favorites={favorites}
            onFavoriteChanged={() => void refresh()}
            value={selectedMaterial}
            onBack={() => back({ kind: "library" })}
            toolbarActions={<ThemeSwitch value={theme} onChange={changeTheme} />}
          />
        ) : selected ? (
          <>
            <div className="reader-top video-reading-header reading-toolbar">
              <Button variant="ghost" onClick={() => back({ kind: "favorites" })}>
                <ArrowLeft size={17} />
                返回收藏
              </Button>
              <h1 className="reader-context-title" title={selected.summary.title}>
                {selected.summary.title}
              </h1>
              <div className="reader-top-actions">
                <Badge>{selected.summary.kind === "custom" ? "自訂教材" : "情境收藏"}</Badge>
                {selected.snapshot.snapshotVersion === 2 && favorites && (
                  <WebFavoriteButton
                    store={favorites}
                    origin={{
                      documentId: selected.summary.documentId,
                      sceneId: selected.summary.sceneId,
                    }}
                    title={selected.summary.title}
                    snapshot={() => selected.snapshot}
                    onChanged={() => void refresh()}
                  />
                )}
                <ThemeSwitch value={theme} onChange={changeTheme} />
              </div>
            </div>
            {selected.snapshot.source.url &&
              !youtubeVideo(selected.snapshot.source.url) &&
              /^https?:\/\//.test(selected.snapshot.source.url) && (
                <a
                  className="source-link"
                  href={selected.snapshot.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  開啟來源
                  <ArrowUpRight size={14} />
                </a>
              )}
            {selected.snapshot.snapshotVersion === 1 && account && favorites ? (
              <SharedReader
                accountId={account.id}
                document={favoriteReaderDocument(
                  selected.snapshot,
                  "web-favorite:" + selected.summary.key,
                )}
                origin={{
                  documentId: selected.summary.documentId,
                  sceneId: selected.summary.sceneId,
                }}
                favoriteControl={() => (
                  <WebFavoriteButton
                    store={favorites}
                    origin={{
                      documentId: selected!.summary.documentId,
                      sceneId: selected!.summary.sceneId,
                    }}
                    title={selected!.summary.title}
                    snapshot={() => selected!.snapshot}
                    onChanged={() => void refresh()}
                  />
                )}
              />
            ) : selected.snapshot.snapshotVersion === 2 ? (
              <VideoReadingLayout url={selected.snapshot.source.url} title={selected.summary.title}>
                <CustomFavoriteReader snapshot={selected.snapshot} />
              </VideoReadingLayout>
            ) : null}
          </>
        ) : reading && account ? (
          <div className="reader-route-state">
            <Button
              variant="ghost"
              onClick={() => back({ kind: view === "favorites" ? "favorites" : "library" })}
            >
              <ArrowLeft size={17} />
              返回{view === "favorites" ? "收藏" : "內容庫"}
            </Button>
            {routeError ? (
              <Alert variant="destructive">
                <AlertDescription>{routeError}</AlertDescription>
              </Alert>
            ) : (
              <p role="status">{routeLoading ? "正在開啟教材…" : "正在讀取本機副本…"}</p>
            )}
            {routeError && !connected && (
              <Button
                disabled={!clientId || !googleReady || busy || !online}
                onClick={() => void connect()}
              >
                {busy ? "正在連結…" : "連結 Google Drive"}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="intro">
              <p className="eyebrow">YOUR LEARNING LIBRARY</p>
              <h1>你的教材，隨手可讀。</h1>
              <p className="muted">在任何裝置，閱讀 Google Drive 裡的教材與收藏。</p>
            </div>
            <Card className="connection" aria-label="Google Drive 連結">
              <div className="connection-icon">
                <Cloud size={21} />
              </div>
              <div className="connection-copy">
                <strong>{account ? account.email : "連結你的 Google Drive"}</strong>
                <p>
                  {account
                    ? !online
                      ? "離線閱讀 · 僅顯示本機副本"
                      : connected
                        ? view === "library"
                          ? "已連結 · Google Drive"
                          : updatedAt
                            ? "已更新 · " +
                              new Date(updatedAt).toLocaleString("zh-TW", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "已連結 · Google Drive"
                        : "本機副本 · 連結帳號即可更新"
                    : "讀取已備份的教材與收藏，開啟後保存最近閱讀。"}
                </p>
              </div>
              <div className="connection-actions">
                {connected ? (
                  view === "favorites" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="重新整理收藏"
                      title="重新整理收藏"
                      disabled={busy || !online}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw size={17} className={busy ? "spinning" : ""} />
                    </Button>
                  ) : null
                ) : (
                  <Button
                    size="sm"
                    disabled={!clientId || !googleReady || busy || !online}
                    onClick={() => void connect()}
                  >
                    {busy ? "正在連結…" : "連結 Google Drive"}
                  </Button>
                )}
                {account && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={connected ? "登出並清除本機副本" : "清除此帳號的本機資料"}
                    title={connected ? "登出並清除本機副本" : "清除此帳號的本機資料"}
                    onClick={() => void logout()}
                  >
                    {connected ? <LogOut size={17} /> : <Trash2 size={17} />}
                  </Button>
                )}
              </div>
            </Card>
            {!clientId && !demo && (
              <p className="setup-note">Google Drive 連結尚未開放；測試站設定完成後即可使用。</p>
            )}
            {account && (
              <Tabs
                value={view}
                onValueChange={value => {
                  navigate({ kind: value === "favorites" ? "favorites" : "library" });
                  setError("");
                }}
                className="library-tabs"
              >
                <div className="library-toolbar">
                  <TabsList aria-label="內容類型">
                    <TabsTrigger value="library">所有教材</TabsTrigger>
                    <TabsTrigger value="favorites">收藏</TabsTrigger>
                  </TabsList>
                  <LayoutSwitch value={layout} onChange={changeLayout} />
                </div>
                <TabsContent value="library">
                  <LibraryBrowser
                    key={account.id}
                    accountId={account.id}
                    layout={layout}
                    canConnect={!!clientId && googleReady && !busy}
                    onReconnect={connect}
                    drive={libraryDrive}
                    cache={cache}
                    onOpen={value => {
                      setSelectedMaterial(value);
                      navigate({ kind: "material", key: value.item.key });
                    }}
                    onExpired={expireGoogleSession}
                  />
                </TabsContent>
                <TabsContent value="favorites">
                  <section className="collection" aria-label="收藏清單">
                    <div className="collection-heading">
                      <h2>
                        我的收藏 <span>{items.length}</span>
                      </h2>
                    </div>
                    <div className="filters">
                      <label className="search-field">
                        <Search size={16} />
                        <Input
                          type="search"
                          aria-label="搜尋收藏"
                          placeholder="搜尋標題、來源或摘要"
                          value={search}
                          onChange={e => {
                            setSearch(e.target.value);
                            setLimit(40);
                          }}
                        />
                      </label>
                      <LanguageFilter
                        value={language || "all"}
                        onChange={value => {
                          setLanguage(value === "all" ? "" : value);
                          setLimit(40);
                        }}
                      />
                    </div>
                    {hydrated && !visible.length && !busy && (
                      <div className="empty">
                        <Bookmark size={26} />
                        <h3>
                          {search || language
                            ? "沒有符合條件的收藏"
                            : items.length
                              ? "沒有符合條件的收藏"
                              : "這裡會收好你的收藏"}
                        </h3>
                        <p>
                          {search || language
                            ? "試試其他關鍵字或語言。"
                            : updatedAt
                              ? "開啟教材，點選書籤即可加入收藏。"
                              : "連結 Google Drive，即可讀取或加入收藏。"}
                        </p>
                      </div>
                    )}
                    {busy && !items.length && (
                      <p className="loading" role="status">
                        正在讀取收藏清單…
                      </p>
                    )}
                    <ul className={`cards${layout === "list" ? " list-view" : ""}`}>
                      {visible.slice(0, limit).map(item => (
                        <li key={item.key}>
                          <MaterialCard
                            title={item.title}
                            sourceTitle={item.sourceTitle}
                            description={item.excerpt}
                            kindLabel={item.kind === "custom" ? "自訂教材" : "情境"}
                            language={languageNames[item.language] ?? item.language}
                            Icon={Bookmark}
                            action="繼續閱讀"
                            busy={opening === item.key}
                            disabled={opening !== null}
                            onOpen={() => void open(item)}
                          />
                        </li>
                      ))}
                    </ul>
                    {visible.length > limit && (
                      <Button
                        variant="outline"
                        className="more"
                        onClick={() => setLimit(limit + 40)}
                      >
                        載入更多
                      </Button>
                    )}
                  </section>
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
        {error && (
          <Alert variant="destructive" className="notice">
            <AlertDescription>{error}</AlertDescription>
            {account && connected && (
              <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
                重試
              </Button>
            )}
          </Alert>
        )}
        {cacheIssue && (
          <Alert className="notice" role="status">
            <AlertDescription>{cacheIssue}</AlertDescription>
          </Alert>
        )}
        {!account && (
          <div className="welcome-note">
            <Check size={16} />
            <p>
              教材與收藏保存在你的 Drive。
              <br />
              最近開啟的教材，會留在這台裝置供離線閱讀。
            </p>
          </div>
        )}
      </main>
      <footer>
        Contextual Language Learning<span>你的教材與收藏，隨手可讀。</span>
      </footer>
    </div>
  );
}
async function start() {
  let demo: DemoSession | undefined;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("demo"))
    demo = await (await import("./demo")).createDemo();
  createRoot(document.getElementById("root")!).render(<App demo={demo} />);
  if (import.meta.env.PROD && "serviceWorker" in navigator)
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
void start();
