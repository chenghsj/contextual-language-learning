import type { UiLocale } from "./messages";

export const subtitleAcquisition: Record<UiLocale, {
  button: string; busy: string; hint: string; success: string; manual: string;
  unavailable: string;
}> = {
  "en": {
    button: "Get subtitles from current video",
    busy: "Reading video subtitles…",
    hint: "Get available subtitles from the video you are watching. Netflix support depends on the active playback session and available subtitle tracks.",
    success: "Loaded {count} subtitle cues ({language}). Review the lesson settings and generate.",
    manual: "Other option: import your own subtitles",
    unavailable: "Open a supported video and start playback before fetching subtitles.",
  },
  "zh-TW": {
    button: "一鍵取得目前影片字幕",
    busy: "正在取得影片字幕…",
    hint: "從目前播放的影片讀取可用字幕。Netflix 是否能取得整集字幕，取決於目前播放工作階段與字幕軌。",
    success: "已取得 {count} 段字幕（{language}），確認教材設定後即可生成。",
    manual: "其他方式：匯入已有的字幕",
    unavailable: "請先開啟支援的影片並開始播放，再取得字幕。",
  },
  "zh-CN": {
    button: "一键获取当前视频字幕",
    busy: "正在获取视频字幕…",
    hint: "从当前播放的视频读取可用字幕。Netflix 能否获取整集字幕取决于当前播放会话和字幕轨。",
    success: "已获取 {count} 段字幕（{language}），确认教材设置后即可生成。",
    manual: "其他方式：导入已有字幕",
    unavailable: "请先打开支持的视频并开始播放，再获取字幕。",
  },
  "ja": {
    button: "現在の動画から字幕を取得",
    busy: "動画の字幕を取得中…",
    hint: "再生中の動画で利用可能な字幕を取得します。Netflix では再生セッションと字幕トラックによって取得できない場合があります。",
    success: "字幕 {count} 件（{language}）を取得しました。教材の設定を確認して生成してください。",
    manual: "別の方法：字幕ファイルを読み込む",
    unavailable: "対応する動画を開いて再生してから、字幕を取得してください。",
  },
  "ko": {
    button: "현재 동영상 자막 가져오기",
    busy: "동영상 자막을 가져오는 중…",
    hint: "재생 중인 동영상에서 제공되는 자막을 가져옵니다. Netflix에서는 재생 세션과 자막 트랙에 따라 전체 자막을 가져오지 못할 수 있습니다.",
    success: "자막 {count}개({language})를 가져왔습니다. 학습 설정을 확인한 뒤 생성하세요.",
    manual: "다른 방법: 기존 자막 가져오기",
    unavailable: "지원되는 동영상을 열고 재생한 후 자막을 가져오세요.",
  },
};

export function subtitleMessage(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match);
}
