import type { UiLocale } from "./messages";

/** Small, independent UI copy for metadata retrieval (no subtitle fetching). */
export const videoMetadataMessages: Record<
  UiLocale,
  {
    get: string;
    refresh: string;
    busy: string;
    buttonBusy: string;
    buttonSuccess: string;
    success: string;
    partial: string;
    unavailable: string;
    invalidSource: string;
    mismatch: string;
    confirmUnlinked: string;
    changed: string;
  }
> = {
  en: {
    get: "Get current video information",
    refresh: "Refresh video information",
    busy: "Detecting video information…",
    buttonBusy: "Updating…",
    buttonSuccess: "Updated",
    success: "Video information updated. Existing subtitles were not changed.",
    partial:
      "Video URL found, but the title is not available yet. Play the video and retry, or enter a title manually.",
    unavailable: "No supported video tab found. Open the YouTube or Netflix video, then retry.",
    invalidSource:
      "The entered source URL is not a supported watch URL. Correct it or clear it to detect the active video.",
    mismatch:
      "The current video differs from the source of these subtitles. Switch to the matching video before retrieving its information.",
    confirmUnlinked:
      "These subtitles do not have a matching video URL. Link the current video to them? The subtitles will not be changed.",
    changed: "The video tab changed while reading information. Retry on the intended video.",
  },
  "zh-TW": {
    get: "取得目前影片資訊",
    refresh: "重新偵測影片資訊",
    busy: "正在偵測影片資訊…",
    buttonBusy: "更新中…",
    buttonSuccess: "已更新",
    success: "已更新影片資訊，原有字幕不受影響。",
    partial: "已取得影片網址，但尚未取得標題。請播放影片後重試，或手動填寫標題。",
    unavailable: "找不到支援的影片分頁。請先開啟 YouTube 或 Netflix 影片再重試。",
    invalidSource: "目前填寫的來源網址不是支援的影片網址。請修正或清空網址，以偵測目前影片。",
    mismatch: "目前影片與既有字幕的來源不同。請切換到對應影片後再取得資訊。",
    confirmUnlinked: "這份字幕尚未設定影片來源。要將目前影片設為字幕來源嗎？既有字幕不會被修改。",
    changed: "取得資訊時影片分頁已切換，請回到目標影片後重試。",
  },
  "zh-CN": {
    get: "获取当前视频信息",
    refresh: "重新检测视频信息",
    busy: "正在检测视频信息…",
    buttonBusy: "更新中…",
    buttonSuccess: "已更新",
    success: "视频信息已更新，原有字幕不受影响。",
    partial: "已获取视频网址，但暂时无法获取标题。请播放视频后重试，或手动填写标题。",
    unavailable: "找不到支持的视频标签页。请先打开 YouTube 或 Netflix 视频后重试。",
    invalidSource: "当前填写的来源网址不是支持的视频网址。请修正或清空网址，以检测当前视频。",
    mismatch: "当前视频与已有字幕的来源不同。请切换到对应视频后再获取信息。",
    confirmUnlinked: "这份字幕尚未设置视频来源。要将当前视频设为字幕来源吗？已有字幕不会被修改。",
    changed: "获取信息时视频标签页已切换，请返回目标视频后重试。",
  },
  ja: {
    get: "現在の動画情報を取得",
    refresh: "動画情報を再取得",
    busy: "動画情報を取得中…",
    buttonBusy: "更新中…",
    buttonSuccess: "更新済み",
    success: "動画情報を更新しました。字幕は変更していません。",
    partial:
      "動画 URL は取得しましたが、タイトルがまだありません。再生後に再試行するか、手入力してください。",
    unavailable:
      "対応する動画タブが見つかりません。YouTube または Netflix の動画を開いて再試行してください。",
    invalidSource:
      "入力された URL は対応する動画 URL ではありません。修正するか消去して現在の動画を検出してください。",
    mismatch: "現在の動画は既存の字幕の元動画と異なります。元動画のタブに切り替えてください。",
    confirmUnlinked:
      "この字幕には元動画 URL がありません。現在の動画を元動画として設定しますか？字幕は変更しません。",
    changed: "情報の取得中に動画タブが切り替わりました。対象の動画で再試行してください。",
  },
  ko: {
    get: "현재 동영상 정보 가져오기",
    refresh: "동영상 정보 다시 감지",
    busy: "동영상 정보 확인 중…",
    buttonBusy: "업데이트 중…",
    buttonSuccess: "업데이트됨",
    success: "동영상 정보를 업데이트했습니다. 기존 자막은 변경하지 않았습니다.",
    partial:
      "동영상 URL을 가져왔지만 제목은 아직 없습니다. 재생 후 다시 시도하거나 제목을 직접 입력하세요.",
    unavailable:
      "지원되는 동영상 탭이 없습니다. YouTube 또는 Netflix 동영상을 열고 다시 시도하세요.",
    invalidSource:
      "입력한 출처 URL은 지원되는 동영상 URL이 아닙니다. 수정하거나 지운 후 현재 동영상을 감지하세요.",
    mismatch: "현재 동영상이 기존 자막의 출처와 다릅니다. 일치하는 동영상 탭으로 전환하세요.",
    confirmUnlinked:
      "이 자막에는 출처 동영상 URL이 없습니다. 현재 동영상을 연결할까요? 기존 자막은 변경하지 않습니다.",
    changed: "정보를 가져오는 동안 동영상 탭이 변경되었습니다. 대상 동영상에서 다시 시도하세요.",
  },
};
