/**
 * Self-contained OAuth callback UI. The Native Host serves this directly over
 * localhost, so it cannot depend on Chrome extension assets or network fonts.
 * shadcn-style Card / Badge / Alert primitives reuse the app's warm
 * color tokens without loading React inside the Native Messaging process.
 */
export type OAuthCallbackOutcome = "success" | "error";
/** Embedded at build time: the localhost OAuth page cannot load Chrome extension assets. */
const BRAND_ICON =
  "data:image/png;base64,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";

const styles = `
  :root {
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
    --background: oklch(0.9818 0.0054 95.0986);
    --foreground: oklch(0.3438 0.0269 95.7226);
    --card: oklch(0.995 0.003 95);
    --muted: oklch(0.9341 0.0153 90.2390);
    --muted-foreground: oklch(0.5341 0.0078 97.4503);
    --border: oklch(0.8847 0.0069 97.3627);
    --primary: oklch(0.6171 0.1375 39.0427);
    --primary-foreground: white;
    --ring: oklch(0.6171 0.1375 39.0427);
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  body {
    min-width: 320px; min-height: 100vh; margin: 0;
    padding: clamp(24px, 7vw, 64px) 18px;
    display: grid; place-items: center;
    background: var(--background); color: var(--foreground);
    line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  main { width: min(100%, 420px); }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .brand-mark { display: block; width: 34px; height: 34px; object-fit: contain; border-radius: 10px; }
  .brand-name { font-size: 14px; font-weight: 700; letter-spacing: -.015em; }
  .brand-sub { display: block; font-size: 12px; color: var(--muted-foreground); font-weight: 400; }
  [data-slot="card"] {
    overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--card); box-shadow: 0 8px 30px #32271a0c, 0 2px 5px #32271a06;
  }
  .card-body { padding: clamp(18px, 5vw, 24px); }
  .topline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  [data-slot="badge"] {
    display: inline-flex; align-items: center; gap: 6px; width: fit-content;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--muted); padding: 3px 10px;
    font-size: 11px; font-weight: 650;
  }
  .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); }
  .symbol {
    display: grid; place-items: center; width: 40px; height: 40px;
    border-radius: 12px; margin-top: 16px;
    background: color-mix(in oklch, var(--primary) 12%, var(--card));
    color: var(--primary);
  }
  .symbol svg { display: none; width: 21px; height: 21px; }
  [data-state="pending"] .symbol .pending-icon,
  [data-state="success"] .symbol .success-icon,
  [data-state="error"] .symbol .error-icon { display: block; }
  [data-state="pending"] .symbol .pending-icon { animation: rotate 1.15s linear infinite; }
  [data-state="success"] .symbol { display: none; }
  [data-state="error"] .symbol {
    background: #fff0ed; color: #b94131;
  }
  h1 { margin: 12px 0 6px; font-size: clamp(20px, 5vw, 23px); line-height: 1.3; letter-spacing: -.035em; }
  .description { margin: 0; color: var(--muted-foreground); font-size: 13px; }
  [data-slot="alert"] {
    display: flex; align-items: flex-start; gap: 11px; margin-top: 15px;
    padding: 14px; border: 1px solid var(--border); border-radius: 12px;
    background: var(--muted);
  }
  .alert-icon { flex-shrink: 0; width: 17px; height: 17px; margin-top: 2px; color: var(--primary); }
  .alert-heading { font-size: 12px; font-weight: 700; }
  .alert-copy { margin: 3px 0 0; color: var(--muted-foreground); font-size: 12px; }
  [data-state="pending"] [data-slot="alert"],
  [data-state="success"] [data-slot="alert"] { display: none; }
  [data-state="error"] [data-slot="alert"] { background: #fff8f6; border-color: #efc8bf; }
  [data-state="error"] .alert-icon { color: #b94131; }
  .separator { height: 1px; margin: 18px 0 13px; background: var(--border); }
  [data-state="success"] .separator { display: none; }
  [data-state="success"] .footer { margin-top: 17px; }
  .footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .footnote { margin: 0; font-size: 11px; color: var(--muted-foreground); }
  [data-state="success"] .badge-dot { background: #197a42; }
  [data-state="error"] .badge-dot { background: #b94131; }
  @keyframes rotate { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    [data-state="pending"] .symbol .pending-icon { animation: none; }
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --background: oklch(0.2679 0.0036 106.6427);
      --foreground: oklch(0.9576 0.0027 106.4494);
      --card: oklch(0.2928 0.0018 106.5092);
      --muted: oklch(0.2213 0.0038 106.7070);
      --muted-foreground: oklch(0.7713 0.0169 99.0657);
      --border: oklch(0.3618 0.0101 106.8928);
      --primary: oklch(0.6724 0.1308 38.7559);
      --primary-foreground: oklch(0.1908 0.0020 106.5859);
      --ring: var(--primary);
    }
    [data-state="success"] .symbol { background: #183c2a; color: #83d6a4; }
    [data-state="error"] .symbol { background: #4b2926; color: #f1a49d; }
    [data-state="error"] [data-slot="alert"] { background: #382723; border-color: #654139; }
  }
`;

function checkedNonce(nonce: string): string {
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(nonce)) throw new Error("Invalid callback CSP nonce");
  return nonce;
}

/** Send as the first HTTP chunk so the user sees progress during token storage. */
export function oauthCallbackPageStart(nonce: string): string {
  const safeNonce = checkedNonce(nonce);
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正在連結 Google Drive · Contextual Language Learning</title>
<style nonce="${safeNonce}">${styles}</style></head>
<body data-state="pending">
<main>
  <header class="brand">
    <img class="brand-mark" src="${BRAND_ICON}" alt="" aria-hidden="true">
    <span class="brand-name">Contextual Language Learning<span class="brand-sub">Google Drive 帳號連結</span></span>
  </header>
  <section data-slot="card" aria-labelledby="oauth-title">
    <div class="card-body">
      <div class="topline">
        <span data-slot="badge"><span class="badge-dot" aria-hidden="true"></span><span id="oauth-badge">正在處理</span></span>
        <span class="brand-sub">Google Drive</span>
      </div>
      <div class="symbol" aria-hidden="true">
        <svg class="pending-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>
        <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>
        <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h1 id="oauth-title">正在完成 Google Drive 連結</h1>
        <p class="description" id="oauth-description">已收到 Google 授權回應，正在驗證帳號並將授權安全儲存在本機。</p>
      </div>
      <aside data-slot="alert" aria-labelledby="oauth-alert-title">
        <svg class="alert-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7h.01"/></svg>
        <div><div class="alert-heading" id="oauth-alert-title">下一步</div>
          <p class="alert-copy" id="oauth-next-step">請稍候。完成後可以回到 Contextual Language Learning 側邊欄。</p>
        </div>
      </aside>
      <div class="separator"></div>
      <footer class="footer">
        <p class="footnote" id="oauth-footnote">此頁面不會顯示或儲存你的 Google 憑證。</p>
      </footer>
    </div>
  </section>
</main>
<script nonce="${safeNonce}">
  "use strict";
  try { history.replaceState(null, "", location.pathname); } catch (_) {}
  window.__contextualOAuthComplete = function (state) {
    if (state !== "success" && state !== "error") return;
    var copy = state === "success" ? {
      badge: "連結成功",
      title: "Google Drive 已連結",
      description: "帳號已驗證，授權已安全儲存在本機。你現在可以使用 Google Drive 自動備份。",
      next: "回到 Contextual Language Learning 側邊欄，即可看到已連結的 Google 帳號。",
      footnote: "可關閉此分頁，返回側邊欄。",
      pageTitle: "Google Drive 已連結 · Contextual Language Learning"
    } : {
      badge: "連結未完成",
      title: "無法完成 Google 帳號連結",
      description: "授權過程未能完成。你的本地教材不受影響。",
      next: "請返回 Contextual Language Learning 側邊欄查看具體錯誤，再重新連結。",
      footnote: "返回側邊欄查看錯誤與重新連結方式。",
      pageTitle: "Google Drive 連結失敗 · Contextual Language Learning"
    };
    document.body.dataset.state = state;
    document.getElementById("oauth-badge").textContent = copy.badge;
    document.getElementById("oauth-title").textContent = copy.title;
    document.getElementById("oauth-description").textContent = copy.description;
    document.getElementById("oauth-next-step").textContent = copy.next;
    document.getElementById("oauth-footnote").textContent = copy.footnote;
    document.title = copy.pageTitle;
  };
</script>
`;
}

/** Append after token exchange and Keychain storage, then end the response. */
export function oauthCallbackPageEnd(nonce: string, outcome: OAuthCallbackOutcome): string {
  const safeNonce = checkedNonce(nonce);
  return `<script nonce="${safeNonce}">window.__contextualOAuthComplete("${outcome}");</script></body></html>`;
}

export function oauthCallbackHeaders(nonce: string): Record<string, string> {
  const safeNonce = checkedNonce(nonce);
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    Connection: "close",
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'nonce-" + safeNonce + "'",
      "style-src 'nonce-" + safeNonce + "'",
      "img-src data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "connect-src 'none'",
    ].join("; "),
  };
}
