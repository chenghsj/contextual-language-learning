import type { UiLocale } from "./messages";

type Copy = {
  dragHint: string;
  step: string;
  duration: (seconds: string) => string;
  title: string;
  fitRange: string;
  outsideHint: string;
};
export const timingControlsCopy: Record<UiLocale, Copy> = {
  en: {
    title: "Edit subtitle",
    fitRange: "Fit range",
    outsideHint: "The selection is outside the timeline. Use Fit range to show it.",
    dragHint: "Drag either end to adjust. Click the timeline to seek.",
    step: "Fine-tune by 0.1s · Shift + arrow keys: 1s",
    duration: seconds => `${seconds}s selected`,
  },
  "zh-TW": {
    title: "修改字幕",
    fitRange: "顯示範圍",
    outsideHint: "範圍超出時間軸，按「顯示範圍」重新置中。",
    dragHint: "拖曳兩端調整範圍，點時間軸定位。",
    step: "微調 0.1 秒 · Shift + 方向鍵調整 1 秒",
    duration: seconds => `長度 ${seconds} 秒`,
  },
  "zh-CN": {
    title: "修改字幕",
    fitRange: "显示范围",
    outsideHint: "范围超出时间轴，点击「显示范围」重新居中。",
    dragHint: "拖动两端调整范围，点击时间轴定位。",
    step: "微调 0.1 秒 · Shift + 方向键调整 1 秒",
    duration: seconds => `长度 ${seconds} 秒`,
  },
  ja: {
    title: "字幕を編集",
    fitRange: "範囲を表示",
    outsideHint: "選択範囲が時間軸の外にあります。「範囲を表示」で表示できます。",
    dragHint: "両端をドラッグして調整。時間軸をクリックして移動。",
    step: "0.1秒ずつ調整 · Shift + 矢印キーで1秒",
    duration: seconds => `長さ ${seconds} 秒`,
  },
  ko: {
    title: "자막 편집",
    fitRange: "구간 맞추기",
    outsideHint: "선택 구간이 시간 축 밖에 있습니다. 구간 맞추기를 누르세요.",
    dragHint: "양 끝을 끌어 조정하고 시간 축을 눌러 이동하세요.",
    step: "0.1초씩 조정 · Shift + 방향키: 1초",
    duration: seconds => `길이 ${seconds}초`,
  },
};
