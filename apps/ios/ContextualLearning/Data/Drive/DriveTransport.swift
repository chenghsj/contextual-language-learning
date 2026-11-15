import CryptoKit
import Foundation

enum DriveMaterialKind: String, Codable, Sendable {
    case standard
    case custom
}

struct DriveRemoteFile: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let createdTime: String?
    let modifiedTime: String?
    let appProperties: [String: String]
}

struct DriveLibraryItem: Codable, Equatable, Identifiable, Sendable {
    let documentId: String
    let kind: DriveMaterialKind
    let title: String
    let sourceTitle: String
    let language: String
    let createdAt: String
    let schema: String
    var json: DriveRemoteFile?
    var markdown: DriveRemoteFile?
    var conflict: Bool
    var sourcePlatform: String? = nil

    var id: String { kind.rawValue + ":" + documentId }
}

struct DriveMaterialDownload: Sendable {
    let documentId: String
    let kind: DriveMaterialKind
    let jsonData: Data
    let markdownData: Data?
    let item: DriveLibraryItem
}

enum DriveFavoriteFileKind: String, Sendable {
    case operation = "favorite-operation"
    case catalog = "favorite-catalog-operation"
}

struct DriveFavoriteFile: Codable, Equatable, Sendable {
    let id: String
    let operationId: String
    let hash: String
    let schema: String
}

enum DriveTransportError: Error, LocalizedError, Equatable, Sendable {
    case unauthorized
    case forbidden
    case missingFile
    case httpStatus(Int)
    case invalidResponse
    case incompleteCatalog
    case invalidPagination
    case tooManyFiles
    case invalidFileReference
    case invalidCollection
    case invalidAccessToken
    case tooLarge
    case invalidUTF8
    case checksumMismatch
    case conflictingBackups
    case incompleteBackup
    case documentIdentityMismatch
    case customContentMismatch

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Google 授權已過期，請重新連結。"
        case .forbidden: return "Google Drive 拒絕存取，請確認帳號、授權與配額。"
        case .missingFile: return "雲端檔案已不存在，請重新整理。"
        case .httpStatus: return "Google Drive 暫時無法讀取，請稍後重試。"
        case .invalidResponse: return "Google Drive 備份資訊無效，已保留原資料。"
        case .incompleteCatalog: return "Google Drive 清單不完整，請重新整理。"
        case .invalidPagination: return "Google Drive 分頁無效，請重新整理。"
        case .tooManyFiles: return "Google Drive 清單超過讀取上限。"
        case .invalidFileReference: return "雲端檔案識別無效。"
        case .invalidCollection: return "雲端收藏集合識別無效。"
        case .invalidAccessToken: return "Google 授權無效，請重新連結。"
        case .tooLarge: return "檔案超過讀取上限。"
        case .invalidUTF8: return "教材不是有效的 UTF-8 文字。"
        case .checksumMismatch: return "教材校驗失敗，已保留原資料。"
        case .conflictingBackups: return "這份教材有重複的雲端備份，請在原裝置確認。"
        case .incompleteBackup: return "教材備份不完整，請先在原裝置同步。"
        case .documentIdentityMismatch: return "教材識別與雲端備份資訊不一致。"
        case .customContentMismatch: return "自訂教材內容與備份資訊不一致。"
        }
    }
}

struct DriveTransport: Sendable {
    static let materialByteLimit = 25_000_000
    private static let pageByteLimit = 8_000_000
    private static let maximumPages = 100
    private static let maximumFiles = 50_000
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 60
            configuration.httpCookieAcceptPolicy = .never
            configuration.httpShouldSetCookies = false
            configuration.urlCache = nil
            self.session = URLSession(configuration: configuration)
        }
    }

    func listLibrary(accessToken: String) async throws -> [DriveLibraryItem] {
        let formats = ["contextualFormat", "immersiveFormat"].flatMap { key in
            ["json", "md"].map { "appProperties has { key='\(key)' and value='\($0)' }" }
        }
        let files = try await listFiles(
            query: "trashed = false and (" + formats.joined(separator: " or ") + ")",
            accessToken: accessToken
        )
        var grouped: [String: DriveLibraryItem] = [:]
        for file in files {
            guard let name = file.name, !name.isEmpty else {
                throw DriveTransportError.invalidResponse
            }
            let properties = Self.normalizedProperties(file.appProperties)
            guard let rawId = properties["contextualDocumentId"],
                let uuid = UUID(uuidString: rawId),
                let format = properties["contextualFormat"], ["json", "md"].contains(format)
            else { continue }
            let kind: DriveMaterialKind
            switch properties["contextualSchemaVersion"] {
            case "7": kind = .standard
            case "custom-v1": kind = .custom
            default: continue
            }
            if let declaredKind = properties["contextualKind"], declaredKind == "custom",
                kind != .custom
            {
                throw DriveTransportError.invalidResponse
            }
            let documentId = uuid.uuidString.lowercased()
            let key = kind.rawValue + ":" + documentId
            let remote = DriveRemoteFile(
                id: file.id, name: name, createdTime: file.createdTime,
                modifiedTime: file.modifiedTime, appProperties: properties
            )
            var item =
                grouped[key]
                ?? DriveLibraryItem(
                    documentId: documentId, kind: kind,
                    title: properties["contextualTitle"].flatMap { $0.isEmpty ? nil : $0 } ?? name,
                    sourceTitle: properties["contextualSourceTitle"] ?? "",
                    language: properties["contextualLanguage"] ?? "unspecified",
                    createdAt: properties["contextualCreatedAt"] ?? file.createdTime
                        ?? "1970-01-01T00:00:00.000Z",
                    schema: kind == .standard ? "7" : "custom-v1",
                    json: nil, markdown: nil, conflict: false
                )
            if let raw = properties["contextualSourcePlatform"],
                let platform = VideoSourcePlatform.resolve(platform: raw)
            {
                item.sourcePlatform = platform.rawValue
            }
            if format == "json" {
                if let prior = item.json, prior.id != remote.id {
                    item.conflict = true
                } else {
                    item.json = remote
                }
            } else {
                if let prior = item.markdown, prior.id != remote.id {
                    item.conflict = true
                } else {
                    item.markdown = remote
                }
            }
            grouped[key] = item
        }
        return grouped.values.sorted {
            $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt > $1.createdAt
        }
    }

    func download(item: DriveLibraryItem, accessToken: String, refreshMetadata: Bool = false)
        async throws -> DriveMaterialDownload
    {
        try Task.checkCancellation()
        if refreshMetadata {
            let latest = try await listLibrary(accessToken: accessToken)
            guard let current = latest.first(where: { $0.id == item.id }) else {
                throw DriveTransportError.missingFile
            }
            return try await download(item: current, accessToken: accessToken)
        }
        guard !item.conflict else { throw DriveTransportError.conflictingBackups }
        guard let json = item.json else { throw DriveTransportError.incompleteBackup }
        let jsonData = try await checkedBytes(
            file: json, requireHash: item.kind == .custom, accessToken: accessToken)
        let metadata: DownloadMetadata
        do { metadata = try JSONDecoder().decode(DownloadMetadata.self, from: jsonData) } catch {
            throw DriveTransportError.invalidResponse
        }
        guard UUID(uuidString: metadata.id)?.uuidString.lowercased() == item.documentId.lowercased()
        else {
            throw DriveTransportError.documentIdentityMismatch
        }
        let markdownData: Data?
        switch item.kind {
        case .standard:
            guard case .integer(7) = metadata.schemaVersion else {
                throw DriveTransportError.invalidResponse
            }
            markdownData = nil
        case .custom:
            guard case .string("custom-v1") = metadata.schemaVersion,
                let markdown = item.markdown,
                let markdownHash = metadata.markdownHash,
                Self.validHash(markdownHash)
            else { throw DriveTransportError.incompleteBackup }
            let content = try await checkedBytes(
                file: markdown, requireHash: true, accessToken: accessToken)
            guard Self.sha256(content) == markdownHash else {
                throw DriveTransportError.customContentMismatch
            }
            markdownData = content
        }
        try Task.checkCancellation()
        return DriveMaterialDownload(
            documentId: item.documentId, kind: item.kind, jsonData: jsonData,
            markdownData: markdownData, item: item)
    }

    func sourcePlatform(item: DriveLibraryItem, accessToken: String) async throws -> String {
        guard !item.conflict, let json = item.json else {
            throw DriveTransportError.incompleteBackup
        }
        let data = try await checkedBytes(
            file: json, requireHash: item.kind == .custom, accessToken: accessToken)
        let metadata = try JSONDecoder().decode(DownloadMetadata.self, from: data)
        guard UUID(uuidString: metadata.id)?.uuidString.lowercased() == item.documentId.lowercased()
        else { throw DriveTransportError.documentIdentityMismatch }
        switch (item.kind, metadata.schemaVersion) {
        case (.standard, .integer(7)), (.custom, .string("custom-v1")): break
        default: throw DriveTransportError.invalidResponse
        }
        return VideoSourcePlatform.readJSON(data)?.rawValue ?? ""
    }

    func listFavoriteFiles(
        collectionId: String,
        kind: DriveFavoriteFileKind,
        accessToken: String
    ) async throws -> [DriveFavoriteFile] {
        guard Self.validHash(collectionId) else { throw DriveTransportError.invalidCollection }
        let query =
            "trashed = false and appProperties has { key='contextualKind' and value='\(kind.rawValue)' } and appProperties has { key='contextualFavoriteCollection' and value='\(collectionId)' }"
        return try await listFiles(query: query, accessToken: accessToken).map { file in
            let properties = file.appProperties
            guard properties["contextualKind"] == kind.rawValue,
                properties["contextualFavoriteCollection"] == collectionId,
                let operationId = properties["contextualFavoriteOperation"],
                UUID(uuidString: operationId) != nil,
                let hash = properties["contextualContentHash"], Self.validHash(hash)
            else { throw DriveTransportError.invalidResponse }
            return DriveFavoriteFile(
                id: file.id, operationId: operationId, hash: hash,
                schema: properties["contextualFavoriteSchema"] ?? "unknown"
            )
        }
    }

    func readFavorite(file: DriveFavoriteFile, maxBytes: Int, accessToken: String) async throws
        -> Data
    {
        guard Self.validHash(file.hash) else { throw DriveTransportError.invalidResponse }
        let data = try await readBytes(
            fileId: file.id, maxBytes: maxBytes, accessToken: accessToken
        )
        guard Self.sha256(data) == file.hash else { throw DriveTransportError.checksumMismatch }
        guard String(data: data, encoding: .utf8) != nil else {
            throw DriveTransportError.invalidUTF8
        }
        return data
    }

    private func checkedBytes(file: DriveRemoteFile, requireHash: Bool, accessToken: String)
        async throws -> Data
    {
        let expectedHash = file.appProperties["contextualContentHash"]
        if requireHash && expectedHash == nil { throw DriveTransportError.incompleteBackup }
        if let expectedHash, !Self.validHash(expectedHash) {
            throw DriveTransportError.invalidResponse
        }
        let data = try await readBytes(
            fileId: file.id, maxBytes: Self.materialByteLimit, accessToken: accessToken)
        if let expectedHash, Self.sha256(data) != expectedHash {
            throw DriveTransportError.checksumMismatch
        }
        guard String(data: data, encoding: .utf8) != nil else {
            throw DriveTransportError.invalidUTF8
        }
        return data
    }

    private func listFiles(query: String, accessToken: String) async throws -> [FileMetadata] {
        var files: [FileMetadata] = []
        var seenTokens = Set<String>()
        var seenIds = Set<String>()
        var pageToken: String?
        for _ in 0..<Self.maximumPages {
            var queryItems = [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(
                    name: "fields",
                    value:
                        "files(id,name,createdTime,modifiedTime,appProperties),nextPageToken,incompleteSearch"
                ),
                URLQueryItem(name: "pageSize", value: "1000"),
            ]
            if let pageToken {
                queryItems.append(URLQueryItem(name: "pageToken", value: pageToken))
            }
            let bytes = try await get(
                path: "/drive/v3/files", queryItems: queryItems, maxBytes: Self.pageByteLimit,
                accessToken: accessToken)
            let page: FilePage
            do { page = try JSONDecoder().decode(FilePage.self, from: bytes) } catch {
                throw DriveTransportError.invalidResponse
            }
            guard page.incompleteSearch != true else { throw DriveTransportError.incompleteCatalog }
            for file in page.files {
                guard Self.validFileId(file.id), seenIds.insert(file.id).inserted else {
                    throw DriveTransportError.invalidResponse
                }
                files.append(file)
                guard files.count <= Self.maximumFiles else {
                    throw DriveTransportError.tooManyFiles
                }
            }
            guard let next = page.nextPageToken else { return files }
            guard !next.isEmpty, next.utf8.count <= 4096, seenTokens.insert(next).inserted else {
                throw DriveTransportError.invalidPagination
            }
            pageToken = next
        }
        throw DriveTransportError.tooManyFiles
    }

    private func readBytes(fileId: String, maxBytes: Int, accessToken: String) async throws -> Data
    {
        guard Self.validFileId(fileId) else { throw DriveTransportError.invalidFileReference }
        guard maxBytes > 0 && maxBytes <= Self.materialByteLimit else {
            throw DriveTransportError.tooLarge
        }
        return try await get(
            path: "/drive/v3/files/" + fileId,
            queryItems: [URLQueryItem(name: "alt", value: "media")],
            maxBytes: maxBytes,
            accessToken: accessToken
        )
    }

    private func get(path: String, queryItems: [URLQueryItem], maxBytes: Int, accessToken: String)
        async throws -> Data
    {
        try Task.checkCancellation()
        guard !accessToken.isEmpty, accessToken.utf8.count <= 8192,
            accessToken.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e })
        else { throw DriveTransportError.invalidAccessToken }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "www.googleapis.com"
        components.path = path
        components.queryItems = queryItems
        guard let url = components.url else { throw DriveTransportError.invalidFileReference }
        var request = URLRequest(
            url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.httpMethod = "GET"
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (stream, response) = try await session.bytes(
                for: request, delegate: RejectRedirects())
            defer { stream.task.cancel() }
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse,
                response.url?.scheme == "https", response.url?.host == "www.googleapis.com"
            else { throw DriveTransportError.invalidResponse }
            switch response.statusCode {
            case 200: break
            case 401: throw DriveTransportError.unauthorized
            case 403: throw DriveTransportError.forbidden
            case 404: throw DriveTransportError.missingFile
            default: throw DriveTransportError.httpStatus(response.statusCode)
            }
            guard response.expectedContentLength <= Int64(maxBytes) else {
                throw DriveTransportError.tooLarge
            }
            var data = Data()
            if response.expectedContentLength > 0 {
                data.reserveCapacity(Int(response.expectedContentLength))
            }
            for try await byte in stream {
                guard data.count < maxBytes else { throw DriveTransportError.tooLarge }
                data.append(byte)
                if data.count.isMultiple(of: 4096) { try Task.checkCancellation() }
            }
            try Task.checkCancellation()
            return data
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw error
        }
    }

    private static func normalizedProperties(_ properties: [String: String]) -> [String: String] {
        var result = properties
        for (key, value) in properties where key.hasPrefix("immersive") {
            let canonical = "contextual" + key.dropFirst("immersive".count)
            if result[canonical] == nil { result[canonical] = value }
        }
        return result
    }

    private static func validFileId(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256
            && value.utf8.allSatisfy {
                (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0)
                    || $0 == 45 || $0 == 95
            }
    }

    private static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64
            && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private struct FilePage: Decodable {
    let files: [FileMetadata]
    let nextPageToken: String?
    let incompleteSearch: Bool?
}

private struct FileMetadata: Decodable {
    let id: String
    let name: String?
    let createdTime: String?
    let modifiedTime: String?
    let appProperties: [String: String]
}

private struct DownloadMetadata: Decodable {
    let id: String
    let schemaVersion: DownloadSchema
    let markdownHash: String?
}

private enum DownloadSchema: Decodable {
    case integer(Int)
    case string(String)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Int.self) {
            self = .integer(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
