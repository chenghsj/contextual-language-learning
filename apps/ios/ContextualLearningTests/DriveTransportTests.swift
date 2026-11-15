import CryptoKit
import Foundation
import UIKit
import XCTest

@testable import ContextualLearning

final class DriveTransportTests: XCTestCase {
    private let documentId = "6e112203-27f6-4ed3-99f6-b120edfe903e"

    @MainActor
    func testModelRedownloadUpdatesCopyReportsUnchangedAndPreservesCopyOnFailure() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: "sample-lesson", withExtension: "json"))
        var document = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        document["id"] = documentId
        let oldBytes = try JSONSerialization.data(withJSONObject: document, options: .sortedKeys)
        var source = try XCTUnwrap(document["source"] as? [String: Any])
        source["title"] = "Updated cloud lesson"
        document["source"] = source
        let updated = try JSONSerialization.data(withJSONObject: document, options: .sortedKeys)
        let listing = ResponsePlan.json([
            "files": [standardFile("latest-file", hash: hash(updated))]
        ])
        let scenario = Scenario([
            listing, .bytes(updated), listing, .bytes(updated), listing,
            ResponsePlan(status: 403, body: Data(), headers: [:]),
        ])
        let account = try GoogleAccount(id: "test-account", email: "reader@example.org")
        let auth = DownloadTestAuthorization(account: account, token: scenario.token)
        let contract = ContractEngine()
        let repository = LibraryRepository(root: root, contract: contract)
        let previous = try await repository.store(
            ImportPayload(
                format: .json, original: oldBytes, pairedMarkdown: nil, suggestedName: "old"),
            namespace: "google:" + account.id)
        let stale = DriveLibraryItem(
            documentId: documentId, kind: .standard, title: "old", sourceTitle: "", language: "en",
            createdAt: "", schema: "7",
            json: DriveRemoteFile(
                id: "old-file", name: "old", createdTime: nil, modifiedTime: nil,
                appProperties: ["contextualContentHash": String(repeating: "0", count: 64)]),
            conflict: false)
        try await repository.saveCloudInventory(
            CloudInventory(accountID: account.id, materials: [stale], favorites: []))
        let library = LibraryModel(repository: repository)
        await library.load()
        let cloud = CloudLibraryModel(
            library: library, repository: repository, authorization: auth,
            transport: scenario.transport, contract: contract)
        await cloud.activateAccount()
        let key = "material:" + stale.id
        let first = try XCTUnwrap(cloud.download(stale))
        await first.value
        XCTAssertEqual(cloud.downloadFeedback[key]?.isError, false)
        XCTAssertEqual(cloud.downloadFeedback[key]?.message, "下載完成，已更新本機副本")
        XCTAssertEqual(library.snapshot.materials.first?.title, "Updated cloud lesson")
        XCTAssertNotEqual(
            library.snapshot.materials.first?.revision, previous.materials.first?.revision)
        XCTAssertEqual(cloud.inventory?.materials.first?.json?.id, "latest-file")
        let second = try XCTUnwrap(cloud.download(stale))
        await second.value
        XCTAssertEqual(cloud.downloadFeedback[key]?.message, "已是最新版本")
        let revision = library.snapshot.materials.first?.revision
        let third = try XCTUnwrap(cloud.download(stale))
        await third.value
        XCTAssertEqual(cloud.downloadFeedback[key]?.isError, true)
        XCTAssertEqual(library.snapshot.materials.first?.revision, revision)
        XCTAssertNil(
            library.failure, "Sheet failures must be visible inline, not queued on the covered root"
        )
        XCTAssertTrue(cloud.downloads.isEmpty)
    }

    func testRedownloadRefreshesStaleFileReferenceAndChecksumBeforeFetchingContent() async throws {
        let bytes = Data(
            "{\"id\":\"\(documentId)\",\"schemaVersion\":7,\"title\":\"updated\"}".utf8)
        let stale = DriveLibraryItem(
            documentId: documentId, kind: .standard, title: "old", sourceTitle: "", language: "en",
            createdAt: "", schema: "7",
            json: DriveRemoteFile(
                id: "old-file", name: "old", createdTime: nil, modifiedTime: nil,
                appProperties: ["contextualContentHash": String(repeating: "0", count: 64)]),
            conflict: false)
        let scenario = Scenario([
            .json(["files": [standardFile("latest-file", hash: hash(bytes))]]), .bytes(bytes),
        ])
        let value = try await scenario.transport.download(
            item: stale, accessToken: scenario.token, refreshMetadata: true)
        XCTAssertEqual(value.jsonData, bytes)
        XCTAssertEqual(value.item.json?.id, "latest-file")
        XCTAssertEqual(
            scenario.requests.map { $0.url?.lastPathComponent }, ["files", "latest-file"])
    }

    func testReadsVideoPlatformFromLegacyMaterialContentAndChecksIdentity() async throws {
        for platform in ["youtube", "netflix"] {
            let bytes = try JSONSerialization.data(withJSONObject: [
                "id": documentId, "schemaVersion": 7, "source": ["platform": platform],
            ])
            let scenario = Scenario([
                .json(["files": [standardFile("metadata", hash: hash(bytes))]]), .bytes(bytes),
            ])
            let items = try await scenario.transport.listLibrary(accessToken: scenario.token)
            let item = try XCTUnwrap(items.first)
            XCTAssertNil(item.sourcePlatform)
            let result = try await scenario.transport.sourcePlatform(
                item: item, accessToken: scenario.token)
            XCTAssertEqual(result, platform)
            XCTAssertEqual(scenario.requests.count, 2)
        }
        let bytes = try JSONSerialization.data(withJSONObject: [
            "id": "ce112203-27f6-4ed3-99f6-b120edfe903e", "schemaVersion": 7,
            "source": ["platform": "netflix"],
        ])
        let scenario = Scenario([
            .json(["files": [standardFile("wrong", hash: hash(bytes))]]), .bytes(bytes),
        ])
        let items = try await scenario.transport.listLibrary(accessToken: scenario.token)
        await assertError(.documentIdentityMismatch) {
            _ = try await scenario.transport.sourcePlatform(
                item: try XCTUnwrap(items.first), accessToken: scenario.token)
        }
    }

    func testSourceMetadataUsesAppPropertiesWhenAvailableAndLegacyCacheDecodes() async throws {
        var remote = standardFile("file")
        var properties = try XCTUnwrap(remote["appProperties"] as? [String: String])
        properties["contextualSourcePlatform"] = "youtube"
        remote["appProperties"] = properties
        let scenario = Scenario([.json(["files": [remote]])])
        let items = try await scenario.transport.listLibrary(accessToken: scenario.token)
        XCTAssertEqual(items.first?.sourcePlatform, "youtube")
        var old = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(try XCTUnwrap(items.first)))
                as? [String: Any])
        old.removeValue(forKey: "sourcePlatform")
        let decoded = try JSONDecoder().decode(
            DriveLibraryItem.self, from: JSONSerialization.data(withJSONObject: old))
        XCTAssertNil(decoded.sourcePlatform)
        XCTAssertEqual(decoded.id, items.first?.id)
    }

    func testListsEveryPageUsingAuthenticatedGETAndNormalizesLegacyProperties() async throws {
        let scenario = Scenario([
            .json([
                "files": [
                    file(
                        "old",
                        properties: [
                            "immersiveDocumentId": documentId, "immersiveFormat": "json",
                            "immersiveSchemaVersion": "7", "immersiveTitle": "舊名稱教材",
                        ])
                ], "nextPageToken": "page-two",
            ]),
            .json([
                "files": [
                    file(
                        "ignored",
                        properties: [
                            "contextualDocumentId": documentId, "contextualFormat": "json",
                            "contextualSchemaVersion": "6",
                        ])
                ]
            ]),
        ])
        let items = try await scenario.transport.listLibrary(accessToken: scenario.token)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.id, "standard:" + documentId)
        XCTAssertEqual(items.first?.title, "舊名稱教材")
        XCTAssertEqual(items.first?.json?.appProperties["contextualSchemaVersion"], "7")
        XCTAssertEqual(scenario.requests.count, 2)
        for request in scenario.requests {
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.host, "www.googleapis.com")
            XCTAssertEqual(request.url?.scheme, "https")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"), "Bearer " + scenario.token)
        }
        let query = URLComponents(
            url: try XCTUnwrap(scenario.requests.last?.url), resolvingAgainstBaseURL: false)?
            .queryItems
        XCTAssertEqual(query?.first(where: { $0.name == "pageToken" })?.value, "page-two")
    }

    func testDuplicateFormatMarksOnlyThatDocumentConflictedAndSortsDeterministically() async throws
    {
        let secondId = "ce112203-27f6-4ed3-99f6-b120edfe903e"
        let scenario = Scenario([
            .json([
                "files": [
                    standardFile("first"), standardFile("duplicate"),
                    file(
                        "other",
                        properties: properties(
                            document: secondId, createdAt: "2026-10-25T00:00:00Z")),
                ]
            ])
        ])
        let items = try await scenario.transport.listLibrary(accessToken: scenario.token)
        XCTAssertEqual(items.map(\.documentId), [secondId, documentId])
        XCTAssertEqual(items.map(\.conflict), [false, true])
        await assertError(.conflictingBackups) {
            _ = try await scenario.transport.download(item: items[1], accessToken: scenario.token)
        }
        XCTAssertEqual(scenario.requests.count, 1)
    }

    func testRefusesIncompleteMalformedAndLoopingInventories() async throws {
        for response in [
            ResponsePlan.json(["files": [], "incompleteSearch": true]),
            .json(["files": "invalid"]),
            .json([
                "files": [["id": "file", "name": "file", "appProperties": ["contextualFormat": 7]]]
            ]),
        ] {
            let scenario = Scenario([response])
            do {
                _ = try await scenario.transport.listLibrary(accessToken: scenario.token)
                XCTFail("Invalid catalog was accepted")
            } catch let error as DriveTransportError {
                XCTAssertTrue([.incompleteCatalog, .invalidResponse].contains(error))
            }
        }
        let scenario = Scenario([
            .json(["files": [], "nextPageToken": "repeat"]),
            .json(["files": [], "nextPageToken": "repeat"]),
        ])
        await assertError(.invalidPagination) {
            _ = try await scenario.transport.listLibrary(accessToken: scenario.token)
        }
        XCTAssertEqual(scenario.requests.count, 2)
    }

    func testRefusesDuplicateFileIDsAcrossPages() async throws {
        let scenario = Scenario([
            .json(["files": [standardFile("same")], "nextPageToken": "second"]),
            .json(["files": [standardFile("same")]]),
        ])
        await assertError(.invalidResponse) {
            _ = try await scenario.transport.listLibrary(accessToken: scenario.token)
        }
    }

    func testDownloadsOriginalStandardBytesAfterChecksumAndIdentityValidation() async throws {
        let original = Data("{\n\"id\":\"\(documentId)\",\"schemaVersion\":7}\n".utf8)
        let scenario = Scenario([
            .json(["files": [standardFile("standard", hash: hash(original))]]),
            .bytes(original),
        ])
        let itemList = try await scenario.transport.listLibrary(accessToken: scenario.token)
        let item = try XCTUnwrap(itemList.first)
        let result = try await scenario.transport.download(item: item, accessToken: scenario.token)
        XCTAssertEqual(result.jsonData, original)
        XCTAssertNil(result.markdownData)
        XCTAssertEqual(result.documentId, documentId)
        XCTAssertEqual(result.kind, .standard)
        XCTAssertEqual(scenario.requests.last?.url?.path, "/drive/v3/files/standard")
        XCTAssertEqual(
            URLComponents(
                url: try XCTUnwrap(scenario.requests.last?.url), resolvingAgainstBaseURL: false)?
                .queryItems?.first?.value, "media")
    }

    func testAcceptsLegacyStandardWithoutHashButRejectsRecordedHashMismatch() async throws {
        let content = Data("{\"id\":\"\(documentId)\",\"schemaVersion\":7}".utf8)
        for expectedHash in [String?.none, String(repeating: "0", count: 64)] {
            let scenario = Scenario([
                .json(["files": [standardFile("standard", hash: expectedHash)]]), .bytes(content),
            ])
            let itemList = try await scenario.transport.listLibrary(accessToken: scenario.token)
            let item = try XCTUnwrap(itemList.first)
            if expectedHash == nil {
                let result = try await scenario.transport.download(
                    item: item, accessToken: scenario.token)
                XCTAssertEqual(result.jsonData, content)
            } else {
                await assertError(.checksumMismatch) {
                    _ = try await scenario.transport.download(
                        item: item, accessToken: scenario.token)
                }
            }
        }
    }

    func testRejectsWrongDownloadedIdentityAndSchema() async throws {
        for content in [
            Data("{\"id\":\"ce112203-27f6-4ed3-99f6-b120edfe903e\",\"schemaVersion\":7}".utf8),
            Data("{\"id\":\"\(documentId)\",\"schemaVersion\":6}".utf8),
        ] {
            let scenario = Scenario([.json(["files": [standardFile("standard")]]), .bytes(content)])
            let itemList = try await scenario.transport.listLibrary(accessToken: scenario.token)
            let item = try XCTUnwrap(itemList.first)
            do {
                _ = try await scenario.transport.download(item: item, accessToken: scenario.token)
                XCTFail("Wrong identity or schema was accepted")
            } catch let error as DriveTransportError {
                XCTAssertTrue([.documentIdentityMismatch, .invalidResponse].contains(error))
            }
        }
    }

    func testDownloadsCustomPairUsingPropertiesAndAllThreeHashes() async throws {
        let markdown = Data("# 例句\n\nありがとうございます。".utf8)
        let metadata = try JSONSerialization.data(withJSONObject: [
            "id": documentId, "schemaVersion": "custom-v1", "markdownHash": hash(markdown),
        ])
        let scenario = Scenario([
            .json(["files": customFiles(metadata: metadata, markdown: markdown)]),
            .bytes(metadata), .bytes(markdown),
        ])
        let itemList = try await scenario.transport.listLibrary(accessToken: scenario.token)
        let item = try XCTUnwrap(itemList.first)
        let result = try await scenario.transport.download(item: item, accessToken: scenario.token)
        XCTAssertEqual(result.kind, .custom)
        XCTAssertEqual(result.jsonData, metadata)
        XCTAssertEqual(result.markdownData, markdown)
        XCTAssertEqual(
            scenario.requests.map { $0.url?.lastPathComponent }, ["files", "metadata", "markdown"])
    }

    func testRejectsCustomMissingPairHashAndMismatchedMarkdown() async throws {
        let markdown = Data("# Content".utf8)
        let metadata = try JSONSerialization.data(withJSONObject: [
            "id": documentId, "schemaVersion": "custom-v1",
            "markdownHash": String(repeating: "0", count: 64),
        ])
        var missingHash = customFiles(metadata: metadata, markdown: markdown)
        var properties = try XCTUnwrap(missingHash[0]["appProperties"] as? [String: String])
        properties.removeValue(forKey: "contextualContentHash")
        missingHash[0]["appProperties"] = properties
        let noHash = Scenario([.json(["files": missingHash])])
        let noHashItemList = try await noHash.transport.listLibrary(accessToken: noHash.token)
        let noHashItem = try XCTUnwrap(noHashItemList.first)
        await assertError(.incompleteBackup) {
            _ = try await noHash.transport.download(item: noHashItem, accessToken: noHash.token)
        }
        let wrongPair = Scenario([
            .json(["files": customFiles(metadata: metadata, markdown: markdown)]),
            .bytes(metadata), .bytes(markdown),
        ])
        let wrongItemList = try await wrongPair.transport.listLibrary(accessToken: wrongPair.token)
        let wrongItem = try XCTUnwrap(wrongItemList.first)
        await assertError(.customContentMismatch) {
            _ = try await wrongPair.transport.download(
                item: wrongItem, accessToken: wrongPair.token)
        }
        let missingPair = Scenario([
            .json(["files": [customFiles(metadata: metadata, markdown: markdown)[0]]]),
            .bytes(metadata),
        ])
        let missingItemList = try await missingPair.transport.listLibrary(
            accessToken: missingPair.token)
        let missingItem = try XCTUnwrap(missingItemList.first)
        await assertError(.incompleteBackup) {
            _ = try await missingPair.transport.download(
                item: missingItem, accessToken: missingPair.token)
        }
    }

    func testRejectsInvalidUTF8AndAnnouncedOverLimitBeforeReadingBody() async throws {
        for plan in [
            ResponsePlan.bytes(Data([0xc3, 0x28])),
            .bytes(Data(), headers: ["Content-Length": "25000001"]),
        ] {
            let scenario = Scenario([.json(["files": [standardFile("standard")]]), plan])
            let itemList = try await scenario.transport.listLibrary(accessToken: scenario.token)
            let item = try XCTUnwrap(itemList.first)
            do {
                _ = try await scenario.transport.download(item: item, accessToken: scenario.token)
                XCTFail("Invalid content was accepted")
            } catch let error as DriveTransportError {
                XCTAssertTrue([.invalidUTF8, .tooLarge].contains(error))
            }
        }
    }

    func testEnforcesStreamLimitWithoutContentLength() async throws {
        let bytes = Data("12345".utf8)
        let scenario = Scenario([.bytes(bytes)])
        let reference = DriveFavoriteFile(
            id: "favorite", operationId: documentId, hash: hash(bytes), schema: "1")
        await assertError(.tooLarge) {
            _ = try await scenario.transport.readFavorite(
                file: reference, maxBytes: 4, accessToken: scenario.token)
        }
    }

    func testFavoriteInventoryAndReadPreserveRawBytesForCoreValidation() async throws {
        let bytes = Data("{ \"operationId\": \"\(documentId)\" }\n".utf8)
        let collection = String(repeating: "a", count: 64)
        let scenario = Scenario([
            .json([
                "files": [
                    [
                        "id": "favorite",
                        "appProperties": [
                            "contextualKind": "favorite-catalog-operation",
                            "contextualFavoriteCollection": collection,
                            "contextualFavoriteOperation": documentId,
                            "contextualContentHash": hash(bytes), "contextualFavoriteSchema": "1",
                        ],
                    ]
                ]
            ]), .bytes(bytes),
        ])
        let files = try await scenario.transport.listFavoriteFiles(
            collectionId: collection, kind: .catalog, accessToken: scenario.token)
        XCTAssertEqual(files.count, 1)
        let data = try await scenario.transport.readFavorite(
            file: try XCTUnwrap(files.first), maxBytes: 1024, accessToken: scenario.token)
        XCTAssertEqual(data, bytes)
        await assertError(.invalidCollection) {
            _ = try await scenario.transport.listFavoriteFiles(
                collectionId: "injected' query", kind: .catalog, accessToken: scenario.token)
        }
        XCTAssertEqual(scenario.requests.count, 2)
    }

    func testHTTPFailuresAreTypedAndNeverAutomaticallyRetried() async throws {
        let cases: [(Int, DriveTransportError)] = [
            (401, .unauthorized), (403, .forbidden), (404, .missingFile), (429, .httpStatus(429)),
            (503, .httpStatus(503)), (302, .httpStatus(302)),
        ]
        for (status, expected) in cases {
            let scenario = Scenario([ResponsePlan(status: status, body: Data(), headers: [:])])
            await assertError(expected) {
                _ = try await scenario.transport.listLibrary(accessToken: scenario.token)
            }
            XCTAssertEqual(scenario.requests.count, 1)
        }
    }

    func testRefusesInvalidBearerAndFileReferenceBeforeNetwork() async throws {
        let scenario = Scenario([])
        await assertError(.invalidAccessToken) {
            _ = try await scenario.transport.listLibrary(accessToken: "token\r\nInjected: value")
        }
        let reference = DriveFavoriteFile(
            id: "../untrusted?alt=media", operationId: documentId,
            hash: String(repeating: "a", count: 64), schema: "1")
        await assertError(.invalidFileReference) {
            _ = try await scenario.transport.readFavorite(
                file: reference, maxBytes: 100, accessToken: scenario.token)
        }
        XCTAssertTrue(scenario.requests.isEmpty)
    }

    func testRejectsRedirectBeforeAnyRequestToAnotherOrigin() async throws {
        let destination = try XCTUnwrap(URL(string: "https://untrusted.invalid/collect"))
        let scenario = Scenario([
            ResponsePlan(
                status: 302, body: Data(), headers: ["Location": destination.absoluteString],
                redirectTo: destination)
        ])
        do {
            _ = try await scenario.transport.listLibrary(accessToken: scenario.token)
            XCTFail("Redirected request succeeded")
        } catch {
            XCTAssertEqual(scenario.requests.count, 1)
        }
        XCTAssertEqual(scenario.requests.count, 1)
        XCTAssertEqual(scenario.requests.first?.url?.host, "www.googleapis.com")
    }

    func testCancellationWhileWaitingForResponsePropagates() async throws {
        let started = expectation(description: "request started")
        let scenario = Scenario([.waiting(started)])
        let task = Task { try await scenario.transport.listLibrary(accessToken: scenario.token) }
        await fulfillment(of: [started], timeout: 2)
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Cancelled request succeeded")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }

    private func properties(document: String? = nil, createdAt: String = "2026-10-24T00:00:00Z")
        -> [String: String]
    {
        [
            "contextualDocumentId": document ?? documentId, "contextualFormat": "json",
            "contextualSchemaVersion": "7", "contextualTitle": "教材",
            "contextualCreatedAt": createdAt,
        ]
    }

    private func standardFile(_ id: String, hash: String? = nil) -> [String: Any] {
        var values = properties()
        values["contextualContentHash"] = hash
        return file(id, properties: values)
    }

    private func file(_ id: String, properties: [String: String]) -> [String: Any] {
        ["id": id, "name": "unrelated-name-" + id, "appProperties": properties]
    }

    private func customFiles(metadata: Data, markdown: Data) -> [[String: Any]] {
        [
            file(
                "metadata",
                properties: [
                    "contextualDocumentId": documentId, "contextualFormat": "json",
                    "contextualSchemaVersion": "custom-v1", "contextualContentHash": hash(metadata),
                ]),
            file(
                "markdown",
                properties: [
                    "contextualDocumentId": documentId, "contextualFormat": "md",
                    "contextualSchemaVersion": "custom-v1", "contextualContentHash": hash(markdown),
                ]),
        ]
    }

    private func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func assertError(
        _ expected: DriveTransportError, operation: () async throws -> Void,
        file: StaticString = #filePath, line: UInt = #line
    ) async {
        do {
            try await operation()
            XCTFail("Expected \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(
                error as? DriveTransportError, expected, String(reflecting: error), file: file,
                line: line)
        }
    }
}

private struct ResponsePlan: @unchecked Sendable {
    let status: Int
    let body: Data
    let headers: [String: String]
    var started: XCTestExpectation?
    var redirectTo: URL?

    static func json(_ object: [String: Any]) -> Self {
        Self(
            status: 200, body: try! JSONSerialization.data(withJSONObject: object),
            headers: ["Content-Type": "application/json"])
    }

    static func bytes(_ data: Data, headers: [String: String] = [:]) -> Self {
        Self(status: 200, body: data, headers: headers)
    }

    static func waiting(_ started: XCTestExpectation) -> Self {
        Self(status: 200, body: Data(), headers: [:], started: started)
    }
}

private final class Scenario: @unchecked Sendable {
    let token = UUID().uuidString
    private let lock = NSLock()
    private var plans: [ResponsePlan]
    private var captured: [URLRequest] = []

    var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return captured
    }

    init(_ plans: [ResponsePlan]) {
        self.plans = plans
        StubURLProtocol.register(self)
    }

    deinit { StubURLProtocol.unregister(token: token) }

    var transport: DriveTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return DriveTransport(session: URLSession(configuration: configuration))
    }

    func next(_ request: URLRequest) -> ResponsePlan? {
        lock.lock()
        defer { lock.unlock() }
        captured.append(request)
        return plans.isEmpty ? nil : plans.removeFirst()
    }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    private final class Registry: @unchecked Sendable {
        let lock = NSLock()
        var values: [String: WeakScenario] = [:]
    }
    private struct WeakScenario { weak var value: Scenario? }
    private static let registry = Registry()

    static func register(_ scenario: Scenario) {
        registry.lock.lock()
        defer { registry.lock.unlock() }
        registry.values[scenario.token] = WeakScenario(value: scenario)
    }

    static func unregister(token: String) {
        registry.lock.lock()
        defer { registry.lock.unlock() }
        registry.values.removeValue(forKey: token)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let token =
            request.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(
                of: "Bearer ", with: "") ?? ""
        Self.registry.lock.lock()
        let scenario = Self.registry.values[token]?.value
        Self.registry.lock.unlock()
        guard let plan = scenario?.next(request), let url = request.url,
            let response = HTTPURLResponse(
                url: url, statusCode: plan.status, httpVersion: nil, headerFields: plan.headers)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        if let started = plan.started {
            started.fulfill()
            return
        }
        if let redirectTo = plan.redirectTo {
            var redirected = URLRequest(url: redirectTo)
            redirected.setValue(
                request.value(forHTTPHeaderField: "Authorization"),
                forHTTPHeaderField: "Authorization")
            client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: plan.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@MainActor
private final class DownloadTestAuthorization: GoogleAuthorizing {
    private(set) var lastKnownAccount: GoogleAccount?
    private var connected = true
    private let token: String
    var account: GoogleAccount? { connected ? lastKnownAccount : nil }
    var accountID: String? { account?.id }
    var state: GoogleAuthorizationState {
        if let account { return .connected(account) }
        return .disconnected
    }
    init(account: GoogleAccount, token: String) {
        lastKnownAccount = account
        self.token = token
    }
    func accessToken() async throws -> String {
        guard connected else { throw GoogleAuthorizationError.disconnected }
        return token
    }
    func signIn(presenting: UIViewController) async throws {
        throw GoogleAuthorizationError.unconfigured
    }
    func restoreIfConfigured() async {}
    func requireReauthentication() { connected = false }
    func signOut() {
        connected = false
        lastKnownAccount = nil
    }
    @discardableResult func handle(_ url: URL) -> Bool { false }
}
