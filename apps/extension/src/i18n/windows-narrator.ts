import type { UiLocale } from "./messages";

const copy = {
  en: {
    title: "Windows Narrator natural voices",
    experimental: "Experimental",
    hint: "Uses local Narrator natural voices through NaturalVoiceSAPIAdapter. System or voice updates may stop this integration from working.",
    setup:
      "Requires a compatible adapter and local voice package. Current Microsoft Store voice packages may be incompatible. Disable the adapter's Edge and Azure online voices to keep voice discovery offline, then refresh voices here.",
    help: "Setup and compatibility",
    empty: "No compatible local Narrator natural voice was found for this language.",
    failed:
      "Experimental Narrator playback failed. Check voice-package compatibility and audio output, then refresh voices.",
  },
  "zh-TW": {
    title: "Windows Narrator 自然語音",
    experimental: "實驗性",
    hint: "透過 NaturalVoiceSAPIAdapter 使用本機 Narrator 自然語音。系統或聲音更新後可能失效。",
    setup:
      "需要相容的橋接元件與本機聲音套件；目前 Microsoft Store 的聲音套件可能不相容。請關閉橋接元件的 Edge 與 Azure 線上聲音，讓聲音查詢也維持離線，再回此處重新整理。",
    help: "設定與相容性說明",
    empty: "尚未偵測到此語言相容的本機 Narrator 自然語音。",
    failed: "實驗性 Narrator 朗讀失敗，請確認聲音套件相容性與音訊輸出，再重新整理聲音。",
  },
  "zh-CN": {
    title: "Windows Narrator 自然语音",
    experimental: "实验性",
    hint: "通过 NaturalVoiceSAPIAdapter 使用本机 Narrator 自然语音。系统或声音更新后可能失效。",
    setup:
      "需要兼容的桥接组件与本机声音包；目前 Microsoft Store 的声音包可能不兼容。请关闭桥接组件的 Edge 与 Azure 在线声音，让声音查询也保持离线，再回此处刷新。",
    help: "设置与兼容性说明",
    empty: "尚未检测到此语言兼容的本机 Narrator 自然语音。",
    failed: "实验性 Narrator 朗读失败，请确认声音包兼容性与音频输出，再刷新声音。",
  },
  ja: {
    title: "Windows Narrator の自然な音声",
    experimental: "試験的",
    hint: "NaturalVoiceSAPIAdapter を介してローカルの Narrator 音声を使います。システムや音声の更新後に動作しなくなる場合があります。",
    setup:
      "互換性のあるアダプターとローカル音声パッケージが必要です。現在の Microsoft Store の音声は非対応の場合があります。音声検索もオフラインに保つには、アダプターの Edge と Azure オンライン音声を無効にしてから音声を更新してください。",
    help: "設定と互換性について",
    empty: "この言語に対応するローカルの Narrator 自然音声が見つかりません。",
    failed:
      "試験的な Narrator の再生に失敗しました。音声パッケージの互換性と音声出力を確認し、音声を更新してください。",
  },
  ko: {
    title: "Windows Narrator 자연 음성",
    experimental: "실험적",
    hint: "NaturalVoiceSAPIAdapter를 통해 로컬 Narrator 자연 음성을 사용합니다. 시스템이나 음성 업데이트 후 작동하지 않을 수 있습니다.",
    setup:
      "호환되는 어댑터와 로컬 음성 패키지가 필요합니다. 현재 Microsoft Store 음성 패키지는 호환되지 않을 수 있습니다. 음성 검색도 오프라인으로 유지하려면 어댑터의 Edge 및 Azure 온라인 음성을 끈 뒤 여기에서 음성을 새로 고치세요.",
    help: "설정 및 호환성 안내",
    empty: "이 언어와 호환되는 로컬 Narrator 자연 음성을 찾을 수 없습니다.",
    failed:
      "실험적 Narrator 재생에 실패했습니다. 음성 패키지 호환성과 오디오 출력을 확인한 뒤 음성을 새로 고치세요.",
  },
} satisfies Record<UiLocale, Record<string, string>>;

export const windowsNarratorCopy = (locale: UiLocale) => copy[locale];
export const windowsNarratorHelpUrl =
  "https://github.com/gexgd0419/NaturalVoiceSAPIAdapter#installation";
