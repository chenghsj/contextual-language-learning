import XCTest

@testable import ContextualLearning

@MainActor
final class CloudDownloadBatchTests: XCTestCase {
    func testSequentialDownloadsDeduplicateSkipAndContinueAfterItemFailure() async throws {
        let batch = CloudDownloadBatch()
        var order: [String] = []
        var active = 0
        var maximumActive = 0
        let task = try XCTUnwrap(
            batch.start(
                [material("a"), material("b"), material("a"), material("c"), favorite("d")],
                category: .materials
            ) { target in
                active += 1
                maximumActive = max(active, maximumActive)
                defer { active -= 1 }
                order.append(target.title)
                await Task.yield()
                if target.title == "b" { return false }
                if target.title == "c" { throw DriveTransportError.checksumMismatch }
                return true
            })
        await task.value
        XCTAssertEqual(order, ["a", "b", "c", "d"])
        XCTAssertEqual(maximumActive, 1)
        XCTAssertEqual(batch.progress?.total, 4)
        XCTAssertEqual(batch.progress?.completed, 4)
        XCTAssertEqual(batch.progress?.downloaded, 2)
        XCTAssertEqual(batch.progress?.skipped, 1)
        XCTAssertEqual(batch.progress?.failures.map(\.title), ["c"])
        XCTAssertNil(batch.progress?.stopReason)
        XCTAssertNil(batch.progress?.currentTitle)
        XCTAssertFalse(batch.isRunning)
    }

    func testCancelStopsQueuedItemsAndRetainsCompletedDownloads() async throws {
        let batch = CloudDownloadBatch()
        let started = expectation(description: "Second download started")
        let gate = Gate(started)
        var order: [String] = []
        let task = try XCTUnwrap(
            batch.start([material("a"), material("b"), material("c")], category: .materials) {
                target in
                order.append(target.title)
                if target.title == "b" { return try await gate.wait() }
                return true
            })
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(batch.progress?.downloaded, 1)
        XCTAssertEqual(batch.progress?.currentTitle, "b")
        batch.cancel()
        XCTAssertTrue(batch.isRunning)
        XCTAssertTrue(batch.isCancelling)
        XCTAssertNil(batch.start([favorite("new")], category: .favorites) { _ in true })
        gate.finish(.failure(URLError(.cancelled)))
        await task.value
        XCTAssertEqual(order, ["a", "b"])
        XCTAssertEqual(batch.progress?.downloaded, 1)
        XCTAssertEqual(batch.progress?.completed, 1)
        XCTAssertEqual(batch.progress?.failures.count, 0)
        XCTAssertEqual(batch.progress?.wasCancelled, true)
        XCTAssertFalse(batch.isRunning)
        XCTAssertFalse(batch.isCancelling)
    }

    func testCancellationDuringCommitStillCountsSavedItem() async throws {
        let batch = CloudDownloadBatch()
        let started = expectation(description: "Committing download")
        let gate = Gate(started)
        var calls = 0
        let task = try XCTUnwrap(
            batch.start([material("a"), material("b")], category: .materials) { _ in
                calls += 1
                return try await gate.wait()
            })
        await fulfillment(of: [started], timeout: 3)
        batch.cancel()
        gate.finish(.success(true))
        await task.value
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(batch.progress?.downloaded, 1)
        XCTAssertEqual(batch.progress?.completed, 1)
        XCTAssertEqual(batch.progress?.wasCancelled, true)
    }

    func testAccountResetDiscardsLateWorkAndCannotOverwriteNewBatch() async throws {
        let batch = CloudDownloadBatch()
        let started = expectation(description: "Old account download")
        let gate = Gate(started)
        let oldTask = try XCTUnwrap(
            batch.start([material("old")], category: .materials) { _ in try await gate.wait() })
        await fulfillment(of: [started], timeout: 3)
        batch.reset()
        XCTAssertNil(batch.progress)
        let newTask = try XCTUnwrap(
            batch.start([favorite("new")], category: .favorites) { _ in true })
        await newTask.value
        gate.finish(.success(true))
        await oldTask.value
        XCTAssertEqual(batch.progress?.category, .favorites)
        XCTAssertEqual(batch.progress?.total, 1)
        XCTAssertEqual(batch.progress?.downloaded, 1)
        XCTAssertEqual(batch.progress?.wasCancelled, false)
        XCTAssertFalse(batch.isRunning)
    }

    func testAuthorizationFailureStopsBatchAndEmptyInputDoesNotStart() async throws {
        for error in [
            DriveTransportError.unauthorized as Error,
            DriveTransportError.invalidAccessToken as Error,
            GoogleAuthorizationError.disconnected as Error,
        ] {
            let batch = CloudDownloadBatch()
            var calls = 0
            XCTAssertNil(batch.start([], category: .materials) { _ in true })
            XCTAssertFalse(batch.isRunning)
            let task = try XCTUnwrap(
                batch.start([material("a"), material("b")], category: .materials) { _ in
                    calls += 1
                    throw error
                })
            await task.value
            XCTAssertEqual(calls, 1)
            XCTAssertEqual(batch.progress?.completed, 1)
            XCTAssertEqual(batch.progress?.failures.count, 1)
            XCTAssertNotNil(batch.progress?.stopReason)
            XCTAssertFalse(batch.isRunning)
        }
    }

    func testPendingPlanRespectsAccountKindConflictsAndExistingDownloads() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "CloudDownloadBatchTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            try? FileManager.default.removeItem(at: root)
            defaults.removePersistentDomain(forName: suite)
        }
        let account = try GoogleAccount(id: "account-a", email: "reader@example.org")
        defaults.set(
            try JSONEncoder().encode(account), forKey: "GoogleAuthorization.lastKnownAccount")
        let repository = LibraryRepository(root: root, contract: ContractEngine())
        var conflicted = item("conflict")
        conflicted.conflict = true
        let custom = DriveLibraryItem(
            documentId: "SAVED", kind: .custom, title: "SAVED", sourceTitle: "",
            language: "en", createdAt: "", schema: "custom-v1", conflict: false)
        try await repository.saveCloudInventory(
            CloudInventory(
                accountID: account.id,
                materials: [item("SAVED"), conflicted, item("new"), custom, item("other-account")],
                favorites: [cloudFavorite("saved-favorite"), cloudFavorite("new-favorite")]))
        let library = LibraryModel(repository: repository)
        library.apply(
            LibrarySnapshot(
                sequence: 10,
                materials: [
                    summary("saved", namespace: "google:account-a"),
                    summary("other-account", namespace: "google:account-b"),
                    summary("favorite", namespace: "google:account-a:favorite:saved-favorite"),
                ]))
        let cloud = CloudLibraryModel(
            library: library, repository: repository,
            authorization: GoogleAuthorization(infoDictionary: [:], defaults: defaults),
            contract: ContractEngine())
        await cloud.activateAccount()
        XCTAssertEqual(
            cloud.pendingDownloads(in: .materials).map(\.id),
            ["material:standard:new", "material:custom:SAVED", "material:standard:other-account"])
        XCTAssertEqual(cloud.pendingDownloads(in: .favorites).map(\.id), ["favorite:new-favorite"])
        let chosen: Set<String> = [
            "material:standard:new", "material:standard:SAVED", "material:standard:conflict",
            "favorite:new-favorite", "missing",
        ]
        XCTAssertEqual(
            cloud.selectedDownloads(chosen, in: .materials).map(\.id), ["material:standard:new"])
        XCTAssertEqual(
            cloud.selectedDownloads(chosen, in: .favorites).map(\.id), ["favorite:new-favorite"])
        XCTAssertEqual(cloud.localCopies(chosen, in: .materials), ["google:account-a:saved"])
        XCTAssertEqual(
            cloud.localCopies(["favorite:saved-favorite"], in: .favorites),
            ["google:account-a:favorite:saved-favorite:favorite"])
        XCTAssertTrue(cloud.selectedDownloads([], in: .materials).isEmpty)
        cloud.downloadSelected(chosen, in: .materials)
        XCTAssertFalse(cloud.batch.isRunning, "Offline identity must not authorize downloads")
    }

    private func item(_ id: String) -> DriveLibraryItem {
        DriveLibraryItem(
            documentId: id, kind: .standard, title: id, sourceTitle: "", language: "en",
            createdAt: "", schema: "7", conflict: false)
    }

    private func material(_ id: String) -> CloudDownloadTarget { .material(item(id)) }
    private func favorite(_ id: String) -> CloudDownloadTarget { .favorite(cloudFavorite(id)) }

    private func cloudFavorite(_ id: String) -> CloudFavorite {
        CloudFavorite(
            key: id, title: id, sourceTitle: "", language: "en", excerpt: "", catalog: "",
            source: DriveFavoriteFile(id: id, operationId: id, hash: "", schema: ""))
    }

    private func summary(_ id: String, namespace: String) -> MaterialSummary {
        MaterialSummary(
            namespace: namespace, id: namespace + ":" + id, documentID: id, title: id,
            language: "en", kind: .standard, revision: "", byteCount: 0, importedAt: .now,
            sourceTitle: "", sceneIDs: [])
    }

    private final class Gate {
        let started: XCTestExpectation
        private var continuation: CheckedContinuation<Bool, Error>?
        init(_ started: XCTestExpectation) { self.started = started }
        func wait() async throws -> Bool {
            try await withCheckedThrowingContinuation {
                continuation = $0
                started.fulfill()
            }
        }
        func finish(_ result: Result<Bool, Error>) {
            continuation?.resume(with: result)
            continuation = nil
        }
    }
}
