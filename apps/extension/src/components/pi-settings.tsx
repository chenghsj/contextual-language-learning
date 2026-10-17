import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { createFlowCopy } from "../i18n/create-flow";
import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type PiProviderInfo } from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { piCopy } from "../i18n/pi";
import { piFeedback } from "../i18n/pi-feedback";
import { PiFeedback } from "./pi-feedback";
import { CopyButton } from "./copy-button";
import { usePiAuth } from "../hooks/use-pi-auth";
import { nativeOnce } from "../native/host-client";
import { Button } from "./ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Input } from "./ui/input";
import { SelectField } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { SearchableSelectField } from "./searchable-select-field";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type Method = "oauth" | "api_key";

export function PiSettings({
  locale,
  available,
  selectedProvider,
  onSelect,
  onChanged,
  onDirty,
}: {
  locale: UiLocale;
  available: boolean;
  selectedProvider: string;
  onSelect: (provider: string) => void;
  onChanged: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const ui = piCopy[locale];
  const [addExpanded, setAddExpanded] = useState(false);
  const [method, setMethod] = useState<Method>("oauth");
  const [authMethod, setAuthMethod] = useState<Method>("oauth");
  const [selected, setSelected] = useState<Record<Method, string>>({ oauth: "", api_key: "" });
  const [detail, setDetail] = useState("");
  const [providers, setProviders] = useState<PiProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState("");
  const catalogRequest = useRef(0);
  const auth = usePiAuth({
    locale,
    available,
    async onConnected() {
      await refresh();
      toast.success(piCopy[locale].done, { id: "pi-auth-success", duration: 4000 });
    },
    onLoggedOut: refresh,
  });
  const { state, login, cancel: cancelLogin, setValue } = auth;
  const busy = state.kind !== "idle";
  const value = state.kind === "login" ? state.value : "";
  useEffect(() => {
    onDirty?.(!!value);
    return () => onDirty?.(false);
  }, [value, onDirty]);
  useEffect(() => {
    let active = true;
    const request = ++catalogRequest.current;
    if (!available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalogError("");
    void nativeOnce({ id: crypto.randomUUID(), type: "piProviders" })
      .then(reply => {
        if (active && request === catalogRequest.current) setProviders(reply.providers);
      })
      .catch(error => {
        if (active && request === catalogRequest.current) setCatalogError(String(error));
      })
      .finally(() => {
        if (active && request === catalogRequest.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [available, revision]);
  async function refresh(): Promise<void> {
    const request = ++catalogRequest.current;
    const reply = await nativeOnce({ id: crypto.randomUUID(), type: "piProviders" });
    if (request !== catalogRequest.current) return;
    setProviders(reply.providers);
    setLoading(false);
    setCatalogError("");
    onChanged();
  }
  function discardInput(): void {
    setValue("");
    if (state.kind === "login" && authMethod === "api_key") cancelLogin();
  }
  function changeMethod(next: Method): void {
    if (next !== method) discardInput();
    setMethod(next);
  }
  function startLogin(provider: PiProviderInfo, next: Method): void {
    setMethod(next);
    setAuthMethod(next);
    setSelected(current => ({ ...current, [next]: provider.id }));
    setAddExpanded(true);
    login(provider.id, next);
  }
  function resumeAuth(): void {
    setMethod(authMethod);
    setSelected(current => ({ ...current, [authMethod]: state.provider }));
    setAddExpanded(true);
  }
  const connected = providers.filter(provider => provider.connected);
  const formProvider = providers.find(provider => provider.id === selected[method]);
  const showAuth = state.provider === formProvider?.id && authMethod === method;
  const hiddenAuth = state.kind === "login" && (!addExpanded || !showAuth);
  return (
    <section
      id="pi-service-list"
      tabIndex={-1}
      className="grid min-w-0 gap-4"
      data-ui="piSettings"
      aria-busy={loading}
    >
      {!available && (
        <p className="text-xs text-muted-foreground" role="status">
          {ui.unavailable}
        </p>
      )}
      {catalogError && <PiFeedback locale={locale} message={catalogError} />}
      {(catalogError || (available && !loading && !providers.length)) && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={!available || loading}
          onClick={() => setRevision(value => value + 1)}
        >
          {ui.retry}
        </Button>
      )}
      <div className="grid min-w-0 gap-2" data-ui="pi-connected-services">
        <h3 className="text-ui-heading font-semibold">{ui.connectedServices}</h3>
        {loading && (
          <p className="text-xs text-muted-foreground" role="status">
            {ui.loading}
          </p>
        )}
        {!loading && !connected.length && available && !catalogError && (
          <p className="text-xs text-muted-foreground">{ui.noConnections}</p>
        )}
        <Accordion type="single" collapsible value={detail} onValueChange={setDetail}>
          {connected.map(provider => (
            <AccordionItem key={provider.id} value={provider.id}>
              <AccordionTrigger className="min-h-12 px-1 text-left">
                <span className="min-w-0 break-words">
                  <strong className="block">{provider.label}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {ui.configured}
                    {selectedProvider === provider.id ? ` · ${ui.selected}` : ""}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-1">
                <div className="grid gap-3 pt-1">
                  <p className="text-xs text-muted-foreground">
                    {createFlowCopy(locale).accountLimit}
                  </p>
                  {provider.id === "openai-codex" && (
                    <p className="text-xs text-muted-foreground">{ui.openaiLegacyHint}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {provider.methods.map(next => (
                      <Button
                        key={next}
                        variant="outline"
                        size="sm"
                        disabled={!available || busy}
                        onClick={() => startLogin(provider, next)}
                      >
                        {next === "oauth" ? ui.switchAccount : ui.key}
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!available || busy || selectedProvider === provider.id}
                      onClick={() => onSelect(provider.id)}
                    >
                      {selectedProvider === provider.id ? ui.selected : ui.use}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={!available || busy}>
                          {ui.logout}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {ui.logout} · {provider.label}
                          </AlertDialogTitle>
                          <AlertDialogDescription>{ui.safety}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{ui.cancel}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void auth.logout(provider.id)}>
                            {ui.logout}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      {hiddenAuth && (
        <div
          className="flex flex-wrap items-center gap-2 text-xs"
          role="status"
          data-ui="pi-auth-pending"
        >
          <span>
            {ui.authorizing} ·{" "}
            {providers.find(provider => provider.id === state.provider)?.label ?? state.provider}
          </span>
          <Button variant="outline" size="sm" onClick={resumeAuth}>
            {ui.resumeAuth}
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelLogin}>
            {ui.cancel}
          </Button>
        </div>
      )}
      {state.status && (!addExpanded || !showAuth) && (
        <PiFeedback locale={locale} message={state.status} />
      )}
      <div className="grid min-w-0 gap-3 border-t border-border pt-3" data-ui="pi-add-connection">
        <Button
          variant="ghost"
          className="h-auto min-h-11 w-full justify-between whitespace-normal px-3 text-left"
          disabled={!available}
          aria-expanded={addExpanded}
          aria-controls="pi-add-connection-content"
          onClick={() => {
            if (addExpanded) discardInput();
            setAddExpanded(open => !open);
          }}
        >
          {ui.addConnection}
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${addExpanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
        {addExpanded && (
          <div id="pi-add-connection-content">
            <Tabs value={method} onValueChange={value => changeMethod(value as Method)}>
              <TabsList className="grid h-auto w-full grid-cols-2" aria-label={ui.chooseAuthMethod}>
                <TabsTrigger value="oauth" className="min-h-9 whitespace-normal px-2 text-xs">
                  {ui.accountMethod}
                </TabsTrigger>
                <TabsTrigger value="api_key" className="min-h-9 whitespace-normal px-2 text-xs">
                  {ui.apiKeyMethod}
                </TabsTrigger>
              </TabsList>
              {(["oauth", "api_key"] as const).map(next => (
                <TabsContent key={next} value={next} className="mt-3">
                  {method === next && (
                    <SearchableSelectField
                      key={next}
                      id="pi-connection-service"
                      ariaLabel={ui.choose}
                      value={selected[method]}
                      onValueChange={id => setSelected(current => ({ ...current, [next]: id }))}
                      options={providers
                        // Saved legacy connections remain manageable in the connected list.
                        .filter(
                          provider =>
                            (provider.id !== "openai-codex" || provider.id === selected[method]) &&
                            provider.methods.includes(next),
                        )
                        .map(provider => ({
                          value: provider.id,
                          label: provider.methodLabels?.[next] ?? provider.label,
                          keywords: [provider.label],
                          description: provider.connected ? ui.configured : undefined,
                        }))}
                      copy={{
                        search: ui.searchServices,
                        empty: ui.noResults,
                        placeholder: ui.choose,
                      }}
                      disabled={loading || busy || !available}
                      className="min-h-11"
                    />
                  )}
                  {method === next && formProvider && (
                    <div className="mt-3 grid min-w-0 gap-3" data-ui="pi-connection-form">
                      <p className="text-xs text-muted-foreground">
                        {method === "api_key"
                          ? ui.apiBilling
                          : formProvider.id === "openai"
                            ? ui.openaiAccountHint
                            : createFlowCopy(locale).accountLimit}
                      </p>
                      {formProvider.id === "antigravity" && (
                        <p className="text-xs text-muted-foreground">{ui.antigravityHint}</p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        disabled={!available || busy}
                        onClick={() => startLogin(formProvider, method)}
                      >
                        {method === "api_key"
                          ? ui.key
                          : formProvider.connected
                            ? ui.switchAccount
                            : formProvider.id === "antigravity"
                              ? ui.googleLogin
                              : ui.login}
                      </Button>
                      {showAuth && (
                        <PiAuthInteraction
                          key={`${state.id}-${method}`}
                          locale={locale}
                          auth={auth}
                          method={method}
                        />
                      )}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </div>
    </section>
  );
}

function PiAuthInteraction({
  locale,
  auth,
  method,
}: {
  locale: UiLocale;
  auth: ReturnType<typeof usePiAuth>;
  method: Method;
}) {
  const ui = piCopy[locale];
  const { state, answer, cancel, setValue } = auth;
  const [manualPromptId, setManualPromptId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const prompt = state.kind === "login" ? state.prompt : null;
  const event = state.kind === "login" ? state.event : null;
  const value = state.kind === "login" ? state.value : "";
  const browserFallback = prompt?.kind === "manual_code" && !!event?.url;
  const showPrompt = !browserFallback || manualPromptId === prompt?.promptId;
  const description = prompt ? piFeedback(locale, prompt.message, "prompt").message : "";
  // Pi's Copilot login asks for an optional Enterprise domain before starting device authorization.
  const optionalGithubHost =
    state.provider === "github-copilot" &&
    prompt?.kind === "text" &&
    prompt.message === "GitHub Enterprise URL/domain (blank for github.com)";
  const awsCredentialsReady =
    state.provider === "amazon-bedrock" &&
    prompt?.kind === "text" &&
    prompt.message === "Configure AWS credentials, then press Enter to continue";
  // Native Host gives device authorization codes this prefix; keep existing Host versions usable.
  const deviceCode = event?.message.match(/^Sign-in code: (.+)$/)?.[1];
  return (
    <div
      className="grid min-w-0 gap-3 text-ui-body wrap-anywhere"
      data-ui="piAuth"
      aria-live="polite"
    >
      {event && (
        <div className="grid gap-2">
          <PiFeedback
            locale={locale}
            message={deviceCode ? ui.deviceInstructions : event.message}
            context="event"
          />
          {deviceCode && (
            <div className="flex flex-wrap items-center gap-3">
              <code className="break-all rounded-md bg-muted px-3 py-2 text-sm font-semibold">
                {deviceCode}
              </code>
              <CopyButton
                value={deviceCode}
                label={ui.copyCode}
                copiedLabel={ui.codeCopied}
                errorLabel={ui.copyCodeFailed}
              />
            </div>
          )}
          {event.url && /^https?:\/\//.test(event.url) && (
            <Button
              variant="default"
              size="sm"
              className="w-fit"
              onClick={() => void chrome.tabs.create({ url: event.url })}
            >
              {ui.open}
            </Button>
          )}
        </div>
      )}
      {state.kind === "login" && !prompt && !event && (
        <p role="status" className="text-muted-foreground">
          {ui.authorizing}
        </p>
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
            className="h-auto min-h-9 justify-start whitespace-normal text-left text-muted-foreground"
            aria-expanded={showPrompt}
            aria-controls="pi-manual-sign-in"
            onClick={() => {
              if (showPrompt) setValue("");
              setManualPromptId(showPrompt ? null : prompt!.promptId);
            }}
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
          {prompt.kind === "select" ? (
            <SelectField
              ariaLabel={description}
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
            <div className="flex min-w-0 items-center rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring/25">
              <Input
                aria-label={description}
                className="border-0 bg-transparent focus-visible:ring-0"
                type={prompt.kind === "secret" && !showSecret ? "password" : "text"}
                autoComplete="off"
                placeholder={optionalGithubHost ? "github.com" : undefined}
                spellCheck={false}
                autoFocus
                value={value}
                onChange={e => setValue(e.target.value)}
              />
              {prompt.kind === "secret" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0"
                  aria-label={showSecret ? ui.hideKey : ui.showKey}
                  aria-pressed={showSecret}
                  onClick={() => setShowSecret(show => !show)}
                >
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              )}
            </div>
          )}
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!optionalGithubHost && !awsCredentialsReady && !value.trim()}
          >
            {optionalGithubHost && !value.trim()
              ? ui.githubDefault
              : method === "api_key" && prompt.kind === "secret"
                ? ui.saveKey
                : ui.continue}
          </Button>
        </form>
      )}
      {state.kind === "login" && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={cancel}>
          {ui.cancel}
        </Button>
      )}
      {state.status && <PiFeedback locale={locale} message={state.status} />}
    </div>
  );
}
