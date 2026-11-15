import AVFoundation
import Observation

struct SpeechPreviewLanguage: Identifiable, Equatable {
    let id: String
    let label: String
    let sample: String

    static let all: [Self] = [
        .init(id: "en", label: "英文", sample: "This is a voice preview."),
        .init(id: "ja", label: "日文", sample: "これは音声の試聴です。"),
        .init(id: "ko", label: "韓文", sample: "음성 미리 듣기입니다."),
        .init(id: "es", label: "西班牙文", sample: "Esta es una prueba de voz."),
        .init(id: "fr", label: "法文", sample: "Ceci est un aperçu de la voix."),
        .init(id: "de", label: "德文", sample: "Dies ist eine Stimmvorschau."),
        .init(id: "it", label: "義大利文", sample: "Questa è un'anteprima della voce."),
        .init(id: "pt", label: "葡萄牙文", sample: "Esta é uma prévia da voz."),
        .init(id: "id", label: "印尼文", sample: "Ini adalah pratinjau suara."),
        .init(id: "th", label: "泰文", sample: "นี่คือตัวอย่างเสียง"),
        .init(id: "ms", label: "馬來文", sample: "Ini ialah pratonton suara."),
        .init(id: "vi", label: "越南文", sample: "Đây là bản nghe thử giọng nói."),
        .init(id: "zh-TW", label: "中文（台灣）", sample: "這是語音試聽。"),
        .init(id: "zh-CN", label: "中文（中國大陸）", sample: "这是语音试听。"),
    ]

    static func initial(for language: String?) -> Self {
        let tag = normalizedSpeechLanguage(language ?? "")?.lowercased() ?? ""
        if let exact = all.first(where: { $0.id.lowercased() == tag }) { return exact }
        let parts = tag.split(separator: "-")
        if parts.first == "zh", parts.contains("hans"),
            let simplified = all.first(where: { $0.id == "zh-CN" })
        {
            return simplified
        }
        return all.first { $0.id.split(separator: "-").first == parts.first } ?? all[0]
    }
}

func normalizedSpeechLanguage(_ language: String) -> String? {
    let tag = language.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(
        of: "_", with: "-")
    guard !["", "unspecified", "und"].contains(tag.lowercased()) else { return nil }
    return tag
}

func systemSettingsSpeechUtterance(
    text: String, language: String
) -> AVSpeechUtterance? {
    guard let tag = normalizedSpeechLanguage(language),
        let voice = AVSpeechSynthesisVoice(language: tag),
        voice.language.lowercased().split(separator: "-").first
            == tag.lowercased().split(separator: "-").first
    else { return nil }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    utterance.prefersAssistiveTechnologySettings = true
    return utterance
}

@MainActor
protocol SpeechSynthesizing: AnyObject {
    var delegate: AVSpeechSynthesizerDelegate? { get set }
    var isSpeaking: Bool { get }
    func speak(_ utterance: AVSpeechUtterance)
    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool
    func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool
    func continueSpeaking() -> Bool
}

extension AVSpeechSynthesizer: SpeechSynthesizing {}

struct SentenceSpeechSource: Equatable {
    let groupID: String
    let rowID: String
}

@MainActor @Observable
final class SpeechService: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer: any SpeechSynthesizing
    private var currentUtterance: ObjectIdentifier?
    private var audioSessionActive = false
    private(set) var isSpeaking = false
    private(set) var isPaused = false
    private(set) var currentSource: SentenceSpeechSource?
    var notice: String?

    func preview(language: String) {
        speak(SpeechPreviewLanguage.initial(for: language).sample, language: language)
    }

    init(synthesizer: any SpeechSynthesizing = AVSpeechSynthesizer()) {
        self.synthesizer = synthesizer
        super.init()
        synthesizer.delegate = self
    }

    func makeUtterance(_ text: String, language: String) -> AVSpeechUtterance? {
        systemSettingsSpeechUtterance(text: text, language: language)
    }

    func toggle(_ text: String, language: String, source: SentenceSpeechSource) {
        if currentSource == source, currentUtterance != nil {
            if isPaused {
                if synthesizer.continueSpeaking() { isPaused = false }
            } else if synthesizer.pauseSpeaking(at: .immediate) {
                isPaused = true
            }
        } else {
            speak(text, language: language, source: source)
        }
    }

    func speak(_ text: String, language: String, source: SentenceSpeechSource? = nil) {
        stop()
        guard !text.isEmpty else { return }
        guard normalizedSpeechLanguage(language) != nil else {
            notice = "教材未標示朗讀語言，請先更新教材的語言資訊。"
            return
        }
        guard let utterance = makeUtterance(text, language: language) else {
            notice = "裝置目前沒有這個語言的朗讀聲音，請至「設定 → 輔助使用」檢查聲音。"
            return
        }
        enqueue(utterance, source: source)
    }

    private func enqueue(_ utterance: AVSpeechUtterance, source: SentenceSpeechSource?) {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            audioSessionActive = true
        } catch {
            notice = "無法啟用語音播放，請檢查音訊裝置。"
            return
        }
        isSpeaking = true
        isPaused = false
        currentSource = source
        currentUtterance = ObjectIdentifier(utterance)
        notice = nil
        synthesizer.speak(utterance)
    }

    func stop() {
        currentUtterance = nil
        currentSource = nil
        isPaused = false
        let requestedStop = synthesizer.stopSpeaking(at: .immediate)
        isSpeaking = false
        if !requestedStop || !synthesizer.isSpeaking { releaseAudioSession() }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
    ) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in self?.finish(identifier) }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
    ) {
        let identifier = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in self?.finish(identifier) }
    }

    private func finish(_ identifier: ObjectIdentifier) {
        guard currentUtterance == identifier || currentUtterance == nil else { return }
        currentUtterance = nil
        currentSource = nil
        isPaused = false
        isSpeaking = false
        if !synthesizer.isSpeaking { releaseAudioSession() }
    }

    private func releaseAudioSession() {
        guard audioSessionActive else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(
                false, options: .notifyOthersOnDeactivation)
            audioSessionActive = false
        } catch { notice = "朗讀已停止，音訊狀態無法更新。" }
    }
}
