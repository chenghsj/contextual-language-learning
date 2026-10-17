import type { UiLocale } from "./messages";

export const motionCopy = {
  en: {
    label: "Reduce motion",
    hint: "Reduce animations across all pages.",
  },
  "zh-TW": {
    label: "減少動態效果",
    hint: "減少所有頁面的過場與非必要動畫。",
  },
  "zh-CN": {
    label: "减少动态效果",
    hint: "减少所有页面的过渡与非必要动画。",
  },
  ja: {
    label: "動きを減らす",
    hint: "すべてのページで画面切り替えや不要なアニメーションを減らします。",
  },
  ko: {
    label: "동작 줄이기",
    hint: "모든 페이지에서 화면 전환과 불필요한 애니메이션을 줄입니다.",
  },
} satisfies Record<UiLocale, Record<string, string>>;
