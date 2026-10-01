import { messages, type UiLocale } from "./messages";
import { piCopy } from "./pi";
import { piAuthMessage } from "./pi-auth";
import { contextualReaderMessages } from "./contextual-reader";
import { needsVideoReaderReload } from "../video/reader-health";

const copy = {
  details: ["Technical details", "查看詳細資訊", "查看详细信息", "詳細情報", "상세 정보 보기"],
  videoReload: ["Unable to connect to the video tab. Refresh that video tab, then try again.", "無法連接影片分頁。請重新整理正在播放影片的分頁，再回來重試。", "无法连接视频标签页。请刷新正在播放视频的标签页，再回来重试。", "動画タブに接続できません。再生中の動画タブを再読み込みしてから、もう一度お試しください。", "동영상 탭에 연결할 수 없습니다. 재생 중인 동영상 탭을 새로고침한 후 다시 시도하세요."],
  event: ["The AI service sent an update. See the original details below.", "AI 服務傳回新訊息，請查看下方原始資訊。", "AI 服务返回新消息，请查看下方原始信息。", "AI サービスから通知が届きました。以下の元の情報をご確認ください。", "AI 서비스에서 알림을 보냈습니다. 아래 원본 정보를 확인하세요."],
  prompt: ["Follow the service instructions below to continue sign-in.", "請依下方服務商指示繼續登入。", "请按下方服务商指示继续登录。", "以下のサービスの指示に従ってログインを続けてください。", "아래 서비스 안내에 따라 로그인을 계속하세요."],
  option: ["Option: {value}", "選項：{value}", "选项：{value}", "選択肢：{value}", "옵션: {value}"],
  error: ["Unable to complete this action. Try again; if it still fails, check the details below.", "無法完成這個操作，請再試一次。若仍失敗，可展開下方資訊查看原因。", "无法完成此操作，请重试。若仍失败，可展开下方信息查看原因。", "リクエストが失敗しました。技術情報を確認して再試行してください。", "요청이 실패했습니다. 기술 정보를 확인하고 다시 시도하세요."],
  models: ["Unable to load AI models. Check the service connection and refresh.", "無法載入 AI 模型。請檢查服務連線並重新整理。", "无法加载 AI 模型。请检查服务连接并刷新。", "AI モデルを読み込めません。サービス接続を確認して更新してください。", "AI 모델을 불러올 수 없습니다. 서비스 연결을 확인하고 새로고침하세요."],
  generation: ["Lesson generation failed. Retry from the saved checkpoint in task history.", "教材生成失敗。請從任務歷史的已存進度重試。", "教材生成失败。请从任务历史的已存进度重试。", "教材生成が失敗しました。タスク履歴の保存済みチェックポイントから再試行してください。", "교재 생성에 실패했습니다. 작업 기록의 저장된 체크포인트에서 다시 시도하세요."],
  auth: ["Authorization failed or expired. Reconnect the AI service and retry.", "授權失敗或已過期。請重新連接 AI 服務後重試。", "授权失败或已过期。请重新连接 AI 服务后重试。", "認証に失敗したか期限が切れています。AI サービスに再接続して再試行してください。", "인증에 실패했거나 만료되었습니다. AI 서비스에 다시 연결하고 재시도하세요."],
  denied: ["Sign-in was denied. Restart sign-in and approve access.", "登入授權遭拒。請重新登入並允許存取。", "登录授权被拒。请重新登录并允许访问。", "ログインが拒否されました。再度ログインしてアクセスを許可してください。", "로그인이 거부되었습니다. 다시 로그인하고 접근을 허용하세요."],
  expired: ["The sign-in code expired. Restart sign-in to get a new code.", "登入驗證碼已過期。請重新登入以取得新驗證碼。", "登录验证码已过期。请重新登录以获取新验证码。", "ログインコードの期限が切れました。再度ログインして新しいコードを取得してください。", "로그인 코드가 만료되었습니다. 다시 로그인하여 새 코드를 받으세요."],
  rate: ["The AI service is rate limited. Wait a moment and retry.", "AI 服務請求過於頻繁。請稍候再試。", "AI 服务请求过于频繁。请稍后重试。", "AI サービスのリクエスト制限に達しました。少し待って再試行してください。", "AI 서비스 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요."],
  quota: ["The AI service quota is exhausted. Check your provider account and billing.", "AI 服務額度已用盡。請檢查服務商帳號與帳務。", "AI 服务额度已用尽。请检查服务商账号与账务。", "AI サービスの利用枠を使い切りました。アカウントと請求設定を確認してください。", "AI 서비스 할당량을 모두 사용했습니다. 계정과 결제 설정을 확인하세요."],
  network: ["Unable to reach the AI service. Check your network and retry.", "無法連線至 AI 服務。請檢查網路後重試。", "无法连接至 AI 服务。请检查网络后重试。", "AI サービスに接続できません。ネットワークを確認して再試行してください。", "AI 서비스에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요."],
  connect: ["Connect this AI provider in settings before generating.", "請先到設定連接此 AI 服務，再生成教材。", "请先到设置连接此 AI 服务，再生成教材。", "教材生成の前に設定でこの AI サービスに接続してください。", "교재를 생성하기 전에 설정에서 이 AI 서비스에 연결하세요."],
  modelUnavailable: ["The selected model is unavailable. Refresh the provider and choose a model.", "所選模型無法使用。請重新整理服務並選擇模型。", "所选模型不可用。请刷新服务并选择模型。", "選択したモデルは利用できません。サービスを更新してモデルを選択してください。", "선택한 모델을 사용할 수 없습니다. 서비스를 새로고침하고 모델을 선택하세요."],
  output: ["AI returned invalid, empty or oversized lesson output. Retry this stage from task history.", "AI 回傳的教材格式無效、內容空白或過大。請從任務歷史重試此階段。", "AI 返回的教材格式无效、内容为空或过大。请从任务历史重试此阶段。", "AI の教材出力が無効、空、または大きすぎます。タスク履歴からこの段階を再試行してください。", "AI 교재 출력 형식이 잘못되었거나 비어 있거나 너무 큽니다. 작업 기록에서 이 단계를 다시 시도하세요."],
  host: ["The local service connection failed. Check or update the local service, then retry.", "本機服務連線失敗。請檢查或更新本機服務後重試。", "本机服务连接失败。请检查或更新本机服务后重试。", "ローカルサービスへの接続に失敗しました。確認または更新して再試行してください。", "로컬 서비스 연결에 실패했습니다. 로컬 서비스를 확인하거나 업데이트하고 다시 시도하세요."],
  busy: ["An AI job is already running. Check task history before starting another.", "已有 AI 任務執行中。請先檢查任務歷史。", "已有 AI 任务正在运行。请先检查任务历史。", "AI タスクは既に実行中です。新しく開始する前にタスク履歴を確認してください。", "AI 작업이 이미 실행 중입니다. 새 작업을 시작하기 전에 작업 기록을 확인하세요."],
} as const;
const indexes: Record<UiLocale, number> = { en: 0, "zh-TW": 1, "zh-CN": 2, ja: 3, ko: 4 };
export type PiFeedbackContext = "event" | "prompt" | "option" | "error" | "models" | "generation";
export function piFeedbackCopy(locale: UiLocale, key: keyof typeof copy): string {
  return copy[key][indexes[locale]];
}

// Application-owned messages are already localized. Recognize their templates
// as well so switching locale also updates pending feedback without a new request.
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = [messages, piCopy].flatMap(catalog =>
  Object.values(catalog).flatMap(strings => Object.entries(strings as Record<string, string>).map(([key, value]) => {
    const names: string[] = [];
    const parts = value.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/);
    const pattern = parts.map(part => {
      if (/^\{[a-zA-Z][a-zA-Z0-9]*\}$/.test(part)) { names.push(part.slice(1, -1)); return "([\\s\\S]*?)"; }
      return escape(part);
    }).join("");
    return { catalog, key, names, pattern: new RegExp("^" + pattern + "$") };
  }))).sort((a, b) => b.pattern.source.length - a.pattern.source.length);
function localizedAppMessage(locale: UiLocale, message: string): { message: string; detail?: string } | undefined {
  for (const { catalog, key, names, pattern } of templates) {
    const match = message.match(pattern);
    if (!match) continue;
    const target = (catalog[locale] as Record<string, string>)[key];
    let detail: string | undefined;
    const result = target.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name: string) => {
      const index = names.indexOf(name);
      if (index < 0) return token;
      const value = match[index + 1];
      if (name === "status") return localizedAppMessage(locale, value)?.message ?? value;
      if (["message", "error"].includes(name) && value && value !== message) {
        const nested = piFeedback(locale, value);
        detail = nested.detail;
        return nested.message;
      }
      return value;
    });
    return { message: result, ...(detail ? { detail } : {}) };
  }
}

/** Every SDK message gets UI-language feedback; arbitrary remote text is kept
 * as diagnostic detail, never mistaken for translatable product copy. */
export function piFeedback(locale: UiLocale, raw: string, context: PiFeedbackContext = "error"): { message: string; detail?: string } {
  if (!raw) return { message: "" };
  if (/^(?:Error: )?This operation was aborted\.?$/.test(raw)) {
    return { message: messages[locale][context === "generation" ? "generationCancelled" : "jobCancelled"] };
  }
  if (Object.values(contextualReaderMessages).some(value => value.reloadRequired === raw)) {
    return { message: contextualReaderMessages[locale].reloadRequired };
  }
  if (needsVideoReaderReload(raw)) return { message: piFeedbackCopy(locale, "videoReload") };
  const app = localizedAppMessage(locale, raw);
  if (app !== undefined) return app;
  // Probe a different language even for English to distinguish recognized SDK copy.
  const translated = piAuthMessage(locale === "en" ? "zh-TW" : locale, raw.replace(/^Error: /, ""));
  if (translated !== raw.replace(/^Error: /, "")) return { message: locale === "en" ? raw.replace(/^Error: /, "") : translated,
    ...(/^(?:Could not listen on |Invalid callback \()|timed out after/s.test(raw) ? { detail: raw } : {}) };
  let key: keyof typeof copy = context;
  if (context === "error" || context === "models" || context === "generation") {
    const text = raw.replace(/^Error: /, "");
    if (text === "Connect this AI provider in settings before generating.") key = "connect";
    else if (text === "The selected model is unavailable. Refresh the provider and choose a model.") key = "modelUnavailable";
    else if (/invalid lesson JSON|empty or oversized lesson output/.test(text)) key = "output";
    else if (/old CLI Agent|CLI account directories/.test(text)) return { message: piCopy[locale].legacy, detail: raw };
    else if (/quota|insufficient_quota|billing|credit balance/i.test(text)) key = "quota";
    else if (/\b429\b|rate.?limit|too many requests/i.test(text)) key = "rate";
    else if (/device.*expired/i.test(text)) key = "expired";
    else if (/denied|access_denied/i.test(text)) key = "denied";
    else if (/\b401\b|unauthorized|invalid.?api.?key|authorization failed|token.*(?:failed|expired)|authentication/i.test(text)) key = "auth";
    else if (/fetch failed|ECONN|ENOTFOUND|network|socket/i.test(text)) key = "network";
    else if (/Native Host|native messaging|background Agent connection|invalid.*(?:response|job data)|local AI installation ID/i.test(text)) key = "host";
    else if (/job is already running/.test(text)) key = "busy";
  }
  const message = piFeedbackCopy(locale, key).replace("{value}", () => raw);
  return { message, ...(context === "option" ? {} : { detail: raw }) };
}
