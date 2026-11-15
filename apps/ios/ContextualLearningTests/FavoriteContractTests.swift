import XCTest

@testable import ContextualLearning

final class FavoriteContractTests: XCTestCase {
    private struct Record: Decodable {
        let source: DriveFavoriteFile
        let catalog: FavoriteCatalogInput
        let operation: String
    }
    private struct Corpus: Decodable {
        let collectionID: String
        let records: [Record]
        let custom: Record
    }

    func testNativeCatalogProjectionMatchesRemoveWinsAndCausalReadd() async throws {
        let fixture = try corpus()
        let engine = ContractEngine()
        let first = try await project(Array(fixture.records.prefix(1)), fixture, engine)
        XCTAssertEqual(first.count, 1)
        let removed = try await project(Array(fixture.records.prefix(2)), fixture, engine)
        XCTAssertTrue(removed.isEmpty)
        let restored = try await project(fixture.records, fixture, engine)
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.source.operationId, fixture.records.last?.source.operationId)
    }

    func testPartialCatalogWrongHashAndWrongCollectionFailClosed() async throws {
        let fixture = try corpus()
        let engine = ContractEngine()
        do {
            _ = try await engine.projectFavorites(
                collectionID: fixture.collectionID, sources: fixture.records.map(\.source),
                catalogs: [fixture.records[0].catalog])
            XCTFail("Partial catalog accepted")
        } catch {}
        let original = fixture.records[0].catalog
        let file = original.file
        let corrupt = FavoriteCatalogInput(
            file: DriveFavoriteFile(
                id: file.id, operationId: file.operationId, hash: String(repeating: "0", count: 64),
                schema: file.schema), text: original.text)
        do {
            _ = try await engine.projectFavorites(
                collectionID: fixture.collectionID, sources: [fixture.records[0].source],
                catalogs: [corrupt])
            XCTFail("Wrong hash accepted")
        } catch {}
        do {
            _ = try await engine.projectFavorites(
                collectionID: String(repeating: "0", count: 64),
                sources: [fixture.records[0].source], catalogs: [original])
            XCTFail("Wrong account collection accepted")
        } catch {}
    }

    func testStandardAndCustomSnapshotsReadWithoutGenerationExecution() async throws {
        let fixture = try corpus()
        let engine = ContractEngine()
        let standard = try await engine.importPayload(
            payload(fixture.records[0], fixture.collectionID))
        XCTAssertEqual(standard.kind, .standard)
        XCTAssertEqual(
            standard.scenes.first?.groups.flatMap(\.rows).first?.text, "Why were you still home?")
        let custom = try await engine.importPayload(payload(fixture.custom, fixture.collectionID))
        XCTAssertEqual(custom.kind, .custom)
        XCTAssertTrue(custom.markdown?.contains("ありがとう") == true)
        let customList = try await project([fixture.custom], fixture, engine)
        XCTAssertEqual(customList.count, 1)
    }

    func testTamperedSnapshotCannotMatchCatalog() async throws {
        let fixture = try corpus()
        let record = fixture.records[0]
        let tampered = record.operation.replacingOccurrences(
            of: "Why were you still home?", with: "Changed original text")
        let envelope = FavoriteDownloadEnvelope(
            collectionID: fixture.collectionID, key: try key(record), catalog: record.catalog.text,
            operation: tampered)
        let input = ImportPayload(
            format: .favorite, original: try JSONEncoder().encode(envelope), pairedMarkdown: nil,
            suggestedName: "tampered")
        do {
            _ = try await ContractEngine().importPayload(input)
            XCTFail("Tampered snapshot accepted")
        } catch {}
    }

    private func project(_ records: [Record], _ fixture: Corpus, _ engine: ContractEngine)
        async throws -> [CloudFavorite]
    {
        try await engine.projectFavorites(
            collectionID: fixture.collectionID, sources: records.map(\.source),
            catalogs: records.map(\.catalog))
    }

    private func payload(_ record: Record, _ collection: String) throws -> ImportPayload {
        let envelope = FavoriteDownloadEnvelope(
            collectionID: collection, key: try key(record), catalog: record.catalog.text,
            operation: record.operation)
        return ImportPayload(
            format: .favorite, original: try JSONEncoder().encode(envelope), pairedMarkdown: nil,
            suggestedName: "favorite")
    }

    private func key(_ record: Record) throws -> String {
        let value =
            try JSONSerialization.jsonObject(with: Data(record.operation.utf8)) as? [String: Any]
        return try XCTUnwrap(value?["key"] as? String)
    }

    private func corpus() throws -> Corpus {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "favorite-corpus", withExtension: "json"))
        return try JSONDecoder().decode(Corpus.self, from: Data(contentsOf: url))
    }
}
