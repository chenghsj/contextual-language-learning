import type { UiLocale } from "./messages";
const copy = {
  en: {
    title: "Siri voices",
    back: "Back to general settings",
    downloaded: "Downloaded",
    downloadable: "Available to download",
    language: "Voice language",
    allLanguages: "All languages",
    refresh: "Refresh Siri voices",
    noInstalledLanguage: "No Siri voices have been downloaded for this language.",
    alreadyDownloaded:
      "The resource is already downloaded, but this local service cannot resolve it for speech. Update the local service and refresh voices.",
    remove: "Delete downloaded resource",
    confirmRemove: "Delete resource",
    cancel: "Cancel",
    removeTitle: "Delete voice resource:",
    removeDescription:
      "This removes the selected voice's shared system resource. Siri and other apps may need to download it again. Continue?",
    removing: "Requesting resource removal from macOS…",
    removed:
      "The downloaded resource was removed. macOS may download it again if it is still in use.",
    removeFailed:
      "macOS did not confirm resource removal. The resource may still be installed; refresh to check.",
    removedRefreshFailed:
      "The resource was removed, but the voice list could not be refreshed. Check again.",
    removeUnavailable: "Resource removal is unavailable for this voice or local service.",
    manage: "Manage Siri voices",
    installedVoice: "Downloaded Siri voices",
    openFolder: "Open resource folder",
    previewUnavailable: "This voice is currently unavailable for preview.",
    folderFailed:
      "Could not locate or open this voice's folder. Refresh or update the local service.",
    noInstalled: "No downloaded Siri resources were found.",
    sharedResources:
      "These are system resources shared with Siri. Removing them affects other apps; macOS may require administrator permission and may download them again.",
    more: "Get more Siri voices",
    voice: "Downloadable Siri voice",
    download: "Download",
    loading: "Checking Siri voices…",
    requesting: "Requesting a voice download from macOS…",
    requested: "macOS is downloading this voice. The download continues if you leave this page.",
    installed: "Voice installed. It is now available for read aloud.",
    timedOut: "The voice is not ready yet. Refresh to check again; the download may continue.",
    unavailable: "Siri voice downloads are unavailable on this Mac or local service.",
    empty: "No additional Siri voices are available for this language.",
    failed: "Could not check or download the voice. Refresh and try again.",
    missingIdentity:
      "Update the local service to fix the Siri download component's missing identity.",
    rejected:
      "macOS rejected the voice download. Try again later or download it in System Settings.",
    requestTimedOut: "The macOS voice download service did not respond. Try again later.",
  },
  "zh-TW": {
    title: "Siri 聲音",
    back: "返回一般設定",
    downloaded: "已下載",
    downloadable: "可下載",
    language: "聲音語言",
    allLanguages: "所有語言",
    refresh: "重新整理 Siri 聲音",
    noInstalledLanguage: "此語言尚未下載 Siri 聲音。",
    alreadyDownloaded:
      "資源已下載，但本機服務尚無法辨識此聲音。請更新本機服務後重新整理聲音，不需再次下載。",
    remove: "刪除下載資源",
    confirmRemove: "刪除資源",
    cancel: "取消",
    removeTitle: "刪除語音資源：",
    removeDescription:
      "將移除此聲音的共用系統資源。Siri 與其他程式可能需要重新下載才能使用。確定要刪除嗎？",
    removing: "正在向 macOS 申請移除資源…",
    removed: "下載資源已移除；若仍有程式使用此聲音，macOS 可能再次下載。",
    removeFailed: "macOS 未確認移除資源，聲音可能仍已安裝，請重新查詢。",
    removedRefreshFailed: "資源已移除，但無法更新聲音清單，請重新查詢。",
    removeUnavailable: "此聲音或目前的本機服務不支援移除資源。",
    manage: "管理 Siri 聲音",
    installedVoice: "已下載的 Siri 聲音",
    openFolder: "開啟資源資料夾",
    previewUnavailable: "此聲音目前無法試聽。",
    folderFailed: "無法定位或開啟此聲音的資料夾，請重新查詢或更新本機服務。",
    noInstalled: "沒有查到已下載的 Siri 語音資源。",
    sharedResources:
      "這是與 Siri 共用的系統資源。刪除會影響其他程式；macOS 可能要求管理員權限，也可能再次下載。",
    more: "取得更多 Siri 聲音",
    voice: "可下載的 Siri 聲音",
    download: "下載",
    loading: "正在查詢 Siri 聲音…",
    requesting: "正在向 macOS 申請下載聲音…",
    requested: "macOS 正在下載此聲音；離開此頁後仍會繼續下載。",
    installed: "聲音已安裝，現在可以選擇朗讀。",
    timedOut: "聲音尚未就緒，請重新查詢；macOS 可能仍在下載。",
    unavailable: "這台 Mac 或目前的本機服務無法提供 Siri 聲音下載。",
    empty: "此語言沒有其他可下載的 Siri 聲音。",
    failed: "無法查詢或下載聲音，請重新查詢後再試。",
    missingIdentity: "Siri 下載元件缺少識別資訊，請更新本機服務後再試。",
    rejected: "macOS 拒絕下載聲音，請稍後重試，或到系統設定下載。",
    requestTimedOut: "macOS 的語音下載服務沒有回應，請稍後重試。",
  },
  "zh-CN": {
    title: "Siri 声音",
    back: "返回常规设置",
    downloaded: "已下载",
    downloadable: "可下载",
    language: "声音语言",
    allLanguages: "所有语言",
    refresh: "刷新 Siri 声音",
    noInstalledLanguage: "此语言尚未下载 Siri 声音。",
    alreadyDownloaded:
      "资源已下载，但本机服务尚无法识别此声音。请更新本机服务后刷新声音，无需再次下载。",
    remove: "删除下载资源",
    confirmRemove: "删除资源",
    cancel: "取消",
    removeTitle: "删除语音资源：",
    removeDescription:
      "将移除此声音的共用系统资源。Siri 与其他程序可能需要重新下载才能使用。确定要删除吗？",
    removing: "正在向 macOS 申请移除资源…",
    removed: "下载资源已移除；若仍有程序使用此声音，macOS 可能再次下载。",
    removeFailed: "macOS 未确认移除资源，声音可能仍已安装，请重新查询。",
    removedRefreshFailed: "资源已移除，但无法更新声音列表，请重新查询。",
    removeUnavailable: "此声音或当前本机服务不支持移除资源。",
    manage: "管理 Siri 声音",
    installedVoice: "已下载的 Siri 声音",
    openFolder: "打开资源文件夹",
    previewUnavailable: "此声音目前无法试听。",
    folderFailed: "无法定位或打开此声音的文件夹，请重新查询或更新本机服务。",
    noInstalled: "没有找到已下载的 Siri 语音资源。",
    sharedResources:
      "这是与 Siri 共用的系统资源。删除会影响其他程序；macOS 可能要求管理员权限，也可能再次下载。",
    more: "获取更多 Siri 声音",
    voice: "可下载的 Siri 声音",
    download: "下载",
    loading: "正在查询 Siri 声音…",
    requesting: "正在向 macOS 申请下载声音…",
    requested: "macOS 正在下载此声音；离开此页后仍会继续下载。",
    installed: "声音已安装，现在可以选择朗读。",
    timedOut: "声音尚未就绪，请重新查询；macOS 可能仍在下载。",
    unavailable: "这台 Mac 或当前本机服务无法提供 Siri 声音下载。",
    empty: "此语言没有其他可下载的 Siri 声音。",
    failed: "无法查询或下载声音，请重新查询后再试。",
    missingIdentity: "Siri 下载组件缺少标识信息，请更新本机服务后再试。",
    rejected: "macOS 拒绝下载声音，请稍后重试，或到系统设置下载。",
    requestTimedOut: "macOS 的语音下载服务没有响应，请稍后重试。",
  },
  ja: {
    title: "Siri 音声",
    back: "一般設定に戻る",
    downloaded: "ダウンロード済み",
    downloadable: "ダウンロード可能",
    language: "音声の言語",
    allLanguages: "すべての言語",
    refresh: "Siri 音声を更新",
    noInstalledLanguage: "この言語の Siri 音声はまだダウンロードされていません。",
    alreadyDownloaded:
      "リソースはダウンロード済みですが、ローカルサービスが音声を認識できません。サービスを更新して音声を再確認してください。再ダウンロードは不要です。",
    remove: "ダウンロード済みリソースを削除",
    confirmRemove: "リソースを削除",
    cancel: "キャンセル",
    removeTitle: "音声リソースを削除：",
    removeDescription:
      "選択した音声の共有システムリソースを削除します。Siri や他のアプリで使うには再ダウンロードが必要な場合があります。続けますか？",
    removing: "macOS にリソースの削除を要求中…",
    removed: "リソースを削除しました。利用中の場合、macOS が再ダウンロードすることがあります。",
    removeFailed:
      "macOS による削除を確認できません。音声が残っている場合があります。再確認してください。",
    removedRefreshFailed:
      "リソースを削除しましたが、音声一覧を更新できません。再確認してください。",
    removeUnavailable: "この音声またはローカルサービスではリソースを削除できません。",
    manage: "Siri 音声を管理",
    installedVoice: "ダウンロード済みの Siri 音声",
    openFolder: "リソースフォルダを開く",
    previewUnavailable: "この音声は現在試聴できません。",
    folderFailed:
      "音声のフォルダを特定または開けません。再確認するかローカルサービスを更新してください。",
    noInstalled: "ダウンロード済みの Siri リソースが見つかりません。",
    sharedResources:
      "Siri と共有するシステムリソースです。削除は他のアプリにも影響します。管理者権限が必要な場合や、macOS が再ダウンロードする場合があります。",
    more: "Siri 音声を追加",
    voice: "ダウンロード可能な Siri 音声",
    download: "ダウンロード",
    loading: "Siri 音声を確認中…",
    requesting: "macOS に音声のダウンロードを要求中…",
    requested: "macOS が音声をダウンロード中です。このページを離れてもダウンロードは続きます。",
    installed: "音声がインストールされ、読み上げに利用できます。",
    timedOut: "音声はまだ準備中です。再確認してください。ダウンロードは続く場合があります。",
    unavailable: "この Mac またはローカルサービスでは Siri 音声をダウンロードできません。",
    empty: "この言語で追加できる Siri 音声はありません。",
    failed: "音声の確認またはダウンロードに失敗しました。再確認してください。",
    missingIdentity:
      "Siri ダウンロード機能の識別情報がありません。ローカルサービスを更新してください。",
    rejected:
      "macOS がダウンロードを拒否しました。後で再試行するか、システム設定でダウンロードしてください。",
    requestTimedOut: "macOS の音声ダウンロードサービスが応答しません。後で再試行してください。",
  },
  ko: {
    title: "Siri 음성",
    back: "일반 설정으로 돌아가기",
    downloaded: "다운로드됨",
    downloadable: "다운로드 가능",
    language: "음성 언어",
    allLanguages: "모든 언어",
    refresh: "Siri 음성 새로고침",
    noInstalledLanguage: "이 언어의 Siri 음성을 아직 다운로드하지 않았습니다.",
    alreadyDownloaded:
      "리소스는 이미 다운로드되었지만 로컬 서비스에서 음성을 인식하지 못합니다. 로컬 서비스를 업데이트하고 음성을 새로고침하세요. 다시 다운로드할 필요가 없습니다.",
    remove: "다운로드한 리소스 삭제",
    confirmRemove: "리소스 삭제",
    cancel: "취소",
    removeTitle: "음성 리소스 삭제:",
    removeDescription:
      "선택한 음성의 공유 시스템 리소스를 삭제합니다. Siri와 다른 앱에서 사용하려면 다시 다운로드해야 할 수 있습니다. 계속할까요?",
    removing: "macOS에 리소스 삭제 요청 중…",
    removed: "리소스를 삭제했습니다. 아직 사용 중이라면 macOS가 다시 다운로드할 수 있습니다.",
    removeFailed: "macOS의 삭제를 확인하지 못했습니다. 음성이 남아 있을 수 있으니 다시 확인하세요.",
    removedRefreshFailed:
      "리소스를 삭제했지만 음성 목록을 새로고침하지 못했습니다. 다시 확인하세요.",
    removeUnavailable: "이 음성 또는 로컬 서비스에서는 리소스를 삭제할 수 없습니다.",
    manage: "Siri 음성 관리",
    installedVoice: "다운로드한 Siri 음성",
    openFolder: "리소스 폴더 열기",
    previewUnavailable: "현재 이 음성을 미리 들을 수 없습니다.",
    folderFailed:
      "음성 폴더를 찾거나 열 수 없습니다. 다시 확인하거나 로컬 서비스를 업데이트하세요.",
    noInstalled: "다운로드한 Siri 리소스를 찾지 못했습니다.",
    sharedResources:
      "Siri와 공유하는 시스템 리소스입니다. 삭제하면 다른 앱에도 영향을 줍니다. 관리자 권한이 필요하거나 macOS가 다시 다운로드할 수 있습니다.",
    more: "Siri 음성 추가",
    voice: "다운로드 가능한 Siri 음성",
    download: "다운로드",
    loading: "Siri 음성 확인 중…",
    requesting: "macOS에 음성 다운로드 요청 중…",
    requested: "macOS에서 음성을 다운로드 중입니다. 이 페이지를 나가도 다운로드는 계속됩니다.",
    installed: "음성이 설치되어 읽어주기에 사용할 수 있습니다.",
    timedOut: "음성이 아직 준비되지 않았습니다. 다시 확인하세요. 다운로드는 계속될 수 있습니다.",
    unavailable: "이 Mac 또는 로컬 서비스에서 Siri 음성을 다운로드할 수 없습니다.",
    empty: "이 언어에 추가할 수 있는 Siri 음성이 없습니다.",
    failed: "음성을 확인하거나 다운로드하지 못했습니다. 다시 확인하세요.",
    missingIdentity:
      "Siri 다운로드 구성 요소의 식별 정보가 없습니다. 로컬 서비스를 업데이트하세요.",
    rejected:
      "macOS에서 다운로드를 거부했습니다. 나중에 다시 시도하거나 시스템 설정에서 다운로드하세요.",
    requestTimedOut: "macOS 음성 다운로드 서비스가 응답하지 않습니다. 나중에 다시 시도하세요.",
  },
} satisfies Record<UiLocale, Record<string, string>>;
export const speechDownloadCopy = (locale: UiLocale) => copy[locale];
export function speechVoiceLanguageName(language: string, locale: UiLocale): string {
  try {
    const parsed = new Intl.Locale(language);
    const name = new Intl.DisplayNames(locale, { type: "language" }).of(parsed.language);
    const region =
      parsed.region && new Intl.DisplayNames(locale, { type: "region" }).of(parsed.region);
    const suffix = region
      ? locale.startsWith("zh") || locale === "ja"
        ? `（${region}）`
        : ` (${region})`
      : "";
    return name ? name + suffix : language;
  } catch {
    return language;
  }
}
export function speechDownloadError(error: unknown): keyof typeof copy.en {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("SIRI_RESOURCE_ALREADY_DOWNLOADED")) return "alreadyDownloaded";
  if (message.startsWith("SIRI_DOWNLOAD_MISSING_CLIENT_IDENTITY")) return "missingIdentity";
  if (message.startsWith("SIRI_DOWNLOAD_REQUEST_TIMED_OUT")) return "requestTimedOut";
  if (message.startsWith("SIRI_DOWNLOAD_REJECTED")) return "rejected";
  return "failed";
}
