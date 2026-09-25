import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DriveAccount } from "@immersive/core";

const exec = promisify(execFile);
const root = join(homedir(), "Library", "Application Support", "Immersive Learning");
const configPath = join(root, "google-oauth.json");
const accountsPath = join(root, "google-accounts.json");
const keychainService = "dev.immersive.language-learning.google-drive";
const clientIdPattern = /^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/;

interface OAuthConfig { clientId: string; clientSecret?: string }
interface SavedAccount extends DriveAccount { clientId: string }
interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string }
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

export async function configureGoogleOAuth(clientId: string, clientSecret?: string): Promise<void> {
  if (!clientIdPattern.test(clientId)) throw new Error("Expected a Google Desktop OAuth client ID");
  if (clientSecret && clientSecret.length > 512) throw new Error("OAuth client secret is too long");
  await writePrivate(configPath, { clientId, ...(clientSecret ? { clientSecret } : {}) });
}

export async function googleConfigured(): Promise<boolean> {
  try {
    await googleConfig();
    return true;
  } catch {
    return false;
  }
}

async function googleConfig(): Promise<OAuthConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch {
    throw new Error("請先在設定中填寫 Google Desktop OAuth Client ID");
  }
  if (!value || typeof value !== "object") throw new Error("Google OAuth settings are invalid");
  const config = value as Partial<OAuthConfig>;
  if (!config.clientId || !clientIdPattern.test(config.clientId) ||
    (config.clientSecret !== undefined && typeof config.clientSecret !== "string")) {
    throw new Error("Google OAuth settings are invalid");
  }
  return { clientId: config.clientId, clientSecret: config.clientSecret };
}

export async function listGoogleAccounts(): Promise<DriveAccount[]> {
  try {
    const value: unknown = JSON.parse(await readFile(accountsPath, "utf8")) as unknown;
    if (!Array.isArray(value)) throw new Error("Google account list is invalid");
    return value.filter((item): item is SavedAccount =>
      !!item && typeof item === "object" &&
      typeof item.id === "string" && typeof item.email === "string" &&
      typeof item.clientId === "string").map(({ id, email }) => ({ id, email }));
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

async function keychainWrite(id: string, refreshToken: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Google account storage currently requires macOS Keychain");
  // macOS 'security' stores the secret in Keychain. Avoid log output from this command.
  await exec("/usr/bin/security", ["add-generic-password", "-s", keychainService, "-a", id,
    "-w", refreshToken, "-U"], { maxBuffer: 4096 });
}

async function keychainRead(id: string): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Google account storage currently requires macOS Keychain");
  try {
    const { stdout } = await exec("/usr/bin/security",
      ["find-generic-password", "-s", keychainService, "-a", id, "-w"], { maxBuffer: 16_384 });
    return stdout.trim();
  } catch {
    throw new Error("此 Google 帳號的憑證已失效，請重新連線");
  }
}

async function tokenRequest(form: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form, signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = await response.json();
  if (!response.ok || !data || typeof data !== "object" ||
    typeof (data as { access_token?: unknown }).access_token !== "string") {
    throw new Error("Google OAuth token exchange failed; verify the Desktop client credentials and reauthorize");
  }
  return data as TokenResponse;
}

async function authorizationCode(clientId: string): Promise<{ code: string; verifier: string; redirectUri: string }> {
  if (process.platform !== "darwin") throw new Error("Google Drive account login currently supports macOS");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  let resolveCode!: (value: string) => void;
  let rejectCode!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const returnedState = url.searchParams.get("state") ?? "";
    const validState = returnedState.length === state.length &&
      timingSafeEqual(Buffer.from(returnedState), Buffer.from(state));
    if (!validState) { res.writeHead(400).end("Invalid OAuth state"); return; }
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><meta charset=utf-8><p>已完成 Google Drive 授權，可返回 Immersive Learning。</p>");
    if (code) resolveCode(code);
    else rejectCode(new Error(error ? "Google authorization was declined" : "Google did not provide an authorization code"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start local OAuth callback server");
  const redirectUri = "http://127.0.0.1:" + address.port + "/oauth/callback";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    access_type: "offline", prompt: "select_account consent",
    code_challenge: challenge, code_challenge_method: "S256", state,
  }).toString();
  const timeout = setTimeout(() => rejectCode(new Error("Google authorization expired")), 180_000);
  try {
    await exec("/usr/bin/open", [url.toString()], { timeout: 10_000, maxBuffer: 4096 });
    const code = await result;
    return { code, verifier, redirectUri };
  } finally {
    clearTimeout(timeout);
    server.close();
    server.closeAllConnections();
  }
}

export async function connectGoogleAccount(): Promise<DriveAccount> {
  const config = await googleConfig();
  const { code, verifier, redirectUri } = await authorizationCode(config.clientId);
  const form = new URLSearchParams({
    client_id: config.clientId, code, code_verifier: verifier,
    redirect_uri: redirectUri, grant_type: "authorization_code",
  });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const token = await tokenRequest(form);
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + token.access_token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Google identity verification failed");
  const info = await response.json() as Record<string, unknown>;
  if (typeof info.sub !== "string" || typeof info.email !== "string" || info.email_verified === false) {
    throw new Error("Google account did not provide a verified identity");
  }
  const account: SavedAccount = { id: info.sub, email: info.email, clientId: config.clientId };
  const previous = (await savedAccounts()).find(item => item.id === account.id);
  if (token.refresh_token) await keychainWrite(account.id, token.refresh_token);
  else if (!previous) throw new Error("Google did not issue a refresh token; reconnect with consent");
  const accounts = await savedAccounts();
  await writePrivate(accountsPath, [...accounts.filter(item => item.id !== account.id), account]);
  accessTokens.set(account.id, { value: token.access_token,
    expiry: Date.now() + Math.max(token.expires_in - 90, 30) * 1000 });
  return { id: account.id, email: account.email };
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
    client_id: config.clientId, refresh_token: await keychainRead(accountId),
    grant_type: "refresh_token",
  });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const token = await tokenRequest(form);
  accessTokens.set(accountId, { value: token.access_token,
    expiry: Date.now() + Math.max(token.expires_in - 90, 30) * 1000 });
  return token.access_token;
}
