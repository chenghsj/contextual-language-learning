/**
 * Self-contained OAuth callback UI. The Native Host serves this directly over
 * localhost, so it cannot depend on Chrome extension assets or network fonts.
 * shadcn-style Card / Badge / Alert primitives reuse the app's warm
 * color tokens without loading React inside the Native Messaging process.
 */
export type OAuthCallbackOutcome = "success" | "error";
/** Embedded at build time: the localhost OAuth page cannot load Chrome extension assets. */
const BRAND_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAABgFBMVEXOXEAAAADMVjnVYkb9+vX617n65NL0xq7428mqVVXOWz7ahm7/f3//AADWdVroqI7OWz9/fwDssZrvzsLelYHNWj7PW0DilXnGSi7PW0Ddkn7SXEDQW0HYfGPjnof/VVX57OO/Pz/suqf//wDQWUbQYzf/fwD/fz/KWTvNWz3QWz7LWT7NW0B/f3+qVSraSEjaYUjgZUbgj3IAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADbzr8mAAAAgHRSTlP9AP3+/v7+/f0DM/0CAf39uAL+/v7Btf39wv5zMP39A/4E/gEQDgIEE0R1mpICBgcV//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF2vLb8AAALqSURBVHjanZaJeqIwEICTmVwUSSq2ghWsq3Xb7r37/g+3kxBudI/5PhVh/mTuwHgv51WyKKvzQIm1F9mHjF+VwcMWeKbPpaqquyW5RIUeyNb8Zb9jV2W3f+NZ1gN0uWeI1wF6tg9qDZBl3+5vaEdm+xIIArLk+aY+QCS+J1kAEv7l5y392nkCGH4mVQISXmG31lwYHGRQJ+qdlBlf8WgQAM6E3AVtLLCDRsBHiiZb8SqqH4yaiVD4y5i8RK0K2uKOJ+yVf/IbAG7EXI4nTCVJUaLXxz1/ZR8ai+Ak1CGdClpnPCDztAkUf2YJ3xIAVoi6nDpcFkoFfalU7UP1yFfkQwCehIEukKxLiy0aoGjuPPKPrAkSAZsIAKYIfZxRk74tmb+Fy0AqVAotgmClTMs093cIWC8ADxQe3W4C1uaSIJXfBsTxCeJ+J1sAOln/ARDiAM0O4pB6v6IP63mUItDEMcRbdRU7AsY7OBZNIsB0PXHVJG2hc5qA9g/uFgGr+6gC1EqZIvLLPvhsdTmn8PjCkLTlJHFkx8O8e2rZ1J6UxodpaJL3VJmh0D8dlk/TUIGUyjFwzF2eh08efp0RpKi1RqQvqRxMnDZTewqh1SGWfOmU79Fd7zSZZPRYfC9oVxTOMXRknYWJSWYstIL3oGDS0frB7WHiCJhuEACpqcLTGKdJlIbT4hjKKaTAluCUZ+3IhyehBqufTAtQTRW2pJ6QGkaJQzJ5mIRQsZKiVJ+UdDTNqAs9sKIxs8VBFwwlpCGYL7VPA8N7GjNxkPnW2uiw8CaKMeRBsJ6+i1BLfpAlcVSykB7qzbQdStboAtNc+2z42qOa9KOSf+U7bCeEE6YfMWgD6EcyNAN/d16Hcf+ObXs96L6027aErtyxGff+QOmGykB/dKiEHeOBQkfWZRv3gKnW+JCLRxaddW8hecOOgxFId3B7aQ/F6bG7ZNX42KXL878d7PHN4Mfie0N1V73MXh3+4+Xkr19/fgN8+jVwJwwNOwAAAABJRU5ErkJggg==";

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
<title>正在連結 Google Drive · Immersive Learning</title>
<style nonce="${safeNonce}">${styles}</style></head>
<body data-state="pending">
<main>
  <header class="brand">
    <img class="brand-mark" src="${BRAND_ICON}" alt="" aria-hidden="true">
    <span class="brand-name">Immersive Learning<span class="brand-sub">Google Drive 帳號連結</span></span>
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
          <p class="alert-copy" id="oauth-next-step">請稍候。完成後可以回到 Immersive Learning 側邊欄。</p>
        </div>
      </aside>
      <div class="separator"></div>
      <footer class="footer">
        <p class="footnote" id="oauth-footnote">此頁面不會顯示或儲存你的 Google 憑證。</p>
        <span class="footnote" id="oauth-shortcut">完成後按 ⌘W 關閉分頁</span>
      </footer>
    </div>
  </section>
</main>
<script nonce="${safeNonce}">
  "use strict";
  try { history.replaceState(null, "", location.pathname); } catch (_) {}
  window.__immersiveOAuthComplete = function (state) {
    if (state !== "success" && state !== "error") return;
    var copy = state === "success" ? {
      badge: "連結成功",
      title: "Google Drive 已連結",
      description: "帳號已驗證，授權已安全儲存在本機。你現在可以使用 Google Drive 自動備份。",
      next: "回到 Immersive Learning 側邊欄，即可看到已連結的 Google 帳號。",
      footnote: "連結完成後，可以回到 Immersive Learning 側邊欄。",
      pageTitle: "Google Drive 已連結 · Immersive Learning"
    } : {
      badge: "連結未完成",
      title: "無法完成 Google 帳號連結",
      description: "授權過程未能完成。你的本地教材不受影響。",
      next: "請返回 Immersive Learning 側邊欄查看具體錯誤，再重新連結。",
      footnote: "返回側邊欄查看錯誤與重新連結方式。",
      pageTitle: "Google Drive 連結失敗 · Immersive Learning"
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
  return `<script nonce="${safeNonce}">window.__immersiveOAuthComplete("${outcome}");</script></body></html>`;
}

export function oauthCallbackHeaders(nonce: string): Record<string, string> {
  const safeNonce = checkedNonce(nonce);
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Connection": "close",
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
