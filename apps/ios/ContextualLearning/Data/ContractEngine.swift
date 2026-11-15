import CryptoKit
import Foundation
import JavaScriptCore

actor ContractEngine {
    static let maximumBytes = 25_000_000
    private let script: String?

    init(script: String? = nil) {
        self.script =
            script
            ?? Bundle.main.url(forResource: "contract", withExtension: "js").flatMap {
                try? String(contentsOf: $0, encoding: .utf8)
            }
    }

    func importPayload(_ payload: ImportPayload) throws -> Material {
        let limit = payload.format == .favorite ? 50_000_000 : Self.maximumBytes
        guard !payload.original.isEmpty, payload.original.count <= limit,
            (payload.pairedMarkdown?.count ?? 0) <= Self.maximumBytes
        else {
            throw ImportFailure.invalid("檔案為空或超過 25 MB，請選擇較小的教材。")
        }
        guard let text = String(data: payload.original, encoding: .utf8) else {
            throw ImportFailure.invalid("檔案不是有效的 UTF-8 文字。")
        }
        if payload.format == .markdown {
            guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
                throw ImportFailure.invalid("Markdown 內容是空白。")
            }
            return Material(
                contractVersion: 1, kind: .markdown, documentID: sha256(payload.original),
                title: String(payload.suggestedName.prefix(200)), language: "unspecified",
                createdAt: "", sourceTitle: "本機檔案", sourceURL: nil, scenes: [], markdown: text)
        }
        let markdown: String?
        if let bytes = payload.pairedMarkdown {
            guard let value = String(data: bytes, encoding: .utf8) else {
                throw ImportFailure.invalid("配對的 Markdown 不是有效的 UTF-8 文字。")
            }
            markdown = value
        } else {
            markdown = nil
        }
        let json: Data
        if payload.format == .favorite {
            json = try invoke("importFavoriteJSON", arguments: [text])
        } else {
            json = try invoke(
                "importJSON",
                arguments: [
                    text, markdown as Any? ?? NSNull(),
                    payload.pairedMarkdown.map(sha256) as Any? ?? NSNull(),
                ])
        }
        let material = try JSONDecoder().decode(Material.self, from: json)
        guard material.contractVersion == 1 else {
            throw ImportFailure.invalid("教材顯示格式不相容，請更新 App。")
        }
        return material
    }

    func projectFavorites(
        collectionID: String, sources: [DriveFavoriteFile], catalogs: [FavoriteCatalogInput]
    ) throws -> [CloudFavorite] {
        let encoder = JSONEncoder()
        guard let sourceJSON = String(data: try encoder.encode(sources), encoding: .utf8),
            let catalogJSON = String(data: try encoder.encode(catalogs), encoding: .utf8)
        else {
            throw ImportFailure.invalid("收藏索引無法讀取。")
        }
        return try JSONDecoder().decode(
            [CloudFavorite].self,
            from: invoke("projectFavorites", arguments: [collectionID, sourceJSON, catalogJSON]))
    }

    private func invoke(_ name: String, arguments: [Any]) throws -> Data {
        guard let script, let context = JSContext() else {
            throw ImportFailure.invalid("教材驗證元件無法載入，請重新安裝 App。")
        }
        let hash: @convention(block) (String) -> String = { sha256(Data($0.utf8)) }
        context.setObject(hash, forKeyedSubscript: "CLLNativeSHA256" as NSString)
        context.evaluateScript(script)
        guard context.exception == nil else { throw ImportFailure.invalid("教材驗證元件無法啟動。") }
        guard
            let function = context.objectForKeyedSubscript("CLLContract")?.objectForKeyedSubscript(
                name), !function.isUndefined
        else { throw ImportFailure.invalid("教材驗證介面不相容。") }
        let result = function.call(withArguments: arguments)
        if let exception = context.exception {
            let message = exception.objectForKeyedSubscript("message")?.toString() ?? "教材格式或引用驗證失敗。"
            throw ImportFailure.invalid("無法匯入教材。\n" + String(message.prefix(1000)))
        }
        guard let result, result.isString, let json = result.toString()?.data(using: .utf8) else {
            throw ImportFailure.invalid("教材驗證沒有回傳有效內容。")
        }
        return json
    }
}

func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
