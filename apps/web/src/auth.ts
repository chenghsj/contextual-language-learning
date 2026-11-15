export type GoogleAccount = { id: string; email: string };
export type GoogleAuthorization = { account: GoogleAccount; token: string; expiresAt: number };
type TokenResponse = { access_token?: string; error?: string; scope?: string; expires_in?: number };
const SESSION_KEY = "cll-google-session";

export function clearGoogleSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function saveGoogleSession(clientId: string, authorization: GoogleAuthorization) {
  clearGoogleSession();
  if (authorization.expiresAt <= Date.now() + 30_000) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ clientId, ...authorization }));
  } catch {
    /* The active page can still use its in-memory authorization. */
  }
}
export function readGoogleSession(
  clientId: string,
  account: GoogleAccount,
): GoogleAuthorization | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    if (
      value?.clientId === clientId &&
      value.account?.id === account.id &&
      value.account?.email === account.email &&
      typeof value.token === "string" &&
      value.token &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > Date.now() + 30_000
    )
      return { account: value.account, token: value.token, expiresAt: value.expiresAt };
  } catch {
    /* Invalid or inaccessible session storage is treated as signed out. */
  }
  clearGoogleSession();
  return null;
}
type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: (error: { type?: string }) => void;
      }): { requestAccessToken(options: { prompt: string; login_hint?: string }): void };
    };
  };
};
declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}
let script: Promise<void> | undefined;
export async function loadGoogleIdentity() {
  if (window.google) return;
  return (script ??= new Promise<void>((resolve, reject) => {
    const node = document.createElement("script");
    node.src = "https://accounts.google.com/gsi/client";
    node.async = true;
    node.onload = () => resolve();
    node.onerror = () => {
      script = undefined;
      node.remove();
      reject(new Error("無法載入 Google 連結功能，請檢查網路。"));
    };
    document.head.append(node);
  }));
}
/** Invoke from a user gesture after loadGoogleIdentity has completed. */
export async function authorizeGoogle(
  clientId: string,
  account?: GoogleAccount | null,
): Promise<GoogleAuthorization> {
  if (!window.google) throw new Error("Google 連結功能尚未載入，請重試。");
  const authorization = await new Promise<{ token: string; expiresAt: number }>(
    (resolve, reject) => {
      window
        .google!.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "openid email https://www.googleapis.com/auth/drive.file",
          callback: response => {
            if (
              !response.access_token ||
              response.error ||
              !response.scope?.split(" ").includes("https://www.googleapis.com/auth/drive.file")
            )
              reject(new Error("未取得 Google Drive 存取授權，請重新連結。"));
            else
              resolve({
                token: response.access_token,
                expiresAt:
                  Date.now() +
                  (Number.isFinite(response.expires_in) && response.expires_in! > 0
                    ? response.expires_in! * 1000
                    : 0),
              });
          },
          error_callback: error =>
            reject(
              new Error(
                error?.type === "popup_failed_to_open"
                  ? "瀏覽器阻擋了 Google 視窗，請允許此網站開啟彈出式視窗後重試。"
                  : error?.type === "popup_closed"
                    ? "Google 連結視窗已關閉，請再次連結。"
                    : "Google 連結未完成，可再次連結。",
              ),
            ),
        })
        .requestAccessToken(
          account ? { prompt: "", login_hint: account.id } : { prompt: "select_account" },
        );
    },
  );
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + authorization.token },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error("無法確認 Google 帳號，請重新連結。");
  const info = await response.json();
  if (
    typeof info.sub !== "string" ||
    typeof info.email !== "string" ||
    info.email_verified === false
  )
    throw new Error("Google 帳號資訊無效。");
  return { account: { id: info.sub, email: info.email }, ...authorization };
}
