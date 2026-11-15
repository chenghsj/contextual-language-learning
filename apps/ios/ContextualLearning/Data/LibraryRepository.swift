import Foundation

actor LibraryRepository {
    private let root: URL
    private let contract: ContractEngine
    private var connection: SQLiteDatabase?
    private let encoder: JSONEncoder = {
        let value = JSONEncoder()
        value.outputFormatting = [.sortedKeys]
        return value
    }()

    init(root: URL, contract: ContractEngine) {
        self.root = root
        self.contract = contract
    }

    func load() throws -> LibrarySnapshot { try snapshot(try database()) }

    func store(_ payload: ImportPayload, namespace: String = "local") async throws
        -> LibrarySnapshot
    {
        let material = try await contract.importPayload(payload)
        try Task.checkCancellation()
        let bytes = try encoder.encode(payload)
        let revision = sha256(bytes)
        let id = namespace + ":" + material.id
        let db = try database()
        let previous = try summary(id, db)
        let existingBytes = try db.query(
            "SELECT payload FROM documents WHERE revision = ?", [.text(revision)]
        ).first?.blob(0)
        if previous?.revision == revision, existingBytes == bytes { return try snapshot(db) }
        if previous?.revision == revision {
            try Task.checkCancellation()
            try db.transaction {
                try db.execute(
                    "INSERT INTO documents(revision,payload) VALUES (?,?) ON CONFLICT(revision) DO UPDATE SET payload=excluded.payload",
                    [.text(revision), .blob(bytes)])
                try bump(db)
            }
            return try snapshot(db)
        }
        let value = MaterialSummary(
            namespace: namespace, id: id, documentID: material.documentID,
            title: material.title, language: material.language, kind: material.kind,
            revision: revision,
            byteCount: payload.original.count + (payload.pairedMarkdown?.count ?? 0),
            importedAt: .now,
            sourceTitle: material.sourceTitle, sceneIDs: material.scenes.map(\.id),
            sourcePlatform: VideoSourcePlatform.readPayload(payload)?.rawValue ?? "")
        try Task.checkCancellation()
        try db.transaction {
            try db.execute(
                "INSERT INTO documents(revision,payload) VALUES (?,?) ON CONFLICT(revision) DO UPDATE SET payload=excluded.payload",
                [.text(revision), .blob(bytes)])
            try db.execute(
                "INSERT INTO materials(storageID,namespace,documentID,kind,title,language,sourceTitle,revision,byteCount,importedAt,sceneIDs,sourcePlatform) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(storageID) DO UPDATE SET namespace=excluded.namespace,documentID=excluded.documentID,kind=excluded.kind,title=excluded.title,language=excluded.language,sourceTitle=excluded.sourceTitle,revision=excluded.revision,byteCount=excluded.byteCount,importedAt=excluded.importedAt,sceneIDs=excluded.sceneIDs,sourcePlatform=excluded.sourcePlatform",
                try bindings(value))
            if previous?.revision != revision {
                if var position = try position(id, db) {
                    position.visitedSceneIDs.removeAll { !value.sceneIDs.contains($0) }
                    if let scene = position.sceneID, !value.sceneIDs.contains(scene) {
                        position.sceneID = value.sceneIDs.first
                        position.groupID = nil
                    }
                    if let groupID = position.groupID,
                        !material.scenes.contains(where: {
                            $0.id == position.sceneID
                                && $0.groups.contains(where: { $0.id == groupID })
                        })
                    {
                        position.groupID = nil
                    }
                    try write(position, id, db)
                }
                try prune(db)
            }
            try bump(db)
        }
        return try snapshot(db)
    }

    func read(_ id: String) async throws -> Material {
        let db = try database()
        guard let value = try summary(id, db),
            let bytes = try db.query(
                "SELECT payload FROM documents WHERE revision = ?", [.text(value.revision)]
            ).first?.blob(0)
        else {
            throw ImportFailure.invalid("找不到這份教材。")
        }
        guard sha256(bytes) == value.revision else {
            throw ImportFailure.invalid("本機教材校驗失敗，請重新匯入。")
        }
        let payload = try JSONDecoder().decode(ImportPayload.self, from: bytes)
        let material = try await contract.importPayload(payload)
        guard id == value.namespace + ":" + material.id, material.documentID == value.documentID,
            material.kind == value.kind, material.title == value.title,
            material.language == value.language,
            material.sourceTitle == value.sourceTitle, material.scenes.map(\.id) == value.sceneIDs
        else {
            throw ImportFailure.invalid("本機教材識別不一致。")
        }
        return material
    }

    func savePosition(materialID id: String, sceneID: String, groupID: String?) throws
        -> LibrarySnapshot
    {
        let db = try database()
        guard let material = try summary(id, db), material.sceneIDs.contains(sceneID) else {
            return try snapshot(db)
        }
        var value = try position(id, db) ?? StudyPosition()
        value.sceneID = sceneID
        value.groupID = groupID
        if !value.visitedSceneIDs.contains(sceneID) { value.visitedSceneIDs.append(sceneID) }
        value.updatedAt = .now
        try db.transaction {
            try write(value, id, db)
            try bump(db)
        }
        return try snapshot(db)
    }

    func toggleReview(_ entry: ReviewEntry) throws -> LibrarySnapshot {
        let db = try database()
        try db.transaction {
            if try !db.query("SELECT id FROM review WHERE id = ?", [.text(entry.id)]).isEmpty {
                try db.execute("DELETE FROM review WHERE id = ?", [.text(entry.id)])
            } else {
                try db.execute(
                    "INSERT INTO review(id,materialID,content,createdAt) VALUES (?,?,?,?)",
                    [
                        .text(entry.id), .text(entry.materialID), .blob(try encoder.encode(entry)),
                        .real(entry.createdAt.timeIntervalSince1970),
                    ])
            }
            try bump(db)
        }
        return try snapshot(db)
    }

    func remove(_ id: String) throws -> LibrarySnapshot {
        try remove(Set([id]))
    }

    func remove(_ ids: Set<String>) throws -> LibrarySnapshot {
        let db = try database()
        guard !ids.isEmpty else { return try snapshot(db) }
        try Task.checkCancellation()
        try db.transaction {
            for id in ids.sorted() {
                try Task.checkCancellation()
                try db.execute("DELETE FROM materials WHERE storageID = ?", [.text(id)])
            }
            try prune(db)
            try bump(db)
        }
        return try snapshot(db)
    }

    func removeReview(_ id: String) throws -> LibrarySnapshot {
        let db = try database()
        try db.transaction {
            try db.execute("DELETE FROM review WHERE id = ?", [.text(id)])
            try bump(db)
        }
        return try snapshot(db)
    }

    func removeNamespace(_ namespace: String) throws -> LibrarySnapshot {
        let db = try database()
        try db.transaction {
            try db.execute("DELETE FROM materials WHERE namespace = ?", [.text(namespace)])
            try prune(db)
            try bump(db)
        }
        return try snapshot(db)
    }

    func removeNamespacePrefix(_ prefix: String) throws -> LibrarySnapshot {
        let db = try database()
        try db.transaction {
            try db.execute(
                "DELETE FROM materials WHERE substr(namespace,1,length(?)) = ?",
                [.text(prefix), .text(prefix)])
            try prune(db)
            try bump(db)
        }
        return try snapshot(db)
    }

    func removeCloudAccount(_ accountID: String) throws -> LibrarySnapshot {
        let db = try database()
        let exact = "google:" + accountID
        let prefix = exact + ":"
        try db.transaction {
            try db.execute(
                "DELETE FROM materials WHERE namespace = ? OR substr(namespace,1,length(?)) = ?",
                [.text(exact), .text(prefix), .text(prefix)])
            try db.execute("DELETE FROM cloud_inventory WHERE account_id = ?", [.text(accountID)])
            try prune(db)
            try bump(db)
        }
        return try snapshot(db)
    }

    func loadCloudInventory(accountID: String) throws -> CloudInventory? {
        let db = try database()
        guard
            let bytes = try db.query(
                "SELECT content FROM cloud_inventory WHERE account_id = ?", [.text(accountID)]
            ).first?.blob(0)
        else { return nil }
        let value = try JSONDecoder().decode(CloudInventory.self, from: bytes)
        guard value.accountID == accountID, value.version == 1 else {
            throw ImportFailure.invalid("雲端教材索引格式不相容。")
        }
        return value
    }

    func saveCloudInventory(_ inventory: CloudInventory) throws {
        guard inventory.version == 1 else { throw ImportFailure.invalid("雲端教材索引格式不相容。") }
        try Task.checkCancellation()
        let bytes = try encoder.encode(inventory)
        let db = try database()
        try Task.checkCancellation()
        try db.transaction {
            try db.execute(
                "INSERT INTO cloud_inventory(account_id,content) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET content=excluded.content",
                [.text(inventory.accountID), .blob(bytes)])
            try bump(db)
        }
    }

    /// SQLite LIKE folds ASCII case only; non-ASCII matching is case sensitive.
    func searchMaterials(query: String, language: String? = nil, namespace: String? = nil) throws
        -> [MaterialSummary]
    {
        let db = try database()
        var sql =
            "SELECT storageID,namespace,documentID,kind,title,language,sourceTitle,revision,byteCount,importedAt,sceneIDs,sourcePlatform FROM materials WHERE 1=1"
        var values: [SQLiteDatabase.Value] = []
        if !query.isEmpty {
            let escaped = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(
                of: "%", with: "\\%"
            ).replacingOccurrences(of: "_", with: "\\_")
            sql += " AND (title LIKE ? ESCAPE '\\' OR sourceTitle LIKE ? ESCAPE '\\')"
            values += [.text("%" + escaped + "%"), .text("%" + escaped + "%")]
        }
        if let language {
            sql += " AND language = ?"
            values.append(.text(language))
        }
        if let namespace {
            sql += " AND namespace = ?"
            values.append(.text(namespace))
        }
        sql += " ORDER BY importedAt DESC, storageID ASC"
        return try db.query(sql, values).map(decodeSummary)
    }

    private func database() throws -> SQLiteDatabase {
        if let connection { return connection }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("library.sqlite")
        let legacy = root.appendingPathComponent("library.json")
        if !FileManager.default.fileExists(atPath: file.path),
            FileManager.default.fileExists(atPath: legacy.path)
        {
            let data = try Data(contentsOf: legacy)
            if !data.isEmpty {
                let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let empty =
                    (value?["version"] as? Int == 1)
                    && ((value?["materials"] as? [Any])?.isEmpty == true)
                    && ((value?["positions"] as? [String: Any])?.isEmpty == true)
                    && ((value?["review"] as? [Any])?.isEmpty == true)
                guard empty else { throw ImportFailure.invalid("偵測到舊版教材資料。為保護原始資料，請先完成資料遷移。") }
            }
        }
        let db = try SQLiteDatabase(path: file.path)
        try db.transaction {
            let rows = try db.query(
                "SELECT storageID,revision FROM materials WHERE sourcePlatform IS NULL"
            )
            var changed = false
            for row in rows {
                guard let id = row.string(0), let revision = row.string(1),
                    let bytes = try db.query(
                        "SELECT payload FROM documents WHERE revision=?", [.text(revision)]
                    ).first?.blob(0),
                    sha256(bytes) == revision,
                    let payload = try? JSONDecoder().decode(ImportPayload.self, from: bytes)
                else { continue }
                let platform = VideoSourcePlatform.readPayload(payload)?.rawValue ?? ""
                try db.execute(
                    "UPDATE materials SET sourcePlatform=? WHERE storageID=?",
                    [
                        .text(platform), .text(id),
                    ])
                changed = true
            }
            if changed { try bump(db) }
        }
        connection = db
        return db
    }

    private func snapshot(_ db: SQLiteDatabase) throws -> LibrarySnapshot {
        var result = LibrarySnapshot()
        result.materials = try db.query(
            "SELECT storageID,namespace,documentID,kind,title,language,sourceTitle,revision,byteCount,importedAt,sceneIDs,sourcePlatform FROM materials ORDER BY importedAt DESC,storageID ASC"
        ).map(decodeSummary)
        for row in try db.query(
            "SELECT materialID,sceneID,groupID,visitedSceneIDs,updatedAt FROM positions")
        {
            guard let id = row.string(0), let scenes = row.blob(3), let date = row.real(4) else {
                throw corrupt()
            }
            result.positions[id] = StudyPosition(
                sceneID: row.string(1), groupID: row.string(2),
                visitedSceneIDs: try JSONDecoder().decode([String].self, from: scenes),
                updatedAt: Date(timeIntervalSince1970: date))
        }
        result.review = try db.query("SELECT content FROM review ORDER BY createdAt DESC,id ASC")
            .map { row in
                guard let bytes = row.blob(0) else { throw corrupt() }
                return try JSONDecoder().decode(ReviewEntry.self, from: bytes)
            }
        guard
            let number = try db.query("SELECT value FROM meta WHERE key = 'sequence'").first?
                .integer(0), number >= 0
        else { throw corrupt() }
        result.sequence = UInt64(number)
        return result
    }

    private func summary(_ id: String, _ db: SQLiteDatabase) throws -> MaterialSummary? {
        try db.query(
            "SELECT storageID,namespace,documentID,kind,title,language,sourceTitle,revision,byteCount,importedAt,sceneIDs,sourcePlatform FROM materials WHERE storageID = ?",
            [.text(id)]
        ).first.map(decodeSummary)
    }

    private func decodeSummary(_ row: SQLiteDatabase.Row) throws -> MaterialSummary {
        guard let id = row.string(0), let namespace = row.string(1), let documentID = row.string(2),
            let rawKind = row.string(3), let kind = Material.Kind(rawValue: rawKind),
            let title = row.string(4), let language = row.string(5),
            let sourceTitle = row.string(6),
            let revision = row.string(7), let count = row.integer(8), let date = row.real(9),
            let scenes = row.blob(10),
            revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
        else { throw corrupt() }
        return MaterialSummary(
            namespace: namespace, id: id, documentID: documentID, title: title,
            language: language, kind: kind, revision: revision, byteCount: Int(count),
            importedAt: Date(timeIntervalSince1970: date), sourceTitle: sourceTitle,
            sceneIDs: try JSONDecoder().decode([String].self, from: scenes),
            sourcePlatform: row.string(11))
    }

    private func bindings(_ value: MaterialSummary) throws -> [SQLiteDatabase.Value] {
        [
            .text(value.id), .text(value.namespace), .text(value.documentID),
            .text(value.kind.rawValue),
            .text(value.title), .text(value.language), .text(value.sourceTitle),
            .text(value.revision),
            .integer(Int64(value.byteCount)), .real(value.importedAt.timeIntervalSince1970),
            .blob(try encoder.encode(value.sceneIDs)),
            value.sourcePlatform.map(SQLiteDatabase.Value.text) ?? .null,
        ]
    }

    private func position(_ id: String, _ db: SQLiteDatabase) throws -> StudyPosition? {
        guard
            let row = try db.query(
                "SELECT sceneID,groupID,visitedSceneIDs,updatedAt FROM positions WHERE materialID = ?",
                [.text(id)]
            ).first
        else { return nil }
        guard let scenes = row.blob(2), let date = row.real(3) else { throw corrupt() }
        return StudyPosition(
            sceneID: row.string(0), groupID: row.string(1),
            visitedSceneIDs: try JSONDecoder().decode([String].self, from: scenes),
            updatedAt: Date(timeIntervalSince1970: date))
    }

    private func write(_ value: StudyPosition, _ id: String, _ db: SQLiteDatabase) throws {
        try db.execute(
            "INSERT INTO positions(materialID,sceneID,groupID,visitedSceneIDs,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(materialID) DO UPDATE SET sceneID=excluded.sceneID,groupID=excluded.groupID,visitedSceneIDs=excluded.visitedSceneIDs,updatedAt=excluded.updatedAt",
            [
                .text(id), value.sceneID.map(SQLiteDatabase.Value.text) ?? .null,
                value.groupID.map(SQLiteDatabase.Value.text) ?? .null,
                .blob(try encoder.encode(value.visitedSceneIDs)),
                .real(value.updatedAt.timeIntervalSince1970),
            ])
    }

    private func prune(_ db: SQLiteDatabase) throws {
        try db.execute(
            "DELETE FROM documents WHERE NOT EXISTS (SELECT 1 FROM materials WHERE materials.revision = documents.revision)"
        )
    }

    private func bump(_ db: SQLiteDatabase) throws {
        try db.execute("UPDATE meta SET value=value+1 WHERE key='sequence'")
    }

    private func corrupt() -> ImportFailure { .invalid("本機教材索引損壞，已保留原始資料。") }
}
