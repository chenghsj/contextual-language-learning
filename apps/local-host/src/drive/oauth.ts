import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createDriveKeychainStore } from "./keychain-credentials";
import { appConfigRoot } from "../platform/paths";
import { join } from "node:path";
import type { DriveAccount } from "@contextual/core";
import {
  oauthCallbackHeaders,
  oauthCallbackPageStart,
  oauthCallbackPageEnd,
  type OAuthCallbackOutcome,
} from "./oauth-callback-page";

const exec = promisify(execFile);
const root = appConfigRoot();
const accountsPath = join(root, "google-accounts.json");
const keychain = createDriveKeychainStore();
const clientIdPattern = /^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/;

interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
}
interface SavedAccount extends DriveAccount {
  clientId: string;
}
interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}
const accessTokens = new Map<string, { value: string; expiry: number }>();

async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temp = path + "." + randomBytes(8).toString("hex") + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

// Desktop OAuth Client ID is injected into the bundled Native Host at build time.
declare const __GOOGLE_OAUTH_CLIENT_ID__: string;
declare const __GOOGLE_OAUTH_CLIENT_SECRET__: string;
async function googleConfig(): Promise<OAuthConfig> {
  const clientId =
    typeof __GOOGLE_OAUTH_CLIENT_ID__ === "string"
      ? __GOOGLE_OAUTH_CLIENT_ID__
      : (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "");
  const clientSecret =
    typeof __GOOGLE_OAUTH_CLIENT_SECRET__ === "string"
      ? __GOOGLE_OAUTH_CLIENT_SECRET__
      : (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "");
  if (!clientIdPattern.test(clientId)) {
    throw new Error("此版本尚未設定 Google OAuth Client ID，請更新 Native Host 或聯絡開發者");
  }
  if (clientSecret.length > 512) throw new Error("Google Desktop OAuth Client Secret 設定無效");
  return { clientId, ...(clientSecret ? { clientSecret } : {}) };
}
export async function googleConfigured(): Promise<boolean> {
  try {
    await googleConfig();
    return true;
  } catch {
    return false;
  }
}

export async function listGoogleAccounts(): Promise<DriveAccount[]> {
  try {
    const value: unknown = JSON.parse(await readFile(accountsPath, "utf8")) as unknown;
    if (!Array.isArray(value)) throw new Error("Google account list is invalid");
    return value
      .filter(
        (item): item is SavedAccount =>
          !!item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.email === "string" &&
          typeof item.clientId === "string",
      )
      .map(({ id, email }) => ({ id, email }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function savedAccounts(): Promise<SavedAccount[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(accountsPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Invalid Google account list");
    return parsed as SavedAccount[];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Report Google's OAuth error code, but never echo token endpoint bodies.
 * The response may contain identifiers or secrets and is not safe to display verbatim.
 */
export function googleTokenError(status: number, response: unknown): Error {
  const payload =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const rawCode = typeof payload.error === "string" ? payload.error : "";
  const code = /^[a-z_]{1,48}$/.test(rawCode) ? rawCode : "unknown";
  const description =
    typeof payload.error_description === "string" ? payload.error_description.toLowerCase() : "";
  let guidance = "請確認 Google Desktop OAuth 用戶端設定後重新授權。";
  if (
    /client[_ ]secret/.test(description) &&
    /missing|required|not present|must be supplied|invalid|incorrect/.test(description)
  ) {
    guidance =
      "Google 要求此桌面 OAuth 用戶端的 Client Secret；請在建置環境設定 GOOGLE_OAUTH_CLIENT_SECRET，重新建置並安裝 Native Host 後再授權。";
  } else if (code === "invalid_client") {
    guidance = "請確認 Client ID 與 Client Secret（如果設定）來自同一個 Desktop OAuth 用戶端。";
  } else if (code === "invalid_grant") {
    guidance = "授權碼可能已失效或被使用，請重新連結 Google 帳號。";
  }
  return new Error("Google OAuth Token 交換失敗（HTTP " + status + "，" + code + "）。" + guidance);
}

async function tokenRequest(form: URLSearchParams, signal?: AbortSignal): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !data ||
    typeof data !== "object" ||
    typeof (data as { access_token?: unknown }).access_token !== "string"
  ) {
    throw googleTokenError(response.status, data);
  }
  return data as TokenResponse;
}

type AuthorizationSession = {
  code: string;
  verifier: string;
  redirectUri: string;
  finish: (outcome: OAuthCallbackOutcome) => void;
};

export function googleAuthorizationError(parameters: URLSearchParams): Error {
  if (parameters.get("error") === "access_denied")
    return new Error("Google authorization was declined");
  return new Error(
    parameters.has("error")
      ? "Google authorization failed"
      : "Google did not provide an authorization code",
  );
}

/**
 * Stream the local callback page immediately after Google returns. Keep the
 * response open until token exchange and Keychain persistence have settled,
 * so the browser cannot report success merely because a code was received.
 */
export async function authorizationCode(
  clientId: string,
  options: { onAuthorization?: (url: string) => void; signal?: AbortSignal } = {},
): Promise<AuthorizationSession> {
  options.signal?.throwIfAborted();
  if (process.platform !== "darwin")
    throw new Error("Google Drive account login currently supports macOS");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  let resolveCode!: (value: AuthorizationSession) => void;
  let rejectCode!: (error: Error) => void;
  const result = new Promise<AuthorizationSession>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  void result.catch(() => {});
  let abortResponse: (() => void) | undefined;
  let redirectUri = "";
  let handled = false;
  let closing = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const returnedState = url.searchParams.get("state") ?? "";
    const validState =
      returnedState.length === state.length &&
      timingSafeEqual(Buffer.from(returnedState), Buffer.from(state));
    if (!validState) {
      res.writeHead(400).end("Invalid OAuth state");
      return;
    }
    if (handled) {
      res.writeHead(409).end("OAuth response already handled");
      return;
    }
    handled = true;

    const nonce = randomBytes(24).toString("base64url");
    res.writeHead(200, oauthCallbackHeaders(nonce));
    res.write(oauthCallbackPageStart(nonce));
    let finished = false;
    function finish(outcome: OAuthCallbackOutcome): void {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (!res.destroyed && !res.writableEnded) res.end(oauthCallbackPageEnd(nonce, outcome));
      stopServer();
    }

    abortResponse = () => finish("error");
    const code = url.searchParams.get("code");
    if (!code) {
      finish("error");
      rejectCode(googleAuthorizationError(url.searchParams));
      return;
    }
    if (timeout) clearTimeout(timeout);
    // Keep the callback open during token exchange, but never keep the local
    // HTTP listener alive indefinitely if a downstream operation stalls.
    timeout = setTimeout(() => finish("error"), 120_000);
    resolveCode({ code, verifier, redirectUri, finish });
  });

  function abort(): void {
    abortResponse?.();
    rejectCode(new Error("Google authorization was declined"));
    stopServer();
  }
  function stopServer(): void {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (closing) return;
    closing = true;
    server.close();
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    stopServer();
    throw new Error("Could not start local OAuth callback server");
  }
  redirectUri = "http://127.0.0.1:" + address.port + "/oauth/callback";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "select_account consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  timeout = setTimeout(() => {
    rejectCode(new Error("Google authorization expired"));
    stopServer();
  }, 180_000);
  try {
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    else if (options.onAuthorization) options.onAuthorization(url.toString());
    else await exec("/usr/bin/open", [url.toString()], { timeout: 10_000, maxBuffer: 4096 });
    return await result;
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    stopServer();
    throw error;
  }
}

export async function connectGoogleAccount(
  options: { onAuthorization?: (url: string) => void; signal?: AbortSignal } = {},
): Promise<DriveAccount> {
  const config = await googleConfig();
  const session = await authorizationCode(config.clientId, options);
  try {
    const form = new URLSearchParams({
      client_id: config.clientId,
      code: session.code,
      code_verifier: session.verifier,
      redirect_uri: session.redirectUri,
      grant_type: "authorization_code",
    });
    if (config.clientSecret) form.set("client_secret", config.clientSecret);
    const token = await tokenRequest(form, options.signal);
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + token.access_token },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Google identity verification failed");
    const info = (await response.json()) as Record<string, unknown>;
    if (
      typeof info.sub !== "string" ||
      typeof info.email !== "string" ||
      info.email_verified === false
    ) {
      throw new Error("Google account did not provide a verified identity");
    }
    const account: SavedAccount = { id: info.sub, email: info.email, clientId: config.clientId };
    const previous = (await savedAccounts()).find(
      item => item.id === account.id && item.clientId === config.clientId,
    );
    options.signal?.throwIfAborted();
    if (token.refresh_token) await keychain.write(account.id, token.refresh_token);
    else if (!previous)
      throw new Error("Google did not issue a refresh token; reconnect with consent");
    const accounts = await savedAccounts();
    await writePrivate(accountsPath, [...accounts.filter(item => item.id !== account.id), account]);
    accessTokens.set(account.id, {
      value: token.access_token,
      expiry: Date.now() + Math.max(token.expires_in - 90, 30) * 1000,
    });
    session.finish("success");
    return { id: account.id, email: account.email };
  } catch (error) {
    session.finish("error");
    throw error;
  }
}

export async function accessTokenFor(accountId: string): Promise<string> {
  const config = await googleConfig();
  const account = (await savedAccounts()).find(item => item.id === accountId);
  if (!account || account.clientId !== config.clientId) {
    throw new Error("Google 帳號尚未連線，或 OAuth Client ID 已變更");
  }
  const cached = accessTokens.get(accountId);
  if (cached && cached.expiry > Date.now()) return cached.value;
  const form = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: await keychain.read(accountId),
    grant_type: "refresh_token",
  });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const token = await tokenRequest(form);
  accessTokens.set(accountId, {
    value: token.access_token,
    expiry: Date.now() + Math.max(token.expires_in - 90, 30) * 1000,
  });
  return token.access_token;
}

/** Disconnect locally without deleting the user's Drive files. */
export async function disconnectGoogleAccount(accountId: string): Promise<void> {
  const accounts = await savedAccounts();
  if (!accounts.some(item => item.id === accountId)) throw new Error("Google 帳號尚未連線");
  accessTokens.delete(accountId);
  await keychain.remove(accountId);
  await writePrivate(
    accountsPath,
    accounts.filter(item => item.id !== accountId),
  );
}
