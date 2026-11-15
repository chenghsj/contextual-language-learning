import XCTest

@testable import ContextualLearning

final class SQLiteDatabaseTests: XCTestCase {
    func testPreservesEmbeddedNullUnicodeAndEmptyBlob() throws {
        let db = try SQLiteDatabase(path: ":memory:")
        let value = "原文\u{0}e\u{301}👩‍👩‍👧‍👦"
        let row = try XCTUnwrap(db.query("SELECT ?, ?", [.text(value), .blob(Data())]).first)
        XCTAssertEqual(row.string(0), value)
        XCTAssertEqual(row.blob(1), Data())
    }

    func testTransactionRollbackAndForeignKeys() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString + ".sqlite")
        defer { try? FileManager.default.removeItem(at: path) }
        let db = try SQLiteDatabase(path: path.path)
        XCTAssertEqual(try db.query("PRAGMA user_version").first?.integer(0), 2)
        XCTAssertEqual(try db.query("PRAGMA foreign_keys").first?.integer(0), 1)
        do {
            try db.transaction {
                try db.execute(
                    "INSERT INTO documents(revision,payload) VALUES (?,?)",
                    [.text("sample"), .blob(Data([1]))])
                throw ImportFailure.invalid("abort")
            }
            XCTFail("Transaction committed")
        } catch {}
        XCTAssertTrue(try db.query("SELECT revision FROM documents").isEmpty)
        do {
            try db.execute(
                "INSERT INTO materials(storageID,namespace,documentID,kind,title,language,sourceTitle,revision,byteCount,importedAt,sceneIDs) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [
                    .text("id"), .text("local"), .text("doc"), .text("markdown"), .text("title"),
                    .text("en"),
                    .text("source"), .text("missing"), .integer(1), .real(0),
                    .blob(Data("[]".utf8)),
                ])
            XCTFail("Foreign key accepted")
        } catch {}
    }
}
