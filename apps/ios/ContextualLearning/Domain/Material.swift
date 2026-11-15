import Foundation

enum VideoSourcePlatform: String, Codable, Sendable {
    case youtube, netflix

    var title: String { self == .youtube ? "YouTube" : "Netflix" }

    static func resolve(platform: String?, url: String? = nil) -> Self? {
        if let platform, let value = Self(rawValue: platform.lowercased()) { return value }
        guard let url, let parts = URLComponents(string: url),
            ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
            parts.user == nil, parts.password == nil, parts.port == nil,
            let host = parts.host?.lowercased()
        else { return nil }
        switch host {
        case "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be":
            return .youtube
        case "netflix.com", "www.netflix.com": return .netflix
        default: return nil
        }
    }

    static func readSource(_ object: Any?) -> Self? {
        guard let source = object as? [String: Any] else { return nil }
        return resolve(platform: source["platform"] as? String, url: source["url"] as? String)
    }

    static func readJSON(_ data: Data, favorite: Bool = false) -> Self? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        if favorite { return readSource((object["snapshot"] as? [String: Any])?["source"]) }
        if object["schemaVersion"] as? String == "custom-v1" {
            return readSource((object["request"] as? [String: Any])?["source"])
        }
        return readSource(object["source"])
    }

    static func readPayload(_ payload: ImportPayload) -> Self? {
        switch payload.format {
        case .markdown: return nil
        case .json: return readJSON(payload.original)
        case .favorite:
            guard
                let envelope = try? JSONDecoder().decode(
                    FavoriteDownloadEnvelope.self, from: payload.original)
            else { return nil }
            return readJSON(Data(envelope.operation.utf8), favorite: true)
        }
    }
}

struct ImportPayload: Codable, Sendable {
    enum Format: String, Codable, Sendable { case json, markdown, favorite }
    let format: Format
    let original: Data
    let pairedMarkdown: Data?
    let suggestedName: String
}

struct Material: Codable, Sendable, Identifiable, Hashable {
    enum Kind: String, Codable, Sendable { case standard, custom, markdown }
    let contractVersion: Int
    let kind: Kind
    let documentID: String
    let title: String
    let language: String
    let createdAt: String
    let sourceTitle: String
    let sourceURL: String?
    let scenes: [ReaderScene]
    let markdown: String?
    var id: String { kind.rawValue + ":" + documentID }
}

struct ReaderScene: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let title: String
    let context: String
    let groups: [ReaderGroup]
    let untranslatedGroups: [ReaderGroup]
    var playbackLink: ExternalPlaybackLink? = nil

    var netflixPlaybackLink: ExternalPlaybackLink? {
        if let playbackLink, playbackLink.platform == .netflix { return playbackLink }
        return groups.compactMap(\.netflixPlaybackLink).first
    }
}

struct ReaderGroup: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let rows: [ReaderRow]
    let analyses: [ReaderAnalysis]

    var netflixPlaybackLink: ExternalPlaybackLink? {
        rows.compactMap(\.playbackLink).first { $0.platform == .netflix }
    }
}

struct ReaderRow: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let text: String
    let translation: String
    let pronunciation: [Pronunciation]
    var playbackLink: ExternalPlaybackLink? = nil
}

struct ExternalPlaybackLink: Codable, Sendable, Hashable {
    enum Platform { case youtube, netflix }
    let startMs: Double
    let webURL: String
    var endMs: Double? = nil

    var segmentEndMs: Double? {
        guard let endMs, endMs.isFinite, endMs > startMs, endMs <= 43_200_000 else { return nil }
        return endMs
    }

    var validatedURL: URL? {
        guard startMs.isFinite, startMs >= 0, startMs < 43_200_000,
            let components = URLComponents(string: webURL), components.scheme == "https",
            components.user == nil, components.password == nil, components.port == nil,
            components.fragment == nil,
            let url = components.url
        else { return nil }
        let seconds = Int(startMs / 1000)
        switch components.host {
        case "www.youtube.com":
            guard components.path == "/watch", let query = components.queryItems, query.count == 2,
                query[0].name == "v", let id = query[0].value,
                id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
                query[1].name == "t", query[1].value == "\(seconds)s",
                webURL == "https://www.youtube.com/watch?v=\(id)&t=\(seconds)s"
            else { return nil }
        case "www.netflix.com":
            let id = String(components.path.dropFirst("/watch/".count))
            guard components.path.hasPrefix("/watch/"),
                id.range(of: "^[0-9]+$", options: .regularExpression) != nil
            else { return nil }
            let canonical = "https://www.netflix.com/watch/\(id)"
            // Older review snapshots carry a time parameter. Accept it only as
            // reference metadata; sourceURL strips it before explicit navigation.
            guard webURL == canonical || webURL == canonical + "?t=\(seconds)" else { return nil }
        default: return nil
        }
        return url
    }

    var sourceURL: URL? {
        guard let url = validatedURL else { return nil }
        guard platform == .netflix else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        return components?.url
    }

    var platform: Platform? {
        guard let url = validatedURL else { return nil }
        return url.host == "www.netflix.com" ? .netflix : .youtube
    }

    var platformName: String { platform == .netflix ? "Netflix" : "YouTube" }

    func usesEmbeddedPlayback(hasPlayer: Bool) -> Bool {
        platform == .youtube && hasPlayer
    }

    var timestamp: String {
        guard validatedURL != nil else { return "" }
        return Self.timestamp(startMs)
    }

    var timeRange: String {
        guard let end = segmentEndMs else { return timestamp }
        return timestamp + "–" + Self.timestamp(end)
    }

    private static func timestamp(_ milliseconds: Double) -> String {
        let seconds = Int(milliseconds / 1000)
        return seconds >= 3600
            ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
            : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// An imported official share link. Identity and duration are retained; only t changes.
struct NetflixMomentTemplate: Sendable {
    let originalURL: String
    let videoID: String
    let durationSeconds: Int

    init(_ string: String) throws {
        let value = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf8.count <= 8192,
            let c = URLComponents(string: value), c.scheme == "https",
            ["netflix.com", "www.netflix.com"].contains(c.host ?? ""),
            c.user == nil, c.password == nil, c.port == nil, c.fragment == nil,
            c.path.range(of: "^/watch/[0-9]+$", options: .regularExpression) != nil,
            let query = c.queryItems, Set(query.map(\.name)).count == query.count
        else { throw ImportFailure.invalid("請貼上 Netflix App 分享的完整 Moments 連結。") }
        func field(_ name: String) -> String? { query.first { $0.name == name }?.value }
        let id = String(c.path.dropFirst(7))
        guard field("shareType") == "Moment",
            let momentID = field("momentUuid"), UUID(uuidString: momentID) != nil,
            let shareID = field("shareUuid"), UUID(uuidString: shareID) != nil,
            let time = field("t"), time.range(of: "^[0-9]+$", options: .regularExpression) != nil,
            let seconds = Int(time), (0..<43200).contains(seconds),
            let duration = field("d"), let length = Int(duration), (1...120).contains(length),
            field("unifiedEntityIdEncoded").map({ $0 == "Video:" + id }) ?? true
        else { throw ImportFailure.invalid("連結缺少有效的 Moments 時間或識別資訊，請重新從 Netflix 分享。") }
        originalURL = value
        videoID = id
        durationSeconds = length
    }

    func playbackURL(for link: ExternalPlaybackLink) -> URL? {
        guard link.platform == .netflix, link.sourceURL?.path == "/watch/" + videoID,
            var c = URLComponents(string: originalURL)
        else { return nil }
        guard let index = c.queryItems?.firstIndex(where: { $0.name == "t" }),
            var fields = c.percentEncodedQuery?.components(separatedBy: "&"),
            fields.indices.contains(index)
        else { return nil }
        fields[index] = "t=" + String(Int(link.startMs / 1000))
        c.percentEncodedQuery = fields.joined(separator: "&")
        return c.url
    }
}

struct NetflixMomentLinks {
    static let defaultsKey = "netflixMomentLinks"
    private var links: [String: String]

    init(_ json: String) {
        links = (try? JSONDecoder().decode([String: String].self, from: Data(json.utf8))) ?? [:]
    }
    func template(for link: ExternalPlaybackLink) -> NetflixMomentTemplate? {
        guard link.platform == .netflix, let path = link.sourceURL?.path,
            let raw = links[String(path.dropFirst(7))], let value = try? NetflixMomentTemplate(raw),
            value.playbackURL(for: link) != nil
        else { return nil }
        return value
    }
    func saving(_ raw: String, for link: ExternalPlaybackLink) throws -> String {
        let value = try NetflixMomentTemplate(raw)
        guard value.playbackURL(for: link) != nil else {
            throw ImportFailure.invalid("這個 Moments 連結不是目前教材的同一集／同一部影片。")
        }
        var next = links
        next[value.videoID] = value.originalURL
        return try encoded(next)
    }
    func removing(for link: ExternalPlaybackLink) -> String {
        guard let path = link.sourceURL?.path else { return (try? encoded(links)) ?? "{}" }
        var next = links
        next.removeValue(forKey: String(path.dropFirst(7)))
        return (try? encoded(next)) ?? "{}"
    }
    private func encoded(_ values: [String: String]) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return String(decoding: try encoder.encode(values), as: UTF8.self)
    }
}

struct Pronunciation: Codable, Sendable, Hashable {
    let text: String
    let reading: String?
}

struct ReaderAnalysis: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let title: String
    let basics: [ReaderBasic]
    let chunks: [ReaderChunk]
    let notes: [ReaderNote]
    let items: [ReaderItem]
}

struct ReaderBasic: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let meaning: String
    let contextExplanation: String
}

struct ReaderChunk: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let text: String
    let meaning: String
    let role: String
}

struct ReaderNote: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let type: String
    let title: String
    let explanation: String
    let presentation: String
}

struct ReaderItem: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let expression: String
    let examples: [ReaderExample]
}

struct ReaderExample: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let situation: String
    let dialogue: [ReaderExampleLine]
}

struct ReaderExampleLine: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let text: String
    let translation: String
    let pronunciation: [Pronunciation]?
}

struct MaterialSummary: Codable, Sendable, Identifiable, Hashable {
    let namespace: String
    let id: String
    let documentID: String
    let title: String
    let language: String
    let kind: Material.Kind
    let revision: String
    let byteCount: Int
    let importedAt: Date
    let sourceTitle: String
    let sceneIDs: [String]
    var sourcePlatform: String? = nil
    var kindLabel: String {
        switch kind {
        case .standard: "標準教材"
        case .custom: "自訂教材"
        case .markdown: "本機 Markdown"
        }
    }
}

struct StudyPosition: Codable, Sendable, Hashable {
    var sceneID: String?
    var groupID: String?
    var visitedSceneIDs: [String] = []
    var updatedAt: Date = .now
}

struct ReviewEntry: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let materialID: String
    let title: String
    let sceneTitle: String
    let language: String
    let group: ReaderGroup
    let createdAt: Date
}

struct LibrarySnapshot: Codable, Sendable {
    var version = 1
    var sequence: UInt64 = 0
    var materials: [MaterialSummary] = []
    var positions: [String: StudyPosition] = [:]
    var review: [ReviewEntry] = []
}

struct AppFailure: Identifiable {
    let id = UUID()
    let message: String
}

enum ImportFailure: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { message } else { nil } }
}

func safeSourceURL(_ string: String?) -> URL? {
    guard let string, let url = URL(string: string),
        ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
    else { return nil }
    return url
}
