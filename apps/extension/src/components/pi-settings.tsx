import { ArrowLeft, ChevronRight } from "lucide-react";
import { settingsLayoutCopy } from "../i18n/settings-layout";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { type PiProviderInfo } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { piCopy } from "../i18n/pi";
import { piFeedback } from "../i18n/pi-feedback";
import { PiFeedback } from "./pi-feedback";
import { usePiAuth } from "../hooks/use-pi-auth";
import { nativeOnce } from "../native/host-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";

export function PiSettings({
  locale,
  available,
  selectedProvider,
  onSelect,
  onChanged,
  onDetailChange,
}: {
  locale: UiLocale;
  available: boolean;
  selectedProvider: string;
  onSelect: (provider: string) => void;
  onChanged: () => void;
  onDetailChange?: (open: boolean) => void;
}) {
  const ui = piCopy[locale];
  const layout = settingsLayoutCopy[locale];
  const [manualPromptId, setManualPromptId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    onDetailChange?.(detail !== null);
    return () => onDetailChange?.(false);
  }, [detail, onDetailChange]);
  const [providers, setProviders] = useState<PiProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState("");
  const auth = usePiAuth({
    locale,
    available,
    async onConnected(provider) {
      toast.success(piCopy[locale].done, { id: "pi-auth-success", duration: 4000 });
      onSelect(provider);
      await refresh();
    },
    onLoggedOut: refresh,
  });
  const { state, login, cancel: cancelLogin, answer, logout, setValue } = auth;
  const busy = state.kind !== "idle";
  const loginProvider = state.provider;
  const status = state.status;
  const prompt = state.kind === "login" ? state.prompt : null;
  const event = state.kind === "login" ? state.event : null;
  const browserFallback = prompt?.kind === "manual_code" && !!event?.url;
  const showPrompt = !browserFallback || manualPromptId === prompt?.promptId;
  const value = state.kind === "login" ? state.value : "";
  useEffect(() => {
    let active = true;
    if (!available) {
      setProviders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalogError("");
    void nativeOnce({ id: crypto.randomUUID(), type: "piProviders" })
      .then(reply => {
        if (reply.type !== "piProviders") throw new Error(ui.invalid);
        if (active) setProviders(reply.providers);
      })
      .catch(error => {
        if (active) setCatalogError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [available, revision]);
  async function refresh(): Promise<void> {
    const reply = await nativeOnce({ id: crypto.randomUUID(), type: "piProviders" });
    if (reply.type !== "piProviders") throw new Error(ui.invalid);
    setProviders(reply.providers);
    onChanged();
  }
  return (
    <section
      id="pi-service-list"
      tabIndex={-1}
      className="mt-3 grid min-w-0 gap-2"
      data-ui="piSettings"
      aria-busy={loading || busy}
    >
      {!available && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.unavailable}
        </p>
      )}
      {catalogError && <PiFeedback locale={locale} message={catalogError} />}
      {loading && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.loading}
        </p>
      )}
      {available && !loading && !providers.length && (
        <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>
          {ui.retry}
        </Button>
      )}
      {!detail &&
        [true, false].map(connected => (
          <section key={String(connected)} className="grid gap-1">
            <h3 className="mt-3 text-xs font-semibold">
              {connected ? layout.connected : layout.available}
            </h3>
            {providers
              .filter(provider => provider.connected === connected)
              .map(provider => (
                <Button
                  key={provider.id}
                  variant="ghost"
                  className="h-auto min-h-12 justify-between text-left"
                  onClick={() => setDetail(provider.id)}
                >
                  <span>
                    <strong className="block">{provider.label}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {provider.connected ? ui.connected : ui.disconnected}
                    </span>
                  </span>
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              ))}
          </section>
        ))}
      {detail && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="justify-start rounded-sm px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={() => setDetail(null)}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {layout.back}
        </Button>
      )}
      {providers
        .filter(provider => provider.id === detail)
        .map(provider => (
          <div
            key={provider.id}
            className="grid gap-2 rounded-[var(--radius)] border border-border px-[11px] py-[10px]"
          >
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <strong>{provider.label}</strong>
              <span className="text-muted-foreground">
                {provider.connected ? ui.connected : ui.disconnected}
              </span>
            </div>
            {provider.id === "antigravity" && (
              <p className="text-xs text-muted-foreground">{ui.antigravityHint}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {provider.methods.map(method => (
                <Button
                  key={method}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => login(provider.id, method)}
                >
                  {method === "oauth"
                    ? provider.connected
                      ? ui.switchAccount
                      : provider.id === "antigravity"
                        ? ui.googleLogin
                        : ui.login
                    : ui.key}
                </Button>
              ))}
              {provider.connected && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || selectedProvider === provider.id}
                    onClick={() => onSelect(provider.id)}
                  >
                    {selectedProvider === provider.id ? ui.selected : ui.use}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void logout(provider.id)}
                  >
                    {ui.logout}
                  </Button>
                </>
              )}
            </div>
            {loginProvider === provider.id && (
              <div className="grid gap-2 text-xs" data-ui="piAuth">
                {event && (
                  <div className="grid gap-2">
                    <PiFeedback locale={locale} message={event.message} context="event" />
                    {event.url && /^https?:\/\//.test(event.url) && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => void chrome.tabs.create({ url: event.url })}
                      >
                        {ui.open}
                      </Button>
                    )}
                  </div>
                )}
                {browserFallback && (
                  <>
                    <p role="status" className="text-muted-foreground">
                      {ui.waiting}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="justify-start whitespace-normal text-left text-muted-foreground"
                      aria-expanded={showPrompt}
                      aria-controls="pi-manual-sign-in"
                      onClick={() => setManualPromptId(showPrompt ? null : prompt!.promptId)}
                    >
                      {ui.manualSignIn}
                    </Button>
                  </>
                )}
                {prompt && showPrompt && (
                  <form
                    id={browserFallback ? "pi-manual-sign-in" : undefined}
                    className="grid gap-2"
                    onSubmit={e => {
                      e.preventDefault();
                      answer();
                    }}
                  >
                    <PiFeedback locale={locale} message={prompt.message} context="prompt" />
                    <label className="grid gap-2">
                      <span className="sr-only">
                        {piFeedback(locale, prompt.message, "prompt").message}
                      </span>
                      {prompt.kind === "select" ? (
                        <SelectField
                          ariaLabel={piFeedback(locale, prompt.message, "prompt").message}
                          value={value}
                          onValueChange={setValue}
                          options={
                            prompt.options?.map(option => ({
                              value: option.id,
                              label: piFeedback(locale, option.label, "option").message,
                            })) ?? []
                          }
                        />
                      ) : (
                        <Input
                          type={prompt.kind === "secret" ? "password" : "text"}
                          autoComplete="off"
                          autoFocus
                          value={value}
                          onChange={e => setValue(e.target.value)}
                        />
                      )}
                    </label>
                    <Button type="submit" variant="outline" size="sm" disabled={!value.trim()}>
                      {ui.continue}
                    </Button>
                  </form>
                )}
                {state.kind === "login" && (
                  <Button variant="ghost" size="sm" onClick={cancelLogin}>
                    {ui.cancel}
                  </Button>
                )}
                {status && <PiFeedback locale={locale} message={status} />}
              </div>
            )}
          </div>
        ))}
      {status && !providers.some(provider => provider.id === loginProvider) && (
        <PiFeedback locale={locale} message={status} />
      )}
      {available && <p className="text-xs text-muted-foreground">{ui.safety}</p>}
    </section>
  );
}
