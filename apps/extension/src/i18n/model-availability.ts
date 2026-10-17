import type { UiLocale } from "./messages";
export const modelAvailabilityCopy: Record<
  UiLocale,
  {
    listed: string;
    unknown: string;
    unavailable: string;
  }
> = {
  en: {
    listed: "The service currently lists this model. Capacity and quota may still limit requests.",
    unknown: "This model’s availability has not been confirmed. Refresh the model list to check.",
    unavailable: "Unavailable",
  },
  "zh-TW": {
    listed: "服務商目前提供此模型。實際請求仍可能受容量或額度限制。",
    unknown: "尚未確認此模型能否使用。請重新整理模型清單確認。",
    unavailable: "不可用",
  },
  "zh-CN": {
    listed: "服务商目前提供此模型。实际请求仍可能受容量或额度限制。",
    unknown: "尚未确认此模型能否使用。请刷新模型列表确认。",
    unavailable: "不可用",
  },
  ja: {
    listed:
      "サービスは現在このモデルを提供しています。容量や利用枠によりリクエストが制限される場合があります。",
    unknown: "このモデルの利用可否は未確認です。モデル一覧を更新してください。",
    unavailable: "利用不可",
  },
  ko: {
    listed: "서비스가 현재 이 모델을 제공합니다. 용량이나 할당량에 따라 요청이 제한될 수 있습니다.",
    unknown: "이 모델의 사용 가능 여부를 아직 확인하지 못했습니다. 모델 목록을 새로고침하세요.",
    unavailable: "사용 불가",
  },
};
