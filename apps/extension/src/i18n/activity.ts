import type { UiLocale } from "./messages";

export const activityCopy = {
  en: {
    addToQueue: "Add to queue",
    addedToQueue: "Added to queue",
    viewActivity: "View activity",
    runningCount: "{count} running",
    queuedCount: "{count} queued",
    inProgress: "In progress",
    history: "History",
  },
  "zh-TW": {
    addToQueue: "加入佇列",
    addedToQueue: "已加入佇列",
    viewActivity: "查看活動",
    runningCount: "{count} 筆生成中",
    queuedCount: "{count} 筆等待中",
    inProgress: "進行中",
    history: "紀錄",
  },
  "zh-CN": {
    addToQueue: "加入队列",
    addedToQueue: "已加入队列",
    viewActivity: "查看活动",
    runningCount: "{count} 项生成中",
    queuedCount: "{count} 项等待中",
    inProgress: "进行中",
    history: "记录",
  },
  ja: {
    addToQueue: "キューに追加",
    addedToQueue: "キューに追加しました",
    viewActivity: "アクティビティを見る",
    runningCount: "{count} 件を生成中",
    queuedCount: "{count} 件が待機中",
    inProgress: "進行中",
    history: "履歴",
  },
  ko: {
    addToQueue: "대기열에 추가",
    addedToQueue: "대기열에 추가했습니다",
    viewActivity: "활동 보기",
    runningCount: "{count}개 생성 중",
    queuedCount: "{count}개 대기 중",
    inProgress: "진행 중",
    history: "기록",
  },
} satisfies Record<UiLocale, Record<string, string>>;
