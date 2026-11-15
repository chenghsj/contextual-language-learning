import Foundation
import SQLite3

final class SQLiteDatabase {
    private var handle: OpaquePointer?
    private let path: String

    init(path: String) throws {
        self.path = path
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(path, &handle, flags, nil) == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(handle))
            sqlite3_close(handle)
            handle = nil
            throw ImportFailure.invalid("無法開啟本機資料庫：\(message)")
        }
        do {
            try execute("PRAGMA foreign_keys = ON")
            try execute("PRAGMA busy_timeout = 5000")
            let version = try query("PRAGMA user_version").first?.integer(0) ?? 0
            guard (0...2).contains(version) else {
                throw ImportFailure.invalid("本機資料版本不相容，請更新 App。")
            }
            try execute("PRAGMA journal_mode = WAL")
            if version == 0 {
                try transaction {
                    try execute(
                        "CREATE TABLE documents (revision TEXT PRIMARY KEY, payload BLOB NOT NULL)")
                    try execute(
                        "CREATE TABLE materials (storageID TEXT PRIMARY KEY, namespace TEXT NOT NULL, documentID TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL, sourceTitle TEXT NOT NULL, revision TEXT NOT NULL REFERENCES documents(revision), byteCount INTEGER NOT NULL, importedAt REAL NOT NULL, sceneIDs BLOB NOT NULL)"
                    )
                    try execute("CREATE INDEX materials_namespace ON materials(namespace)")
                    try execute(
                        "CREATE TABLE positions (materialID TEXT PRIMARY KEY REFERENCES materials(storageID) ON DELETE CASCADE, sceneID TEXT, groupID TEXT, visitedSceneIDs BLOB NOT NULL, updatedAt REAL NOT NULL)"
                    )
                    try execute(
                        "CREATE TABLE review (id TEXT PRIMARY KEY, materialID TEXT NOT NULL REFERENCES materials(storageID) ON DELETE CASCADE, content BLOB NOT NULL, createdAt REAL NOT NULL)"
                    )
                    try execute("CREATE INDEX review_material ON review(materialID)")
                    try execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)")
                    try execute(
                        "CREATE TABLE cloud_inventory (account_id TEXT PRIMARY KEY, content BLOB NOT NULL)"
                    )
                    try execute("INSERT INTO meta(key, value) VALUES ('sequence', 0)")
                    try execute("PRAGMA user_version = 1")
                }
            }
            if version <= 1 {
                try transaction {
                    try execute("ALTER TABLE materials ADD COLUMN sourcePlatform TEXT")
                    try execute("PRAGMA user_version = 2")
                }
            }
            guard try query("PRAGMA foreign_keys").first?.integer(0) == 1 else {
                throw ImportFailure.invalid("本機資料庫未啟用關聯完整性。")
            }
            guard try query("PRAGMA quick_check").first?.string(0) == "ok" else {
                throw ImportFailure.invalid("本機資料庫損壞，已保留原始資料。")
            }
        } catch {
            sqlite3_close(handle)
            handle = nil
            throw error
        }
    }

    deinit { sqlite3_close(handle) }

    enum Value {
        case text(String)
        case integer(Int64)
        case real(Double)
        case blob(Data)
        case null
    }

    struct Row {
        let values: [Value]
        func string(_ i: Int) -> String? {
            if case .text(let value) = values[i] { return value }
            return nil
        }
        func integer(_ i: Int) -> Int64? {
            if case .integer(let value) = values[i] { return value }
            return nil
        }
        func real(_ i: Int) -> Double? {
            if case .real(let value) = values[i] { return value }
            return nil
        }
        func blob(_ i: Int) -> Data? {
            if case .blob(let value) = values[i] { return value }
            return nil
        }
    }

    func execute(_ sql: String, _ values: [Value] = []) throws {
        let statement = try prepare(sql, values)
        defer { sqlite3_finalize(statement) }
        let status = sqlite3_step(statement)
        guard status == SQLITE_DONE || status == SQLITE_ROW else { throw failure() }
    }

    func query(_ sql: String, _ values: [Value] = []) throws -> [Row] {
        let statement = try prepare(sql, values)
        defer { sqlite3_finalize(statement) }
        var result: [Row] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW else { throw failure() }
            var fields: [Value] = []
            for index in 0..<Int(sqlite3_column_count(statement)) {
                let column = Int32(index)
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER:
                    fields.append(.integer(sqlite3_column_int64(statement, column)))
                case SQLITE_FLOAT: fields.append(.real(sqlite3_column_double(statement, column)))
                case SQLITE_TEXT:
                    let count = Int(sqlite3_column_bytes(statement, column))
                    let bytes: Data
                    if count == 0 {
                        bytes = Data()
                    } else {
                        guard let pointer = sqlite3_column_text(statement, column) else {
                            throw failure()
                        }
                        bytes = Data(bytes: pointer, count: count)
                    }
                    guard let text = String(data: bytes, encoding: .utf8) else {
                        throw ImportFailure.invalid("資料庫文字損壞，已保留原始資料。")
                    }
                    fields.append(.text(text))
                case SQLITE_BLOB:
                    let count = Int(sqlite3_column_bytes(statement, column))
                    if count == 0 {
                        fields.append(.blob(Data()))
                    } else {
                        guard let pointer = sqlite3_column_blob(statement, column) else {
                            throw failure()
                        }
                        fields.append(.blob(Data(bytes: pointer, count: count)))
                    }
                default: fields.append(.null)
                }
            }
            result.append(Row(values: fields))
        }
    }

    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let value = try body()
            try execute("COMMIT")
            return value
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func prepare(_ sql: String, _ values: [Value]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement
        else { throw failure() }
        do {
            guard sqlite3_bind_parameter_count(statement) == values.count else {
                throw ImportFailure.invalid("資料庫參數數量不符。")
            }
            for (offset, value) in values.enumerated() {
                let index = Int32(offset + 1)
                let status: Int32
                switch value {
                case .text(let text):
                    status = text.withCString {
                        sqlite3_bind_text(
                            statement, index, $0, Int32(text.utf8.count), Self.transient)
                    }
                case .integer(let number): status = sqlite3_bind_int64(statement, index, number)
                case .real(let number): status = sqlite3_bind_double(statement, index, number)
                case .blob(let data):
                    if data.isEmpty {
                        status = sqlite3_bind_zeroblob(statement, index, 0)
                    } else {
                        status = data.withUnsafeBytes {
                            sqlite3_bind_blob(
                                statement, index, $0.baseAddress, Int32(data.count), Self.transient)
                        }
                    }
                case .null: status = sqlite3_bind_null(statement, index)
                }
                guard status == SQLITE_OK else { throw failure() }
            }
            return statement
        } catch {
            sqlite3_finalize(statement)
            throw error
        }
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private func failure() -> ImportFailure {
        .invalid("本機資料庫讀寫失敗：\(String(cString: sqlite3_errmsg(handle)))")
    }
}
