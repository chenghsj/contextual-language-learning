import React, { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Bookmark, Cloud, LoaderCircle, RefreshCw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { LEARNING_LANGUAGES, type DriveAccount, type FavoriteSummary } from "@contextual/core";
import { getFavoritesStore, favoriteStateKey } from "../lib/favorites-store";
import { favoritesCopy } from "../i18n/favorites";
import type { UiLocale } from "../i18n/messages";
import { learningLanguageName } from "../i18n/preferences";
import { customContentCopy } from "../i18n/custom-content";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";
import { Switch } from "./ui/switch";
import { IconTooltip } from "./icon-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { RemoveFavoritePopover } from "./remove-favorite-popover";

export function FavoritesLibrary({
  locale,
  active = true,
  accounts,
  defaultAccountId,
  onOpen,
  onConnect,
}: {
  locale: UiLocale;
  active?: boolean;
  accounts: DriveAccount[];
  defaultAccountId?: string;
  onOpen: (favorite: FavoriteSummary) => Promise<void>;
  onConnect: (accountId?: string) => Promise<unknown>;
}) {
  const store = getFavoritesStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const copy = favoritesCopy(locale);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FavoriteSummary | null>(null);
  const [accountChoice, setAccountChoice] = useState<string>();
  const id = useId();
  useEffect(() => {
    if (!active) return;
    void store.open();
    return () => store.close();
  }, [store, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      void store.list({ search, language, limit: 40 });
    }, 250);
    return () => clearTimeout(timer);
  }, [store, search, language, active]);
  const collection = state.collection;
  const accountId = collection.kind === "account" ? collection.accountId : undefined;
  useEffect(() => setRemoving(null), [accountId, active]);
  const targetAccountId =
    accountChoice ??
    accountId ??
    accounts.find(account => account.id === defaultAccountId)?.id ??
    accounts[0]?.id;
  const unknownAccount =
    targetAccountId && !accounts.some(account => account.id === targetAccountId);
  const syncEnabled = state.status?.enabled ?? false;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      toast.dismiss("favorites-library");
    } catch {
      toast.error(copy.error, {
        id: "favorites-library",
        position: "bottom-center",
        duration: 2500,
        closeButton: true,
      });
    } finally {
      setBusy(false);
    }
  }
  const statusText = (() => {
    if (!state.status) return "";
    switch (state.status.state) {
      case "local":
      case "disabled":
        return copy.local;
      case "auth-required":
        return copy.auth;
      case "offline":
        return copy.offline;
      case "synced":
        return copy.synced;
      case "syncing":
        return copy.syncing;
      case "pending":
        return copy.pending + " (" + state.status.pending + ")";
      case "partial":
        return copy.partial;
      case "error":
        return copy.error;
    }
  })();
  return (
    <section className="space-y-3 p-3" aria-label={copy.title} data-ui="favorites-library">
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={id + "-sync"} className="min-w-0 flex-1 text-sm font-medium">
            {copy.enable}
          </label>
          <Switch
            id={id + "-sync"}
            aria-describedby={id + "-status"}
            checked={syncEnabled}
            disabled={busy || !state.status || !targetAccountId}
            onCheckedChange={enabled => {
              const owner = enabled ? targetAccountId : accountId;
              if (!owner) return;
              void run(async () => {
                await store.configure(
                  enabled
                    ? { kind: "enable", accountId: owner, importLocal: true }
                    : { kind: "disable", accountId: owner },
                );
                setAccountChoice(undefined);
              });
            }}
          />
          <Popover>
            <IconTooltip label={copy.syncSettings}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 [&_svg]:size-3.5"
                  aria-label={copy.syncSettings}
                >
                  <Settings2 aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </IconTooltip>
            <PopoverContent
              align="end"
              className="w-80 max-w-[calc(100vw-24px)] space-y-3 rounded-xl p-3"
              aria-label={copy.syncSettings}
            >
              <p className="text-ui-heading font-semibold">{copy.syncSettings}</p>
              {targetAccountId && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground" htmlFor={id + "-account"}>
                    {copy.account}
                  </label>
                  <SelectField
                    id={id + "-account"}
                    ariaLabel={copy.account}
                    value={targetAccountId}
                    options={[
                      ...accounts.map(account => ({ value: account.id, label: account.email })),
                      ...(unknownAccount
                        ? [{ value: targetAccountId, label: targetAccountId }]
                        : []),
                    ]}
                    disabled={busy || syncEnabled}
                    onValueChange={setAccountChoice}
                  />
                  {syncEnabled && (accounts.length > 1 || unknownAccount) && (
                    <p className="text-ui-body text-muted-foreground">{copy.accountLocked}</p>
                  )}
                </div>
              )}
              {syncEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || state.status?.state === "syncing"}
                  onClick={() => {
                    void run(() => store.sync());
                  }}
                >
                  <RefreshCw
                    className={
                      state.status?.state === "syncing"
                        ? "animate-spin motion-reduce:animate-none"
                        : undefined
                    }
                    aria-hidden="true"
                  />
                  {state.status?.state === "syncing" ? copy.syncing : copy.sync}
                </Button>
              )}
              {(!accounts.length || unknownAccount || state.status?.state === "auth-required") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void run(() => onConnect(targetAccountId));
                  }}
                >
                  {copy.connect}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <p id={id + "-status"} className="text-ui-body text-muted-foreground" role="status">
          {statusText || copy.loading}
        </p>
        {!targetAccountId && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void run(() => onConnect());
            }}
          >
            {copy.connect}
          </Button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)] gap-2">
        <div className="relative min-w-0">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            type="search"
            aria-label={copy.search}
            placeholder={copy.search}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
        <SelectField
          ariaLabel={copy.language}
          value={language}
          options={[
            { value: "", label: copy.allLanguages },
            { value: "unspecified", label: customContentCopy(locale).unspecified },
            ...LEARNING_LANGUAGES.map(value => ({
              value,
              label: learningLanguageName(value, locale),
            })),
          ]}
          onValueChange={setLanguage}
        />
      </div>
      {state.error && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3">
          <p className="text-ui-body">{copy.error}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={state.loading}
            onClick={() => {
              void store.open();
            }}
          >
            {copy.retry}
          </Button>
        </div>
      )}
      {state.page?.partial && (
        <p role="status" className="text-ui-body text-muted-foreground">
          {copy.partial}
        </p>
      )}
      {state.loading && (
        <p role="status" className="flex items-center gap-2 text-ui-body text-muted-foreground">
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {copy.loading}
        </p>
      )}
      {!state.loading && !state.error && state.page?.items.length === 0 && (
        <p className="py-8 text-center text-ui-body text-muted-foreground">
          {search || language ? copy.noResults : copy.empty}
        </p>
      )}
      <ul className="grid gap-3">
        {state.page?.items.map(item => {
          const pending = state.pending.has(favoriteStateKey(item.documentId, item.sceneId));
          const itemLanguage = LEARNING_LANGUAGES.find(value => value === item.language);
          return (
            <li
              key={item.key}
              className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-colors hover:bg-accent/30"
            >
              <Button
                variant="ghost"
                className="h-auto min-h-11 w-full min-w-0 flex-col items-start justify-start gap-1 whitespace-normal p-3 pr-12 text-left hover:bg-transparent"
                disabled={busy || opening !== null}
                onClick={() => {
                  setOpening(item.key);
                  void onOpen(item)
                    .catch(() =>
                      toast.error(copy.error, {
                        id: "favorites-open",
                        position: "bottom-center",
                        duration: 2500,
                        closeButton: true,
                      }),
                    )
                    .finally(() => setOpening(null));
                }}
              >
                <span className="line-clamp-2 max-w-full break-words text-sm font-semibold">
                  {item.title}
                </span>
                <span className="line-clamp-1 max-w-full break-words text-xs text-muted-foreground">
                  {item.sourceTitle} ·{" "}
                  {item.kind === "custom"
                    ? customContentCopy(locale).custom
                    : itemLanguage
                      ? learningLanguageName(itemLanguage, locale)
                      : item.language.toUpperCase()}
                </span>
                <span className="line-clamp-2 max-w-full break-words text-xs leading-relaxed text-muted-foreground">
                  {item.excerpt}
                </span>
                {item.pending && syncEnabled && (
                  <span className="text-xs text-muted-foreground">{copy.pending}</span>
                )}
              </Button>
              <RemoveFavoritePopover
                locale={locale}
                title={item.title}
                triggerLabel={copy.remove}
                className="absolute right-2 top-2"
                open={removing?.key === item.key}
                onOpenChange={open => setRemoving(open ? item : null)}
                onConfirm={() => {
                  void store.set(item.documentId, item.sceneId, false).catch(() =>
                    toast.error(copy.error, {
                      id: "favorites-remove",
                      position: "bottom-center",
                      duration: 2500,
                      closeButton: true,
                    }),
                  );
                }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 [&_svg]:size-3.5"
                  aria-label={copy.remove + " · " + item.title}
                  disabled={busy || pending || opening !== null}
                >
                  <Bookmark fill="currentColor" aria-hidden="true" />
                </Button>
              </RemoveFavoritePopover>
            </li>
          );
        })}
      </ul>
      {state.page?.nextCursor && (
        <Button
          variant="outline"
          className="w-full"
          disabled={state.loading}
          onClick={() => {
            void store.list({ search, language, limit: 40, cursor: state.page?.nextCursor }, true);
          }}
        >
          {copy.more}
        </Button>
      )}
    </section>
  );
}
