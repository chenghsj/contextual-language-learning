import AVFoundation
import Darwin
import Foundation

// A precompiled helper bundled beside native-host.mjs; no Swift toolchain is needed at runtime.
struct Input: Decodable {
    let action: String
    let voiceId: String?
    let text: String?
    let rate: Float?
    let outputPath: String? // Used only by the synthesis-file acceptance check.
}
struct Voice: Encodable {
    let id: String
    let name: String
    let language: String
    let quality: String
    let neural: Bool
}
func fail() -> Never {
    fputs("System speech failed. Check the installed voice and audio output.\n", stderr)
    exit(1)
}
func voices() -> [AVSpeechSynthesisVoice] {
    let all = AVSpeechSynthesisVoice.speechVoices()
    // Compact and super-compact variants share the same display name. Keep the better one.
    return all.filter { voice in
        !voice.identifier.contains(".super-compact.") || !all.contains {
            $0.name == voice.name && $0.language == voice.language
                && $0.identifier.contains(".compact.")
        }
    }
}
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    let synthesizer = AVSpeechSynthesizer()
    var audioFile: AVAudioFile?
    var frameCount: AVAudioFrameCount = 0
    var remaining = 0
    override init() {
        super.init()
        synthesizer.delegate = self
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        remaining -= 1
        if remaining == 0 { exit(0) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        exit(0)
    }
    func render(_ utterances: [AVSpeechUtterance], to path: String, index: Int = 0) {
        synthesizer.delegate = nil
        // File rendering writes its own exact PCM break rather than playback queue delays.
        utterances[index].preUtteranceDelay = 0
        var segmentFrames: AVAudioFrameCount = 0
        synthesizer.write(utterances[index]) { [self] buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer else { fail() }
            if pcm.frameLength == 0 {
                if segmentFrames == 0 { fail() }
                if index + 1 < utterances.count {
                    render(utterances, to: path, index: index + 1)
                } else {
                    audioFile = nil
                    exit(0)
                }
                return
            }
            do {
                if audioFile == nil {
                    audioFile = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: pcm.format.settings)
                }
                if index > 0 && segmentFrames == 0 {
                    let pauseFrames = AVAudioFrameCount(pcm.format.sampleRate * 0.3)
                    guard let silence = AVAudioPCMBuffer(pcmFormat: pcm.format, frameCapacity: pauseFrames) else { fail() }
                    silence.frameLength = pauseFrames
                    for buffer in UnsafeMutableAudioBufferListPointer(silence.mutableAudioBufferList) {
                        if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
                    }
                    try audioFile?.write(from: silence)
                    frameCount += pauseFrames
                }
                try audioFile?.write(from: pcm)
                segmentFrames += pcm.frameLength
                frameCount += pcm.frameLength
            } catch { fail() }
        }
    }

}

do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 100_000 else { fail() }
    let input = try JSONDecoder().decode(Input.self, from: data)
    if input.action == "voices" {
        let result = voices().map { voice in
            let quality: String
            switch voice.quality {
            case .premium: quality = "premium"
            case .enhanced: quality = "enhanced"
            default: quality = "default"
            }
            return Voice(id: voice.identifier, name: voice.name, language: voice.language,
                         quality: quality, neural: voice.identifier.lowercased().contains("neural"))
        }
        FileHandle.standardOutput.write(try JSONEncoder().encode(result))
        exit(0)
    }
    guard ["speak", "render"].contains(input.action),
          let id = input.voiceId, let voice = voices().first(where: { $0.identifier == id }),
          let text = input.text, !text.isEmpty, text.count <= 6000,
          let rate = input.rate, rate.isFinite, (0.5...2).contains(rate) else { fail() }
    let speaker = Speaker()
    let utterances = text.components(separatedBy: "\u{2029}")
        .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        .enumerated().map { index, segment in
            let utterance = AVSpeechUtterance(string: segment)
            utterance.voice = voice
            // 1x uses Apple's normal speaking rate.
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate,
                max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * rate))
            utterance.preUtteranceDelay = index > 0 ? 0.3 : 0
            return utterance
        }
    guard !utterances.isEmpty else { fail() }
    speaker.remaining = utterances.count
    signal(SIGTERM, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    termination.setEventHandler {
        speaker.synthesizer.stopSpeaking(at: .immediate)
        exit(0)
    }
    termination.resume()
    // Fail instead of reporting completion when the system speech daemon never responds.
    DispatchQueue.main.asyncAfter(deadline: .now() + 290) { fail() }
    if input.action == "render" {
        guard let path = input.outputPath else { fail() }
        speaker.render(utterances, to: path)
    } else {
        utterances.forEach { speaker.synthesizer.speak($0) }
    }
    RunLoop.main.run()
    withExtendedLifetime((speaker, termination)) {}
} catch { fail() }
