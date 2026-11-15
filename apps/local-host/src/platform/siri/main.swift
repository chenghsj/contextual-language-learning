// Siri catalog/daemon integration adapted from siri-tts-cli (MIT, see LICENSE).
import AVFoundation
import Darwin
import Foundation
import ObjectiveC.runtime
import SiriTTSService

enum AudioErrorCode { case noAudio }
struct CLIError: Error, LocalizedError {
    let message: String
    init(_ message: String, code: AudioErrorCode = .noAudio) { self.message = message }
    var errorDescription: String? { message }
}
struct AudioSpec {
    let sampleRate: Double = 48_000
    let channels: Int = 1
    let bytesPerFrame: Int = 2
    static let siriPCM = AudioSpec()
}
struct NormalizedPCMChunk {
    let pcm: Data
    let spec: AudioSpec
    let startFrame: Int
    let frameCount: Int
}
struct Input: Decodable {
    let action: String
    let operationId: String?
    let operations: [SiriDownloadOperation]?
    let voiceId: String?
    let text: String?
    let rate: Float?
    let outputPath: String?
}
struct Voice: Encodable {
    let id: String
    let name: String
    let language: String
    let technology: String
    let downloadSize: Int
    let installed: Bool
    let removable: Bool
    let resourceAvailable: Bool
    let resourceId: String?
    let engine = "siri"
    let quality = "premium"
    let neural = true
}
struct DownloadFailure: Encodable {
    let status = "rejected"
    let reason: String
    var domain: String? = nil
    var code: Int? = nil
}
struct ResourceFolder: Encodable {
    let voiceId: String
    let directory: String
}
struct CatalogVoice {
    let identifier: String
    let name: String
    let language: String
    let technology: String
    let localTechnology: String
    let gender: Int
    let version: Int
    let desirability: Int
    let local: Bool
    let downloadSize: Int
    var purgeable: Bool
    var resourceAvailable: Bool
    var genderName: String { gender == 1 ? "male" : gender == 2 ? "female" : "neutral" }
    var nativePrefix: String { "\(language):\(technology):\(genderName):\(name):premium:" }
    var installedPrefix: String { "\(language):\(localTechnology):\(genderName):\(name):premium:" }
    var resourceSpecifier: String {
        "com.apple.siri.tts.voice." + language.replacingOccurrences(of: "-", with: "_") + "." +
            name.lowercased(with: Locale(identifier: "en_US_POSIX")) + "." + localTechnology + ".premium"
    }
    func matches(_ voice: SynthesisVoice) -> Bool {
        voice.assetKey.lowercased().hasPrefix(installedPrefix.lowercased())
    }
    func info(_ installed: [SynthesisVoice]) -> Voice {
        Voice(id: "siri:" + identifier, name: name, language: language,
              technology: technology, downloadSize: downloadSize,
              installed: local && (resourceAvailable || installed.contains(where: matches)),
              removable: resourceAvailable && purgeable && assetRemovalSupported,
              resourceAvailable: resourceAvailable,
              resourceId: resourceAvailable ? resourceSpecifier : nil)
    }
    func subscription() throws -> SynthesisVoice {
        try makeVoice(technology: technology)
    }
    func localSynthesisVoice() throws -> SynthesisVoice {
        // downloadedVoices is incomplete on macOS 27. A validated local UAF
        // manifest supplies the identity and content version for synthesis.
        guard resourceAvailable else { throw CLIError("The local Siri resource is unavailable.") }
        _ = try resourceFolder(self)
        return try makeVoice(technology: localTechnology)
    }
    private func makeVoice(technology: String) throws -> SynthesisVoice {
        guard let type = ["neural": 4, "neuralAX": 5, "natural": 6, "fmvoice": 7][technology] else {
            throw CLIError("Unsupported Siri voice technology.")
        }
        let voice = SynthesisVoice(language: language, name: name)
        guard ["setType:", "setGender:", "setFootprint:"].allSatisfy({
            voice.responds(to: NSSelectorFromString($0))
        }) else { throw CLIError("Siri voice subscription is unavailable on this macOS version.") }
        voice.setValue(type, forKey: "type")
        voice.setValue(gender, forKey: "gender")
        voice.setValue(2, forKey: "footprint")
        voice.version = version
        let prefix = "\(language):\(technology):\(genderName):\(name):premium:"
        guard voice.assetKey == prefix + String(version) else {
            throw CLIError("The Siri voice identity is incompatible.")
        }
        return voice
    }
}

// Resolve a selected voice from its manifest, never from a caller-supplied path.
// fmvoice catalog entries may share their downloaded natural counterpart.
func resourceFolder(_ row: CatalogVoice) throws -> String {
    let key = row.resourceSpecifier
    let root = URL(fileURLWithPath:
        "/System/Library/AssetsV2/com_apple_MobileAsset_UAF_Siri_TextToSpeech/purpose_auto/")
    let children = try FileManager.default.contentsOfDirectory(
        at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
    var matches: [(Int, String)] = []
    for child in children where child.pathExtension == "asset" {
        guard FileManager.default.fileExists(atPath: child.appendingPathComponent("AssetData").path),
              let data = try? Data(contentsOf: child.appendingPathComponent("Info.plist")),
              let plist = try? PropertyListSerialization.propertyList(
                from: data, options: [], format: nil) as? [String: Any],
              let properties = plist["MobileAssetProperties"] as? [String: Any],
              properties["AssetSpecifier"] as? String == key,
              let version = integer(properties["ttsContentVersion"]) else { continue }
        matches.append((version, child.path))
    }
    guard let latest = matches.map({ $0.0 }).max(),
          matches.filter({ $0.0 == latest }).count == 1,
          let path = matches.first(where: { $0.0 == latest })?.1 else {
        throw CLIError("The exact local Siri resource folder could not be identified.")
    }
    let rootPath = root.resolvingSymlinksInPath().path
    let resolved = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    guard resolved.deletingLastPathComponent().path == rootPath,
          resolved.pathExtension == "asset",
          resolved.appendingPathComponent("AssetData").resolvingSymlinksInPath().path ==
            resolved.appendingPathComponent("AssetData").path,
          resolved.appendingPathComponent("Info.plist").resolvingSymlinksInPath().path ==
            resolved.appendingPathComponent("Info.plist").path else {
        throw CLIError("The Siri resource folder is outside the system asset root.")
    }
    return resolved.path
}

// MobileAsset, rather than direct filesystem deletion, owns protected resources.
// Based on siri-tts-cli's exact-asset elimination (see UPSTREAM.md and LICENSE).
func purgeClasses() throws -> (AnyClass, AnyClass) {
    guard dlopen("/System/Library/PrivateFrameworks/MobileAsset.framework/MobileAsset",
                 RTLD_LAZY | RTLD_LOCAL) != nil,
          let selectorClass = NSClassFromString("MAAutoAssetSelector"),
          let assetClass = NSClassFromString("MAAutoAsset"),
          let initializer = class_getInstanceMethod(selectorClass,
            NSSelectorFromString("initForAssetType:withAssetSpecifier:")),
          let elimination = class_getClassMethod(assetClass,
            NSSelectorFromString("eliminateAllForSelectorSync:")),
          let initialEncoding = method_getTypeEncoding(initializer),
          let eliminationEncoding = method_getTypeEncoding(elimination),
          String(cString: initialEncoding) == "@32@0:8@16@24",
          String(cString: eliminationEncoding) == "@24@0:8@16" else {
        throw CLIError("Siri resource removal is unavailable on this macOS version.")
    }
    return (selectorClass, assetClass)
}
let assetRemovalSupported = (try? purgeClasses()) != nil
func isPurgeable(_ asset: NSObject) -> Bool {
    let selector = NSSelectorFromString("purgeable")
    guard let method = class_getInstanceMethod(type(of: asset), selector),
          let encoding = method_getTypeEncoding(method),
          String(cString: encoding) == "B16@0:8" else { return false }
    typealias Getter = @convention(c) (UnsafeRawPointer, Selector) -> Bool
    let getter = unsafeBitCast(method_getImplementation(method), to: Getter.self)
    return getter(Unmanaged.passUnretained(asset).toOpaque(), selector)
}
func removeResource(_ row: CatalogVoice) throws -> Bool {
    guard row.purgeable else { throw CLIError("This Siri asset is not removable.") }
    let path = try resourceFolder(row)
    let dataPath = URL(fileURLWithPath: path).appendingPathComponent("AssetData").path
    let (selectorClass, assetClass) = try purgeClasses()
    guard let allocated = (selectorClass as AnyObject).perform(
        NSSelectorFromString("alloc"))?.takeUnretainedValue(),
          let selector = allocated.perform(
            NSSelectorFromString("initForAssetType:withAssetSpecifier:"),
            with: "com.apple.MobileAsset.UAF.Siri.TextToSpeech" as NSString,
            with: row.resourceSpecifier as NSString)?.takeRetainedValue() else {
        throw CLIError("The Siri resource removal selector could not be created.")
    }
    // Some releases route elimination even when the synchronous reply reports
    // an entitlement error. Confirm physical absence before reporting success.
    _ = (assetClass as AnyObject).perform(
        NSSelectorFromString("eliminateAllForSelectorSync:"), with: selector)
    let deadline = Date(timeIntervalSinceNow: 15)
    repeat {
        if !FileManager.default.fileExists(atPath: dataPath) { return true }
        Thread.sleep(forTimeInterval: 0.1)
    } while Date() < deadline
    return false
}

// A local manifest and the daemon must agree before a voice becomes playable.
func localVersions() -> [String: Int]? {
    let root = URL(fileURLWithPath:
        "/System/Library/AssetsV2/com_apple_MobileAsset_UAF_Siri_TextToSpeech/purpose_auto/")
    guard let children = try? FileManager.default.contentsOfDirectory(
        at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
    ) else { return nil }
    var result: [String: Int] = [:]
    for child in children where child.pathExtension == "asset" {
        guard FileManager.default.fileExists(atPath: child.appendingPathComponent("AssetData").path),
              let data = try? Data(contentsOf: child.appendingPathComponent("Info.plist")),
              let plist = try? PropertyListSerialization.propertyList(
                from: data, options: [], format: nil) as? [String: Any],
              let properties = plist["MobileAssetProperties"] as? [String: Any],
              let key = properties["AssetSpecifier"] as? String,
              let version = integer(properties["ttsContentVersion"]) else { continue }
        result[key] = max(result[key] ?? 0, version)
    }
    return result
}
func catalog() throws -> [CatalogVoice] {
    try SiriDownloadJournal().withLock("catalog") { try readCatalog() }
}
func readCatalog() throws -> [CatalogVoice] {
    var handles: [UnsafeMutableRawPointer] = []
    defer { handles.forEach { dlclose($0) } }
    for framework in ["SiriTTSService", "TextToSpeech"] {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/\(framework).framework/\(framework)",
                                  RTLD_LAZY | RTLD_LOCAL) else {
            throw CLIError("The Siri voice catalog is unavailable.")
        }
        handles.append(handle)
    }
    guard let assetClass = NSClassFromString("SiriTTSService.TTSAsset"),
          let typeClass = NSClassFromString("TTSAssetType"),
          class_getClassMethod(typeClass, NSSelectorFromString("gryphonVoice")) != nil,
          class_getClassMethod(assetClass, NSSelectorFromString("listAssetsOfTypes:matching:")) != nil,
          ["identifier", "name", "primaryLanguage", "technology", "gender", "quality",
           "versionNumber", "attributes", "locallyAvailable", "downloadSize"].allSatisfy({
            class_getInstanceMethod(assetClass, NSSelectorFromString($0)) != nil
          }),
          let type = (typeClass as AnyObject).perform(
            NSSelectorFromString("gryphonVoice"))?.takeUnretainedValue()
    else { throw CLIError("The Siri voice catalog is incompatible with this macOS version.") }
    var types = [type]
    if class_getClassMethod(typeClass, NSSelectorFromString("customVoice")) != nil,
       let custom = (typeClass as AnyObject).perform(
         NSSelectorFromString("customVoice"))?.takeUnretainedValue() {
        types.append(custom)
    }
    guard
          let assets = (assetClass as AnyObject).perform(
            NSSelectorFromString("listAssetsOfTypes:matching:"),
            with: NSArray(array: types), with: NSDictionary())?.takeUnretainedValue() as? [NSObject]
    else { throw CLIError("The Siri voice catalog is incompatible with this macOS version.") }
    let versions = localVersions()
    var preferred: [String: CatalogVoice] = [:]
    var purgeableKeys: [String: Bool] = [:]
    for asset in assets {
        guard let id = string(asset.value(forKey: "identifier")), !id.isEmpty,
              let name = string(asset.value(forKey: "name")), !name.isEmpty,
              let language = string(asset.value(forKey: "primaryLanguage")),
              let technology = string(asset.value(forKey: "technology")),
              ["neural", "neuralAX", "natural", "fmvoice"].contains(technology),
              string(asset.value(forKey: "quality")) == "premium",
              let gender = integer(asset.value(forKey: "gender")), (1...3).contains(gender),
              let reportedVersion = integer(asset.value(forKey: "versionNumber")) else { continue }
        let size = integer(asset.value(forKey: "downloadSize")) ?? 0
        let key = "com.apple.siri.tts.voice." +
            language.replacingOccurrences(of: "-", with: "_") + "." +
            name.lowercased(with: Locale(identifier: "en_US_POSIX")) + "." + technology + ".premium"
        let naturalKey = technology == "fmvoice" ?
            String(key.dropLast("fmvoice.premium".count)) + "natural.premium" : key
        // A catalog alias can target a different physical technology. Only use
        // the physical asset's purgeable property, requiring all rows to agree.
        purgeableKeys[key] = (purgeableKeys[key] ?? true) && isPurgeable(asset)
        let localTechnology = technology == "fmvoice" && versions?[naturalKey] != nil ?
            "natural" : technology
        let reportedLocal = asset.value(forKey: "locallyAvailable") as? Bool ?? false
        // macOS 27 fmvoice uses IFP assets, not the legacy UAF manifest root.
        // Require the catalog and daemon to agree without applying UAF absence
        // to this newer asset family.
        // On macOS 27 a subscription to an IFP fmvoice may install its natural
        // UAF counterpart. Use that physical asset and its daemon identity for
        // playback while retaining the requested catalog ID in responses.
        let local = technology == "fmvoice" ? reportedLocal || versions?[naturalKey] != nil :
            versions.map { $0[key] != nil } ?? reportedLocal
        let attributes = asset.value(forKey: "attributes") as? NSDictionary
        let row = CatalogVoice(identifier: id, name: name, language: language,
            technology: technology, localTechnology: localTechnology,
            gender: gender, version: versions?[localTechnology == "natural" ? naturalKey : key] ?? reportedVersion,
            desirability: integer(attributes?["VoiceRelativeDesirability"]) ?? 0,
            local: local, downloadSize: size, purgeable: false, resourceAvailable: false)
        if preferred[id] == nil || row.desirability > preferred[id]!.desirability {
            preferred[id] = row
        }
    }
    guard !preferred.isEmpty else { throw CLIError("No compatible Siri neural voices were found.") }
    for (id, var row) in preferred {
        row.resourceAvailable = versions?[row.resourceSpecifier] != nil
        row.purgeable = row.resourceAvailable && (purgeableKeys[row.resourceSpecifier] ?? false)
        preferred[id] = row
    }
    return preferred.values.sorted { ($0.language, $0.name, $0.identifier) < ($1.language, $1.name, $1.identifier) }
}
func integer(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? String { return Int(value) }
    return (value as? NSNumber)?.intValue
}
func string(_ value: Any?) -> String? {
    guard let value else { return nil }
    return value as? String ?? String(describing: value)
}
func installed(_ session: DaemonSession) throws -> [SynthesisVoice] {
    let done = DispatchSemaphore(value: 0)
    var voices: [SynthesisVoice] = []
    session.downloadedVoices(matching: nil) { voices = $0; done.signal() }
    guard done.wait(timeout: .now() + 10) == .success else {
        throw CLIError("The Siri voice service did not respond.")
    }
    return voices
}
func emit<T: Encodable>(_ value: T) throws {
    FileHandle.standardOutput.write(try JSONEncoder().encode(value))
}
func wave(_ pcm: Data) -> Data {
    var result = Data()
    func string(_ value: String) { result.append(contentsOf: value.utf8) }
    func number<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { result.append(contentsOf: $0) }
    }
    string("RIFF"); number(UInt32(pcm.count + 36)); string("WAVEfmt ")
    number(UInt32(16)); number(UInt16(1)); number(UInt16(1))
    number(UInt32(48_000)); number(UInt32(96_000)); number(UInt16(2)); number(UInt16(16))
    string("data"); number(UInt32(pcm.count)); result.append(pcm)
    return result
}

do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 100_000 else { throw CLIError("Speech input is too large.") }
    let input = try JSONDecoder().decode(Input.self, from: data)
    guard dlopen("/System/Library/PrivateFrameworks/SiriTTSService.framework/SiriTTSService",
                 RTLD_LAZY | RTLD_LOCAL) != nil else { throw CLIError("Siri speech is unavailable.") }
    if input.action == "resourceSupport" {
        try emit(["removalSupported": assetRemovalSupported]); exit(0)
    }
    if input.action == "removeResource" {
        guard let voiceId = input.voiceId else { throw CLIError("Missing Siri voice identity.") }
        let removed = try removeSpeechResource(voiceId: voiceId)
        try emit(["voiceId": voiceId, "status": removed ? "removed" : "not-removed"])
        exit(0)
    }
    if input.action == "resourceFolder" {
        guard let voiceId = input.voiceId,
              let row = try catalog().first(where: { "siri:" + $0.identifier == voiceId }) else {
            throw CLIError("The selected Siri voice is unavailable.")
        }
        try emit(ResourceFolder(voiceId: voiceId, directory: try resourceFolder(row)))
        exit(0)
    }
    if ["startSpeechDownload", "cancelSpeechDownload", "inspectSpeechDownloads"].contains(input.action) {
        let operations: [SiriDownloadOperation]
        if input.action == "inspectSpeechDownloads", let batch = input.operations {
            operations = batch
        } else if let operationId = input.operationId, let voiceId = input.voiceId,
                  input.action != "inspectSpeechDownloads" {
            operations = [SiriDownloadOperation(operationId: operationId, voiceId: voiceId)]
        } else { throw CLIError("Invalid Siri download operation.") }
        let observations: SiriDownloadObservations
        if input.action == "startSpeechDownload" {
            observations = try SiriDownloadJournal().withLock("resource-changes") {
                try speechDownloadObservations(action: input.action, operations: operations)
            }
        } else {
            observations = try speechDownloadObservations(action: input.action, operations: operations)
        }
        try emit(observations)
        exit(0)
    }
    let session = DaemonSession()
    guard session.invokeDaemon() else { throw CLIError("Siri speech is unavailable.") }
    let native = try installed(session)
    let rows = try catalog()
    let voices = rows.map { $0.info(native) }
    if input.action == "catalog" { try emit(voices); exit(0) }
    if input.action == "voices" { try emit(voices.filter { $0.installed }); exit(0) }
    guard let voiceId = input.voiceId, let row = rows.first(where: { "siri:" + $0.identifier == voiceId })
    else { throw CLIError("The selected Siri voice is unavailable.") }
    if input.action == "status" {
        try emit(row.info(native)); exit(0)
    }
    if input.action == "install" {
        try SiriDownloadJournal().withLock("resource-changes") {
            guard let row = try catalog().first(where: { $0.identifier == row.identifier }) else {
                throw CLIError("The selected Siri voice is unavailable.")
            }
            if row.resourceAvailable {
                try emit(["status": "installed"]); exit(0)
            }
            guard Bundle.main.bundleIdentifier != nil else {
                try emit(DownloadFailure(reason: "missing-client-identity")); exit(0)
            }
            let done = DispatchSemaphore(value: 0)
            var failure: Error?
            session.subscribe(voices: [try row.subscription()]) { failure = $0; done.signal() }
            guard done.wait(timeout: .now() + 15) == .success else {
                try emit(DownloadFailure(reason: "request-timed-out")); exit(0)
            }
            if let failure {
                let error = failure as NSError
                // Transport only bounded diagnostic identifiers, not arbitrary error
                // descriptions containing paths, request data or system details.
                let domain = error.domain.range(of: "^[A-Za-z0-9._-]{1,100}$",
                    options: .regularExpression) != nil ? error.domain : nil
                try emit(DownloadFailure(reason: "download-rejected", domain: domain,
                    code: error.code)); exit(0)
            }
            try emit(["status": "requested"]); exit(0)
        }
    }
    guard ["speak", "render"].contains(input.action), row.info(native).installed,
          let text = input.text, !text.isEmpty, text.count <= 6000,
          let rate = input.rate, rate.isFinite, (0.5...2).contains(rate)
    else { throw CLIError("The Siri voice is not installed or the speech input is invalid.") }
    let voice = try native.first(where: row.matches) ?? row.localSynthesisVoice()
    let segments = text.components(separatedBy: "\u{2029}")
        .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    guard !segments.isEmpty else { throw CLIError("Speech input is empty.") }
    let lock = NSLock()
    var activeRequest: SynthesisRequest?
    signal(SIGTERM, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    termination.setEventHandler {
        lock.lock(); let request = activeRequest; lock.unlock()
        if let request { session.cancel(request: request) }
        exit(0)
    }
    termination.resume()
    var pcm = Data()
    let deadline = DispatchTime.now() + 240
    for (index, segment) in segments.enumerated() {
        let request = SynthesisRequest(text: segment, voice: voice)
        request.synthesisContext.rate = rate
        request.synthesisContext.pitch = 1
        request.synthesisContext.volume = 1
        lock.lock(); activeRequest = request; lock.unlock()
        let normalizer = SiriAudioNormalizer()
        var segmentPCM = Data()
        var failure: Error?
        request.synthesisContext.didGenerateAudio = { chunk in
            lock.lock(); defer { lock.unlock() }
            guard failure == nil else { return }
            do {
                let chunks = try normalizer.append(SiriSourceAudioChunk(
                    audioData: chunk.audioData, format: chunk.asbd, packetDescriptions: chunk.packetDescriptions,
                    packetCount: chunk.packetCount, reportedSampleCount: Int(chunk.sampleCount)))
                for chunk in chunks { segmentPCM.append(chunk.pcm) }
                if pcm.count + segmentPCM.count > 64 * 1024 * 1024 { throw CLIError("Siri audio is too large.") }
            } catch { failure = error }
        }
        let done = DispatchSemaphore(value: 0)
        session.synthesize(request: request) { error in
            lock.lock(); if let error { failure = error }; lock.unlock(); done.signal()
        }
        guard done.wait(timeout: deadline) == .success else {
            session.cancel(request: request); throw CLIError("Siri synthesis timed out.")
        }
        lock.lock()
        let synthesisFailure = failure
        if synthesisFailure == nil {
            do { for chunk in try normalizer.finish() { segmentPCM.append(chunk.pcm) } }
            catch { lock.unlock(); throw error }
        }
        lock.unlock()
        if let synthesisFailure { throw synthesisFailure }
        guard !segmentPCM.isEmpty, segmentPCM.count % 2 == 0,
              segmentPCM.contains(where: { $0 != 0 }) else { throw CLIError("Siri returned no audible audio.") }
        // Normalized audio is 48kHz mono signed 16-bit PCM. No break before/after the group.
        if index > 0 { pcm.append(Data(repeating: 0, count: 28_800)) }
        pcm.append(segmentPCM)
        guard pcm.count <= 64 * 1024 * 1024 else { throw CLIError("Siri audio is too large.") }
    }
    let audio = wave(pcm)
    if input.action == "render", let path = input.outputPath {
        try audio.write(to: URL(fileURLWithPath: path), options: .atomic)
    } else {
        let player = try AVAudioPlayer(data: audio)
        guard player.play() else { throw CLIError("Could not play Siri audio.") }
        while player.isPlaying { Thread.sleep(forTimeInterval: 0.05) }
    }
} catch {
    fputs(error.localizedDescription + "\n", stderr)
    exit(1)
}
