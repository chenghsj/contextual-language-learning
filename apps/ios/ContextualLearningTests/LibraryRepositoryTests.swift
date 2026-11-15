import SQLite3
import XCTest

@testable import ContextualLearning

final class LibraryRepositoryTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    func testBatchRemovalTouchesOnlySelectedCopiesAndPrunesUnusedDocuments() async throws {
        let repository = make()
        _ = try await repository.store(note("# one", name: "one"))
        _ = try await repository.store(note("# two", name: "two"))
        let before = try await repository.store(note("# three", name: "three"))
        let keep = try XCTUnwrap(before.materials.first { $0.title == "three" })
        let chosen = Set(before.materials.filter { $0.id != keep.id }.map(\.id))
        let result = try await repository.remove(chosen)
        XCTAssertEqual(result.materials.map(\.id), [keep.id])
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 1)
        let retained = try await repository.read(keep.id)
        XCTAssertEqual(retained.markdown, "# three")
        let empty = try await repository.remove(Set<String>())
        XCTAssertEqual(empty.sequence, result.sequence)
        XCTAssertEqual(empty.materials, result.materials)
    }

    func testBatchRemovalRollsBackAllSelectedCopiesOnFailureOrCancellation() async throws {
        let repository = make()
        _ = try await repository.store(note("# one"))
        _ = try await repository.store(note("# two"))
        let before = try await repository.store(note("# three"))
        let chosen = Set(before.materials.map(\.id).sorted().prefix(2))
        let last = try XCTUnwrap(chosen.sorted().last)
        try execute(
            "CREATE TRIGGER fail_delete BEFORE DELETE ON materials WHEN OLD.storageID = '\(last)' BEGIN SELECT RAISE(ABORT, 'test fault'); END"
        )
        do {
            _ = try await repository.remove(chosen)
            XCTFail("Deletion did not roll back")
        } catch {}
        let after = try await repository.load()
        XCTAssertEqual(after.materials, before.materials)
        XCTAssertEqual(after.sequence, before.sequence)
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 3)
        try execute("DROP TRIGGER fail_delete")
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await repository.remove(chosen)
        }
        do {
            _ = try await task.value
            XCTFail("Cancelled deletion committed")
        } catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
        let cancelled = try await repository.load()
        XCTAssertEqual(cancelled.materials, before.materials)
    }

    @MainActor
    func testLibraryBatchRemovalRejectsHiddenAccountIDs() async throws {
        let repository = make()
        _ = try await repository.store(note("# local"))
        _ = try await repository.store(note("# a"), namespace: "google:a")
        let initial = try await repository.store(note("# b"), namespace: "google:b")
        let local = try XCTUnwrap(initial.materials.first { $0.namespace == "local" })
        let hidden = try XCTUnwrap(initial.materials.first { $0.namespace == "google:b" })
        let model = LibraryModel(repository: repository)
        model.cloudAccountID = "a"
        await model.load()
        let removed = await model.remove(Set([local.id, hidden.id]))
        XCTAssertTrue(removed)
        XCTAssertEqual(Set(model.snapshot.materials.map(\.namespace)), ["google:a", "google:b"])
        let rejected = await model.remove(Set([hidden.id]))
        XCTAssertFalse(rejected)
        XCTAssertFalse(model.isRemoving)
        XCTAssertNil(model.failure)
    }

    func testPlatformMetadataSurvivesRelaunchAndBackfillsVersionOneDatabase() async throws {
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "contract-corpus", withExtension: "json"))
        let corpus = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var input = try XCTUnwrap(
            (corpus["cases"] as? [[String: Any]])?.first?["input"] as? [String: Any])
        var source = try XCTUnwrap(input["source"] as? [String: Any])
        source["platform"] = "netflix"
        source["url"] = "https://www.netflix.com/watch/12345678"
        input["source"] = source
        let payload = ImportPayload(
            format: .json, original: try JSONSerialization.data(withJSONObject: input),
            pairedMarkdown: nil, suggestedName: "Video")
        let stored = try await make().store(payload)
        let first = try XCTUnwrap(stored.materials.first)
        XCTAssertEqual(first.sourcePlatform, "netflix")
        let reopened = try await make().load()
        XCTAssertEqual(reopened.materials.first?.sourcePlatform, "netflix")
        let storedBytes = try document(first.revision)
        try execute("ALTER TABLE materials DROP COLUMN sourcePlatform")
        try execute("PRAGMA user_version = 1")
        let migrated = try await make().load()
        XCTAssertEqual(migrated.materials.first?.sourcePlatform, "netflix")
        XCTAssertEqual(migrated.materials.first?.id, first.id)
        XCTAssertEqual(migrated.materials.first?.revision, first.revision)
        XCTAssertEqual(try scalar("PRAGMA user_version"), 2)
        XCTAssertEqual(try document(first.revision), storedBytes)
    }

    func testSourceDetectionDoesNotGuessFromTitlesOrLookalikeDomains() throws {
        XCTAssertEqual(VideoSourcePlatform.resolve(platform: "youtube"), .youtube)
        XCTAssertEqual(VideoSourcePlatform.resolve(platform: "netflix"), .netflix)
        XCTAssertEqual(
            VideoSourcePlatform.resolve(platform: nil, url: "https://youtu.be/aqz-KE-bpKQ"),
            .youtube)
        XCTAssertEqual(
            VideoSourcePlatform.resolve(platform: nil, url: "https://www.netflix.com/title/123"),
            .netflix)
        XCTAssertNil(
            VideoSourcePlatform.resolve(platform: nil, url: "https://youtube.com.evil.test/watch"))
        XCTAssertNil(
            VideoSourcePlatform.resolve(platform: nil, url: "https://netflix.com@evil.test/watch"))
        XCTAssertNil(VideoSourcePlatform.readPayload(note("# YouTube Netflix")))
        let custom = Data(
            "{\"schemaVersion\":\"custom-v1\",\"request\":{\"source\":{\"platform\":\"youtube\"}},\"source\":{\"platform\":\"netflix\"}}"
                .utf8)
        XCTAssertEqual(VideoSourcePlatform.readJSON(custom), .youtube)
        let favorite = Data("{\"snapshot\":{\"source\":{\"platform\":\"netflix\"}}}".utf8)
        XCTAssertEqual(VideoSourcePlatform.readJSON(favorite, favorite: true), .netflix)
    }

    func testDuplicateImportReopenAndExactOriginalBytes() async throws {
        let payload = note("# 原文\r\n\r\nbytes  ")
        let repository = make()
        let first = try await repository.store(payload)
        let second = try await repository.store(payload)
        XCTAssertEqual(first.materials, second.materials)
        XCTAssertEqual(first.sequence, second.sequence)
        let reopened = make()
        let third = try await reopened.load()
        XCTAssertEqual(third.materials, first.materials)
        let id = try XCTUnwrap(third.materials.first?.id)
        let reopenedMaterial = try await reopened.read(id)
        XCTAssertEqual(reopenedMaterial.markdown, "# 原文\r\n\r\nbytes  ")
        let stored = try JSONDecoder().decode(
            ImportPayload.self, from: document(try XCTUnwrap(third.materials.first?.revision)))
        XCTAssertEqual(stored.original, payload.original)
    }

    func testYouTubeProjectionRereadsOriginalPayloadWithoutMigration() async throws {
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "contract-corpus", withExtension: "json"))
        let corpus = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var input = try XCTUnwrap(
            (corpus["cases"] as? [[String: Any]])?.first?["input"] as? [String: Any])
        var source = try XCTUnwrap(input["source"] as? [String: Any])
        source["platform"] = "youtube"
        source["url"] = "https://youtu.be/aqz-KE-bpKQ?t=1"
        input["source"] = source
        input["playbackOverrides"] = ["cue-1": ["startMs": 83_000, "endMs": 85_000]]
        let original = try JSONSerialization.data(withJSONObject: input)
        let first = try await make().store(
            ImportPayload(
                format: .json, original: original, pairedMarkdown: nil, suggestedName: "YouTube"))
        let summary = try XCTUnwrap(first.materials.first)
        let bytesBefore = try document(summary.revision)
        let reopened = make()
        let material = try await reopened.read(summary.id)
        XCTAssertEqual(
            material.scenes.first?.groups.first?.rows.first?.playbackLink?.startMs, 83_000)
        XCTAssertEqual(try document(summary.revision), bytesBefore)
        XCTAssertEqual(
            try JSONDecoder().decode(ImportPayload.self, from: bytesBefore).original, original)
        let after = try await reopened.load()
        XCTAssertEqual(after.sequence, first.sequence)
        XCTAssertEqual(after.materials.first?.revision, summary.revision)
    }

    func testNamespacesShareDocumentAndCascadeOnlyLastReference() async throws {
        let repository = make()
        let payload = note("# shared")
        _ = try await repository.store(payload)
        let both = try await repository.store(payload, namespace: "google:account:collection")
        XCTAssertEqual(both.materials.count, 2)
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 1)
        let local = try XCTUnwrap(both.materials.first { $0.namespace == "local" })
        _ = try await repository.remove(local.id)
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 1)
        let cleared = try await repository.removeNamespacePrefix("google:account:")
        XCTAssertTrue(cleared.materials.isEmpty)
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 0)
        XCTAssertEqual(try scalar("PRAGMA foreign_key_check"), nil)
    }

    func testCorruptPayloadFailsReadAndReimportRepairsIt() async throws {
        let repository = make()
        let payload = note("# repair")
        let first = try await repository.store(payload)
        let id = try XCTUnwrap(first.materials.first?.id)
        try execute("UPDATE documents SET payload = x'62726f6b656e'")
        do {
            _ = try await repository.read(id)
            XCTFail("Corrupt payload accepted")
        } catch {}
        let repaired = try await repository.store(payload)
        XCTAssertEqual(repaired.materials, first.materials)
        XCTAssertGreaterThan(repaired.sequence, first.sequence)
        let repairedMaterial = try await repository.read(id)
        XCTAssertEqual(repairedMaterial.markdown, "# repair")
    }

    func testTriggerFailureRollsBackDocumentAndSummary() async throws {
        let repository = make()
        let first = try await repository.store(note("# kept"))
        try execute(
            "CREATE TRIGGER fail_insert BEFORE INSERT ON materials BEGIN SELECT RAISE(ABORT, 'test fault'); END"
        )
        do {
            _ = try await repository.store(note("# new"))
            XCTFail("Insert succeeded")
        } catch {}
        let afterFailure = try await repository.load()
        XCTAssertEqual(afterFailure.materials, first.materials)
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 1)
        XCTAssertEqual(try scalar("SELECT count(*) FROM materials"), 1)
    }

    func testBoundSearchTreatsSQLSyntaxAndWildcardsAsText() async throws {
        let repository = make()
        _ = try await repository.store(note("# one", name: "A%' OR 1=1 --"))
        _ = try await repository.store(note("# two", name: "ordinary"))
        let injected = try await repository.searchMaterials(query: "OR 1=1")
        XCTAssertEqual(injected.count, 1)
        let percent = try await repository.searchMaterials(query: "%")
        XCTAssertEqual(percent.count, 1)
        let underscore = try await repository.searchMaterials(query: "_")
        XCTAssertEqual(underscore.count, 0)
        let filtered = try await repository.searchMaterials(
            query: "", language: "unspecified", namespace: "local")
        XCTAssertEqual(filtered.count, 2)
    }

    func testCloudInventoryPersistsAndLogoutClearsAccountAtomically() async throws {
        let repository = make()
        _ = try await repository.store(note("# account"), namespace: "google:acct:collection")
        _ = try await repository.store(note("# other"), namespace: "google:acct2:collection")
        let inventory = CloudInventory(
            accountID: "acct", materials: [], favorites: [], updatedAt: .now)
        try await repository.saveCloudInventory(inventory)
        let reopened = make()
        let restoredInventory = try await reopened.loadCloudInventory(accountID: "acct")
        XCTAssertEqual(restoredInventory?.accountID, "acct")
        let after = try await reopened.removeCloudAccount("acct")
        XCTAssertEqual(after.materials.map(\.namespace), ["google:acct2:collection"])
        let clearedInventory = try await reopened.loadCloudInventory(accountID: "acct")
        XCTAssertNil(clearedInventory)
    }

    func testPositionSurvivesReopenAndReimportOfSameDocument() async throws {
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "contract-corpus", withExtension: "json"))
        let corpus = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let cases = try XCTUnwrap(corpus["cases"] as? [[String: Any]])
        let input = try XCTUnwrap(cases.first?["input"])
        let original = try JSONSerialization.data(withJSONObject: input)
        let repository = make()
        let first = try await repository.store(
            ImportPayload(
                format: .json, original: original, pairedMarkdown: nil, suggestedName: "one"))
        let summary = try XCTUnwrap(first.materials.first)
        let scene = try XCTUnwrap(summary.sceneIDs.first)
        let positioned = try await repository.savePosition(
            materialID: summary.id, sceneID: scene, groupID: "cue-1")
        XCTAssertEqual(positioned.positions[summary.id]?.sceneID, scene)
        let changed = try await repository.store(
            ImportPayload(
                format: .json, original: original, pairedMarkdown: nil, suggestedName: "two"))
        XCTAssertNotEqual(changed.materials.first?.revision, summary.revision)
        let reopened = try await make().load()
        XCTAssertEqual(reopened.positions[summary.id]?.sceneID, scene)
        XCTAssertEqual(reopened.positions[summary.id]?.groupID, "cue-1")
        XCTAssertEqual(try scalar("SELECT count(*) FROM documents"), 1)
        _ = try await repository.savePosition(
            materialID: summary.id, sceneID: scene, groupID: "removed-group")
        let pruned = try await repository.store(
            ImportPayload(
                format: .json, original: original, pairedMarkdown: nil, suggestedName: "three"))
        XCTAssertNil(pruned.positions[summary.id]?.groupID)
    }

    func testRepeatedReviewRemovalNeverRecreatesSnapshot() async throws {
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: "sample-lesson", withExtension: "json"))
        let repository = make()
        let first = try await repository.store(
            ImportPayload(
                format: .json, original: Data(contentsOf: url), pairedMarkdown: nil,
                suggestedName: "sample"))
        let summary = try XCTUnwrap(first.materials.first)
        let material = try await repository.read(summary.id)
        let scene = try XCTUnwrap(material.scenes.first)
        let group = try XCTUnwrap(scene.groups.first)
        let entry = ReviewEntry(
            id: "review-removal", materialID: summary.id, title: material.title,
            sceneTitle: scene.title, language: material.language, group: group, createdAt: .now)
        _ = try await repository.toggleReview(entry)
        _ = try await repository.removeReview(entry.id)
        let removedAgain = try await repository.removeReview(entry.id)
        XCTAssertTrue(removedAgain.review.isEmpty)
        XCTAssertEqual(removedAgain.materials.count, 1)
    }

    func testEmptyLegacyIndexDoesNotBlockDatabaseInitialization() async throws {
        let empty = Data(#"{"version":1,"materials":[],"positions":{},"review":[]}"#.utf8)
        try empty.write(to: root.appendingPathComponent("library.json"))
        let value = try await make().load()
        XCTAssertTrue(value.materials.isEmpty)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: root.appendingPathComponent("library.sqlite").path))
        XCTAssertEqual(
            try Data(contentsOf: root.appendingPathComponent("library.json")), empty)
    }

    func testCancelledImportCannotCommit() async throws {
        let repository = make()
        let task = Task { try await repository.store(note("# cancelled")) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Cancelled task committed")
        } catch {}
        let snapshot = try await repository.load()
        XCTAssertTrue(snapshot.materials.isEmpty)
    }

    func testReviewFollowsMaterialForeignKeyDeletion() async throws {
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "contract-corpus", withExtension: "json"))
        let corpus = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let input = try XCTUnwrap((corpus["cases"] as? [[String: Any]])?.first?["input"])
        let repository = make()
        let stored = try await repository.store(
            ImportPayload(
                format: .json,
                original: try JSONSerialization.data(withJSONObject: input), pairedMarkdown: nil,
                suggestedName: "fixture"))
        let summary = try XCTUnwrap(stored.materials.first)
        let material = try await repository.read(summary.id)
        let scene = try XCTUnwrap(material.scenes.first)
        let group = try XCTUnwrap(scene.groups.first)
        let entry = ReviewEntry(
            id: "review", materialID: summary.id, title: "title", sceneTitle: scene.title,
            language: summary.language, group: group, createdAt: .now)
        let reviewed = try await repository.toggleReview(entry)
        XCTAssertEqual(reviewed.review.count, 1)
        let deleted = try await repository.remove(summary.id)
        XCTAssertTrue(deleted.review.isEmpty)
        XCTAssertEqual(try scalar("SELECT count(*) FROM review"), 0)
    }

    func testLegacyManifestAndFutureSchemaAreNeverReset() async throws {
        let old = root.appendingPathComponent("library.json")
        try Data("existing".utf8).write(to: old)
        do {
            _ = try await make().load()
            XCTFail("Legacy data masked")
        } catch {}
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: root.appendingPathComponent("library.sqlite").path))
        try FileManager.default.removeItem(at: old)
        _ = try await make().load()
        try execute("PRAGMA user_version = 99")
        do {
            _ = try await make().load()
            XCTFail("Future schema accepted")
        } catch {}
        XCTAssertEqual(try scalar("PRAGMA user_version"), 99)
    }

    private func make() -> LibraryRepository {
        LibraryRepository(root: root, contract: ContractEngine())
    }
    private func note(_ text: String, name: String = "Note") -> ImportPayload {
        ImportPayload(
            format: .markdown, original: Data(text.utf8), pairedMarkdown: nil, suggestedName: name)
    }
    private func withDB<T>(_ body: (OpaquePointer) throws -> T) throws -> T {
        var db: OpaquePointer?
        guard
            sqlite3_open_v2(
                root.appendingPathComponent("library.sqlite").path, &db, SQLITE_OPEN_READWRITE, nil)
                == SQLITE_OK, let db
        else {
            throw ImportFailure.invalid("Test SQLite open failed")
        }
        defer { sqlite3_close(db) }
        return try body(db)
    }
    private func execute(_ sql: String) throws {
        try withDB { db in
            guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
                throw ImportFailure.invalid(String(cString: sqlite3_errmsg(db)))
            }
        }
    }
    private func scalar(_ sql: String) throws -> Int? {
        try withDB { db in
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
                throw ImportFailure.invalid(String(cString: sqlite3_errmsg(db)))
            }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
            return Int(sqlite3_column_int64(statement, 0))
        }
    }
    private func document(_ revision: String) throws -> Data {
        try withDB { db in
            var statement: OpaquePointer?
            guard
                sqlite3_prepare_v2(
                    db, "SELECT payload FROM documents WHERE revision = ?", -1, &statement, nil)
                    == SQLITE_OK
            else {
                throw ImportFailure.invalid(String(cString: sqlite3_errmsg(db)))
            }
            defer { sqlite3_finalize(statement) }
            let status = revision.withCString {
                sqlite3_bind_text(
                    statement, 1, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
            guard status == SQLITE_OK else {
                throw ImportFailure.invalid("Unable to bind document revision")
            }
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw ImportFailure.invalid("Missing document")
            }
            return Data(
                bytes: sqlite3_column_blob(statement, 0),
                count: Int(sqlite3_column_bytes(statement, 0)))
        }
    }
}
