import Foundation

actor FileImportLoader {
    func payloads(from urls: [URL]) throws -> [ImportPayload] {
        guard urls.count <= 20 else { throw ImportFailure.invalid("一次最多匯入 20 個檔案。") }
        var data: [URL: Data] = [:]
        var totalBytes = 0
        for url in urls {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let bytes = try handle.read(upToCount: ContractEngine.maximumBytes + 1) ?? Data()
            guard bytes.count <= ContractEngine.maximumBytes else {
                throw ImportFailure.invalid("\(url.lastPathComponent) 超過 25 MB。")
            }
            totalBytes += bytes.count
            guard totalBytes <= 50_000_000 else {
                throw ImportFailure.invalid("一次匯入的總大小不能超過 50 MB，請分批匯入。")
            }
            data[url] = bytes
        }
        var usedMarkdown = Set<URL>()
        var payloads: [ImportPayload] = []
        for url in urls where url.pathExtension.lowercased() == "json" {
            guard let bytes = data[url] else { continue }
            let header = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
            var paired: Data?
            if header?["schemaVersion"] as? String == "custom-v1", header?["markdown"] == nil {
                if let matching = urls.first(where: {
                    ["md", "markdown"].contains($0.pathExtension.lowercased())
                        && $0.deletingPathExtension().lastPathComponent
                            == url.deletingPathExtension().lastPathComponent
                }) {
                    paired = data[matching]
                    usedMarkdown.insert(matching)
                }
            }
            payloads.append(
                ImportPayload(
                    format: .json, original: bytes, pairedMarkdown: paired,
                    suggestedName: url.deletingPathExtension().lastPathComponent))
        }
        for url in urls
        where ["md", "markdown"].contains(url.pathExtension.lowercased())
            && !usedMarkdown.contains(url)
        {
            if let bytes = data[url] {
                payloads.append(
                    ImportPayload(
                        format: .markdown, original: bytes, pairedMarkdown: nil,
                        suggestedName: url.deletingPathExtension().lastPathComponent))
            }
        }
        guard !payloads.isEmpty else { throw ImportFailure.invalid("請選擇 JSON 或 Markdown 檔案。") }
        return payloads
    }
}
