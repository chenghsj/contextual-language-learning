import type { UiLocale } from "./messages";

export const generationProgressCopy = {
  "zh-TW": {
    states: { waiting: "等待回應", thinking: "推理中", writing: "輸出中", retrying: "等待重試" },
    active: (n: number) => `${n} 個分析片段執行中`,
    activity: (part: string | undefined, state: string, seconds: number) =>
      `${part ? `分析片段 ${part} · ` : ""}${state} · 已耗時 ${seconds} 秒`,
    completed: (n: number) => `已完成 ${n} 個生成步驟`,
    ready: "教材已完成",
  },
  "zh-CN": {
    states: { waiting: "等待响应", thinking: "推理中", writing: "输出中", retrying: "等待重试" },
    active: (n: number) => `${n} 个分析片段运行中`,
    activity: (part: string | undefined, state: string, seconds: number) =>
      `${part ? `分析片段 ${part} · ` : ""}${state} · 已耗时 ${seconds} 秒`,
    completed: (n: number) => `已完成 ${n} 个生成步骤`,
    ready: "教材已完成",
  },
  en: {
    states: {
      waiting: "Waiting for response",
      thinking: "Thinking",
      writing: "Writing",
      retrying: "Waiting to retry",
    },
    active: (n: number) => `${n} analysis segments active`,
    activity: (part: string | undefined, state: string, seconds: number) =>
      `${part ? `Analysis segment ${part} · ` : ""}${state} · ${seconds}s elapsed`,
    completed: (n: number) => `${n} generation steps completed`,
    ready: "Lesson completed",
  },
  ja: {
    states: { waiting: "応答待ち", thinking: "推論中", writing: "出力中", retrying: "再試行待ち" },
    active: (n: number) => `${n} 件の分析区間を実行中`,
    activity: (part: string | undefined, state: string, seconds: number) =>
      `${part ? `分析区間 ${part} · ` : ""}${state} · 経過 ${seconds} 秒`,
    completed: (n: number) => `生成ステップ ${n} 件完了`,
    ready: "教材が完成しました",
  },
  ko: {
    states: {
      waiting: "응답 대기",
      thinking: "추론 중",
      writing: "출력 중",
      retrying: "재시도 대기",
    },
    active: (n: number) => `${n}개 분석 구간 실행 중`,
    activity: (part: string | undefined, state: string, seconds: number) =>
      `${part ? `분석 구간 ${part} · ` : ""}${state} · ${seconds}초 경과`,
    completed: (n: number) => `생성 단계 ${n}개 완료`,
    ready: "학습 자료 완성",
  },
} satisfies Record<
  UiLocale,
  {
    completed: (n: number) => string;
    ready: string;
    states: Record<import("@contextual/core").GenerationActivity["state"], string>;
    active: (n: number) => string;
    activity: (part: string | undefined, state: string, seconds: number) => string;
  }
>;
