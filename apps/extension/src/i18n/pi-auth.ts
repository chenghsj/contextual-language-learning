import type { UiLocale } from "./messages";

// Translate SDK-owned authentication copy at render time so an active login also
// follows locale changes. Keep URLs, codes and provider names intact.
const copy = {
  browser: [
    "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.",
    "請在瀏覽器完成登入。若未自動完成，請在下方貼上最後的重新導向網址。",
    "请在浏览器完成登录。若未自动完成，请在下方粘贴最终重定向网址。",
    "ブラウザーでログインしてください。自動で完了しない場合は、最後のリダイレクト URL を下に貼り付けてください。",
    "브라우저에서 로그인하세요. 자동으로 완료되지 않으면 아래에 최종 리디렉션 URL을 붙여 넣으세요.",
  ],
  redirect: [
    "Complete login in your browser, or paste the final redirect URL here:",
    "請在瀏覽器完成登入，或在此貼上最後的重新導向網址：",
    "请在浏览器完成登录，或在此粘贴最终重定向网址：",
    "ブラウザーでログインするか、最後のリダイレクト URL をここに貼り付けてください：",
    "브라우저에서 로그인하거나 여기에 최종 리디렉션 URL을 붙여 넣으세요:",
  ],
  code: [
    "Complete login in your browser, or paste the authorization code / redirect URL here:",
    "請在瀏覽器完成登入，或在此貼上授權碼／重新導向網址：",
    "请在浏览器完成登录，或在此粘贴授权码／重定向网址：",
    "ブラウザーでログインするか、認証コード／リダイレクト URL をここに貼り付けてください：",
    "브라우저에서 로그인하거나 여기에 인증 코드 / 리디렉션 URL을 붙여 넣으세요:",
  ],
  open: [
    "Open this link to sign in.",
    "請開啟登入網頁並完成登入。",
    "请打开登录网页并完成登录。",
    "ログインページを開いてログインしてください。",
    "로그인 페이지를 열고 로그인하세요.",
  ],
  exchange: [
    "Exchanging authorization code for tokens...",
    "正在驗證授權碼…",
    "正在验证授权码…",
    "認証コードを確認中…",
    "인증 코드 확인 중…",
  ],
  models: [
    "Enabling models...",
    "正在啟用模型…",
    "正在启用模型…",
    "モデルを有効化中…",
    "모델 활성화 중…",
  ],
  device: [
    "Sign-in code: {value}",
    "登入驗證碼：{value}",
    "登录验证码：{value}",
    "ログインコード：{value}",
    "로그인 코드: {value}",
  ],
  key: [
    "Enter {value} API key",
    "請輸入 {value} API Key",
    "请输入 {value} API Key",
    "{value} の API キーを入力してください",
    "{value} API 키를 입력하세요",
  ],
  method: [
    "Select {value} authentication method:",
    "請選擇 {value} 驗證方式：",
    "请选择 {value} 验证方式：",
    "{value} の認証方法を選択してください：",
    "{value} 인증 방식을 선택하세요:",
  ],
  loginMethod: [
    "Select {value} login method:",
    "請選擇 {value} 登入方式：",
    "请选择 {value} 登录方式：",
    "{value} のログイン方法を選択してください：",
    "{value} 로그인 방식을 선택하세요:",
  ],
  browserOption: [
    "Browser login (default)",
    "瀏覽器登入（預設）",
    "浏览器登录（默认）",
    "ブラウザーログイン（既定）",
    "브라우저 로그인 (기본값)",
  ],
  deviceOption: [
    "Device code login (headless)",
    "裝置驗證碼登入（無瀏覽器）",
    "设备验证码登录（无浏览器）",
    "デバイスコードでログイン（ブラウザーなし）",
    "장치 코드 로그인 (브라우저 없음)",
  ],
  recommended: [
    "Sign in with browser (recommended)",
    "使用瀏覽器登入（建議）",
    "使用浏览器登录（推荐）",
    "ブラウザーでログイン（推奨）",
    "브라우저로 로그인 (권장)",
  ],
  otherDevice: [
    "Sign in with device code (when signing in from another device)",
    "使用裝置驗證碼登入（從其他裝置登入時）",
    "使用设备验证码登录（从其他设备登录时）",
    "デバイスコードでログイン（別の端末からログインする場合）",
    "장치 코드로 로그인 (다른 장치에서 로그인할 때)",
  ],
  enterprise: [
    "GitHub Enterprise URL/domain (blank for github.com)",
    "GitHub Enterprise 網址／網域（使用 github.com 時留空）",
    "GitHub Enterprise 网址／域名（使用 github.com 时留空）",
    "GitHub Enterprise URL／ドメイン（github.com の場合は空欄）",
    "GitHub Enterprise URL/도메인 (github.com은 비워 두세요)",
  ],
  account: [
    "Enter {value} account ID",
    "請輸入 {value} 帳號 ID",
    "请输入 {value} 账号 ID",
    "{value} のアカウント ID を入力してください",
    "{value} 계정 ID를 입력하세요",
  ],
  gateway: [
    "Enter Cloudflare AI Gateway ID",
    "請輸入 Cloudflare AI Gateway ID",
    "请输入 Cloudflare AI Gateway ID",
    "Cloudflare AI Gateway ID を入力してください",
    "Cloudflare AI Gateway ID를 입력하세요",
  ],
  project: [
    "Enter Google Cloud project ID",
    "請輸入 Google Cloud 專案 ID",
    "请输入 Google Cloud 项目 ID",
    "Google Cloud プロジェクト ID を入力してください",
    "Google Cloud 프로젝트 ID를 입력하세요",
  ],
  location: [
    "Enter Google Cloud location",
    "請輸入 Google Cloud 區域",
    "请输入 Google Cloud 区域",
    "Google Cloud のリージョンを入力してください",
    "Google Cloud 리전을 입력하세요",
  ],
  file: [
    "Enter service account credentials file path",
    "請輸入服務帳號憑證檔案路徑",
    "请输入服务账号凭证文件路径",
    "サービスアカウント認証情報ファイルのパスを入力してください",
    "서비스 계정 인증 정보 파일 경로를 입력하세요",
  ],
  profile: [
    "Enter AWS profile name",
    "請輸入 AWS 設定檔名稱",
    "请输入 AWS 配置文件名称",
    "AWS プロファイル名を入力してください",
    "AWS 프로필 이름을 입력하세요",
  ],
  bearer: [
    "Enter Amazon Bedrock bearer token",
    "請輸入 Amazon Bedrock Bearer Token",
    "请输入 Amazon Bedrock Bearer Token",
    "Amazon Bedrock Bearer トークンを入力してください",
    "Amazon Bedrock Bearer 토큰을 입력하세요",
  ],
  cancelled: [
    "Login cancelled.",
    "已取消登入。",
    "已取消登录。",
    "ログインをキャンセルしました。",
    "로그인이 취소되었습니다.",
  ],
  expired: [
    "This login prompt has expired.",
    "此登入提示已過期，請重新登入。",
    "此登录提示已过期，请重新登录。",
    "このログイン入力は期限切れです。再度ログインしてください。",
    "로그인 입력이 만료되었습니다. 다시 로그인하세요.",
  ],
  timeout: [
    "Sign-in timed out. Try again.",
    "登入逾時，請重試。",
    "登录超时，请重试。",
    "ログインがタイムアウトしました。再試行してください。",
    "로그인 시간이 초과되었습니다. 다시 시도하세요.",
  ],
  callback: [
    "Waiting for the sign-in callback at {value}.",
    "正在等待登入回呼：{value}。",
    "正在等待登录回调：{value}。",
    "ログインのコールバックを待機中：{value}。",
    "로그인 콜백 대기 중: {value}.",
  ],
  callbackUnavailable: [
    "Automatic sign-in callback is unavailable. Paste the final redirect URL to continue.",
    "無法自動接收登入回呼。請貼上最後的重新導向網址以繼續。",
    "无法自动接收登录回调。请粘贴最终重定向网址以继续。",
    "ログインのコールバックを受信できません。最後のリダイレクト URL を貼り付けてください。",
    "로그인 콜백을 자동으로 받을 수 없습니다. 최종 리디렉션 URL을 붙여 넣으세요.",
  ],
  antigravity: [
    "Complete Google sign-in. Pi captures the local callback automatically — or, on a remote/headless machine, paste the callback URL when prompted.",
    "請完成 Google 登入。系統會自動接收本機回呼；若使用遠端或無瀏覽器的電腦，請依提示貼上回呼網址。",
    "请完成 Google 登录。系统会自动接收本机回调；若使用远程或无浏览器的电脑，请按提示粘贴回调网址。",
    "Google にログインしてください。ローカルのコールバックは自動受信されます。リモート端末では指示に従ってコールバック URL を貼り付けてください。",
    "Google 로그인을 완료하세요. 로컬 콜백은 자동으로 수신됩니다. 원격 장치에서는 안내에 따라 콜백 URL을 붙여 넣으세요.",
  ],
  pasteCallback: [
    "Remote/headless machine (your browser can't reach localhost:51121)? After signing in, paste the full callback URL shown in your browser's address bar.",
    "若使用遠端電腦或瀏覽器無法連到 localhost:51121，請在登入後貼上瀏覽器網址列中的完整回呼網址。",
    "若使用远程电脑或浏览器无法连接 localhost:51121，请在登录后粘贴浏览器地址栏中的完整回调网址。",
    "リモート端末などで localhost:51121 に接続できない場合、ログイン後にブラウザーのアドレスバーから完全なコールバック URL を貼り付けてください。",
    "원격 장치에서 localhost:51121에 접속할 수 없다면 로그인 후 브라우저 주소창의 전체 콜백 URL을 붙여 넣으세요.",
  ],
  invalidCallback: [
    "Invalid callback. Please paste the full URL:",
    "回呼網址無效，請貼上完整網址：",
    "回调网址无效，请粘贴完整网址：",
    "コールバックが無効です。完全な URL を貼り付けてください：",
    "콜백이 잘못되었습니다. 전체 URL을 붙여 넣으세요:",
  ],
  copilotToken: [
    "Enter GitHub Copilot token",
    "請輸入 GitHub Copilot 權杖",
    "请输入 GitHub Copilot 令牌",
    "GitHub Copilot トークンを入力してください",
    "GitHub Copilot 토큰을 입력하세요",
  ],
} as const;
const indexes: Record<UiLocale, number> = { en: 0, "zh-TW": 1, "zh-CN": 2, ja: 3, ko: 4 };
type Key = keyof typeof copy;
export function piAuthMessage(locale: UiLocale, message: string): string {
  const translated = (key: Key, value = "") =>
    copy[key][indexes[locale]].replace("{value}", () => value);
  if (locale === "en") return message;
  for (const key of Object.keys(copy) as Key[]) {
    if (message === copy[key][0]) return translated(key);
  }
  if (message === "Complete login in your browser.") return translated("open");
  if (
    [
      "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
      "Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
    ].includes(message)
  )
    return translated("browser");
  if (
    message ===
    "Complete sign-in in your browser, or paste the authorization code / redirect URL here:"
  )
    return translated("code");
  if (
    [
      "Continue in your browser.",
      "A browser window should open. Complete login to finish.",
    ].includes(message)
  )
    return translated("open");
  if (message === "Exchanging authorization code for an API key...") return translated("exchange");
  if (/^Login cancelled\.?$|^This operation was aborted$/.test(message))
    return translated("cancelled");
  if (/timed out|^Device flow timed out/.test(message)) return translated("timeout");
  if (/^Listening for (?:OpenRouter )?OAuth callback on (.+)$/.test(message))
    return translated(
      "callback",
      message.replace(/^Listening for (?:OpenRouter )?OAuth callback on /, ""),
    );
  if (message.startsWith("Could not listen on ")) return translated("callbackUnavailable");
  if (/^Invalid callback \(.+\)\. Please paste the full URL:$/s.test(message))
    return translated("invalidCallback");
  const patterns: [RegExp, Key][] = [
    [/^Sign-in code: (.+)$/s, "device"],
    [/^Enter (.+) API key$/, "key"],
    [/^Select (.+) authentication method:$/, "method"],
    [/^Select (.+) login method:$/, "loginMethod"],
    [/^Sign in to (.+):$/, "loginMethod"],
    [/^Enter (.+) account ID$/, "account"],
  ];
  for (const [pattern, key] of patterns) {
    const match = message.match(pattern);
    if (match) return translated(key, match[1]);
  }
  // Unknown provider diagnostics must remain intact rather than lose actionable details.
  return message;
}
