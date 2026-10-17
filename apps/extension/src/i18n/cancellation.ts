import type { UiLocale } from "./messages";
export const cancellationCopy: Record<
  UiLocale,
  {
    pending: string;
    unconfirmed: string;
    pendingLabel: string;
    unconfirmedLabel: string;
    retry: string;
  }
> = {
  en: {
    pending: "Cancelling… Waiting for the local service to stop AI execution.",
    unconfirmed: "Cancellation is not confirmed. Check the local connection and retry.",
    pendingLabel: "Cancelling…",
    unconfirmedLabel: "Cancellation unconfirmed",
    retry: "Retry cancellation",
  },
  "zh-TW": {
    pending: "取消中，等待本機服務停止 AI 執行。",
    unconfirmed: "取消尚未確認。請確認本機連線後重試。",
    pendingLabel: "取消中…",
    unconfirmedLabel: "取消未確認",
    retry: "重試取消",
  },
  "zh-CN": {
    pending: "取消中，等待本机服务停止 AI 执行。",
    unconfirmed: "取消尚未确认。请确认本机连接后重试。",
    pendingLabel: "取消中…",
    unconfirmedLabel: "取消未确认",
    retry: "重试取消",
  },
  ja: {
    pending: "キャンセル中です。ローカルサービスが AI の実行を停止するまでお待ちください。",
    unconfirmed: "キャンセルを確認できません。ローカル接続を確認して再試行してください。",
    pendingLabel: "キャンセル中…",
    unconfirmedLabel: "キャンセル未確認",
    retry: "キャンセルを再試行",
  },
  ko: {
    pending: "취소 중입니다. 로컬 서비스가 AI 실행을 중지할 때까지 기다려 주세요.",
    unconfirmed: "취소가 확인되지 않았습니다. 로컬 연결을 확인하고 다시 시도하세요.",
    pendingLabel: "취소 중…",
    unconfirmedLabel: "취소 미확인",
    retry: "취소 다시 시도",
  },
};
