import type { UiLocale } from "./messages";
export const generationPreviewCopy = {
  en: {
    open: "Read completed scenes",
    ready: (n: number, total: number) => `${n} of ${total} scenes ready`,
    working: "The remaining scenes are being created.",
    unfinished: "More scenes are unfinished. Resume this task in Activity.",
    readOnly: "Saving favorites and timing edits becomes available when the lesson is complete.",
    activity: "View activity",
  },
  "zh-TW": {
    open: "閱讀已完成場景",
    ready: (n: number, total: number) => `${n}／${total} 個場景可閱讀`,
    working: "其餘場景仍在生成。",
    unfinished: "仍有場景未完成，可到活動列表續跑。",
    readOnly: "教材完成後即可收藏與調整時間。",
    activity: "查看活動",
  },
  "zh-CN": {
    open: "阅读已完成场景",
    ready: (n: number, total: number) => `${n}／${total} 个场景可阅读`,
    working: "其余场景仍在生成。",
    unfinished: "仍有场景未完成，可到活动列表继续。",
    readOnly: "教材完成后即可收藏与调整时间。",
    activity: "查看活动",
  },
  ja: {
    open: "完成したシーンを読む",
    ready: (n: number, total: number) => `${total} シーン中 ${n} シーンが閲覧可能`,
    working: "残りのシーンを作成しています。",
    unfinished: "未完成のシーンがあります。アクティビティから再開できます。",
    readOnly: "教材が完成すると、お気に入りへの保存と時間の調整ができます。",
    activity: "アクティビティを見る",
  },
  ko: {
    open: "완료된 장면 읽기",
    ready: (n: number, total: number) => `${total}개 중 ${n}개 장면을 읽을 수 있습니다`,
    working: "나머지 장면을 생성하고 있습니다.",
    unfinished: "미완료 장면이 있습니다. 활동에서 다시 시작하세요.",
    readOnly: "자료가 완성되면 즐겨찾기 저장과 시간 조정을 할 수 있습니다.",
    activity: "활동 보기",
  },
} satisfies Record<
  UiLocale,
  {
    open: string;
    ready: (n: number, total: number) => string;
    working: string;
    unfinished: string;
    readOnly: string;
    activity: string;
  }
>;
