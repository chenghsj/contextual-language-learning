import type { UiLocale } from "./messages";

const en = {
  repeat: "Repeat count",
  delay: "Pause between loops",
  loopRangeSaved: "Loop range saved. Restart the loop to use the new range.",
  loopRangeReset: "Restored subtitle timing.",
  invalidLoopRange: "A must precede B by at least 0.25s; a loop cannot exceed 10 minutes.",
  positionUnavailable: "Cannot read the current video position. Open the original video first.",
};

export const playbackTimingMessages: Record<UiLocale, typeof en> = {
  en,
  "zh-TW": {
    repeat: "循環次數", delay: "每次循環間隔",
    loopRangeSaved: "循環區間已儲存；請重新開始循環。",
    loopRangeReset: "已恢復字幕預設時間。",
    invalidLoopRange: "A 必須早於 B 至少 0.25 秒，且循環不得超過 10 分鐘。",
    positionUnavailable: "無法讀取影片目前位置，請先開啟原影片。",
  },
  "zh-CN": {
    repeat: "循环次数", delay: "每次循环间隔",
    loopRangeSaved: "循环区间已保存；请重新开始循环。",
    loopRangeReset: "已恢复字幕默认时间。",
    invalidLoopRange: "A 必须至少早于 B 0.25 秒，循环不得超过 10 分钟。",
    positionUnavailable: "无法读取视频当前位置，请先打开原视频。",
  },
  ja: {
    repeat: "リピート回数", delay: "リピート間隔",
    loopRangeSaved: "範囲を保存しました。再度リピートを開始してください。",
    loopRangeReset: "字幕の時間に戻しました。",
    invalidLoopRange: "A と B の間は 0.25 秒以上、リピートの長さは 10 分以内にしてください。",
    positionUnavailable: "現在の再生位置を取得できません。元の動画を開いてください。",
  },
  ko: {
    repeat: "반복 횟수", delay: "반복 간격",
    loopRangeSaved: "반복 구간을 저장했습니다. 반복을 다시 시작하세요.",
    loopRangeReset: "자막 시간으로 복원했습니다.",
    invalidLoopRange: "A와 B는 최소 0.25초 간격이어야 하며 반복은 10분을 넘을 수 없습니다.",
    positionUnavailable: "현재 재생 위치를 가져올 수 없습니다. 원본 영상을 먼저 여세요.",
  },
};
