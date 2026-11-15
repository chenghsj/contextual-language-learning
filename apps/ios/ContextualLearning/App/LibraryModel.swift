import Foundation
import Observation

@MainActor @Observable
final class MaterialLoadModel {
    enum State {
        case loading
        case loaded(Material)
        case failed(String)
    }

    private(set) var state = State.loading
    private var key: String?
    private var generation = UUID()
    private var request: Task<Void, Never>?

    @discardableResult
    func load(
        _ key: String, retry: Bool = false,
        read: @escaping @MainActor () async throws -> Material
    ) -> Task<Void, Never> {
        if !retry, self.key == key, let request { return request }
        request?.cancel()
        self.key = key
        generation = UUID()
        let token = generation
        state = .loading
        let work = Task { [weak self] in
            do {
                let material = try await read()
                guard !Task.isCancelled, self?.generation == token else { return }
                self?.state = .loaded(material)
            } catch {
                guard !Task.isCancelled, self?.generation == token else { return }
                self?.state = .failed(error.localizedDescription)
            }
        }
        request = work
        return work
    }
}

@MainActor @Observable
final class LibraryModel {
    private(set) var snapshot = LibrarySnapshot()
    private(set) var isLoading = true
    private(set) var isImporting = false
    private(set) var isRemoving = false
    var failure: AppFailure?
    var cloudAccountID: String?
    private let repository: LibraryRepository
    private let loader = FileImportLoader()

    init(repository: LibraryRepository) { self.repository = repository }

    var visibleMaterials: [MaterialSummary] {
        snapshot.materials.filter { item in
            if item.namespace == "local" { return true }
            guard let cloudAccountID else { return false }
            let namespace = "google:" + cloudAccountID
            return item.namespace == namespace || item.namespace.hasPrefix(namespace + ":")
        }
    }
    var reviewEntries: [ReviewEntry] {
        let visible = Set(visibleMaterials.map(\.id))
        return snapshot.review.filter { visible.contains($0.materialID) }
    }
    var totalBytes: Int { visibleMaterials.reduce(0) { $0 + $1.byteCount } }
    var recent: MaterialSummary? {
        let id = snapshot.positions.max(by: { $0.value.updatedAt < $1.value.updatedAt })?.key
        return visibleMaterials.first { $0.id == id }
    }

    func load() async {
        do { apply(try await repository.load()) } catch { show(error) }
        isLoading = false
    }

    func importFiles(_ urls: [URL]) async {
        guard !isImporting else { return }
        isImporting = true
        defer { isImporting = false }
        do {
            let payloads = try await loader.payloads(from: urls)
            for payload in payloads { apply(try await repository.store(payload)) }
        } catch { show(error) }
    }

    func importSample() async {
        guard !isImporting else { return }
        isImporting = true
        defer { isImporting = false }
        do {
            guard let url = Bundle.main.url(forResource: "sample-lesson", withExtension: "json")
            else { throw ImportFailure.invalid("找不到範例教材。") }
            var original = try Data(contentsOf: url)
            #if DEBUG
                let arguments = ProcessInfo.processInfo.arguments
                if arguments.contains("--ui-testing"),
                    arguments.contains("--youtube-sample")
                        || arguments.contains("--netflix-sample"),
                    var document = try JSONSerialization.jsonObject(with: original)
                        as? [String: Any],
                    var source = document["source"] as? [String: Any],
                    let sections = document["sections"] as? [[String: Any]],
                    let sceneID = sections.first?["id"] as? String
                {
                    let netflix = arguments.contains("--netflix-sample")
                    source["platform"] = netflix ? "netflix" : "youtube"
                    source["url"] =
                        netflix
                        ? "https://www.netflix.com/watch/80057281?t=999"
                        : "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=5s"
                    document["source"] = source
                    document["playbackOverrides"] = ["cue-1": ["startMs": 83_000, "endMs": 85_000]]
                    document["scenePlaybackOverrides"] = [
                        sceneID: ["startMs": 83_000, "endMs": 86_000]
                    ]
                    original = try JSONSerialization.data(withJSONObject: document)
                }
            #endif
            apply(
                try await repository.store(
                    ImportPayload(
                        format: .json, original: original, pairedMarkdown: nil,
                        suggestedName: "範例教材")))
        } catch { show(error) }
    }

    func read(_ id: String) async throws -> Material {
        guard visibleMaterials.contains(where: { $0.id == id }) else {
            throw ImportFailure.invalid("找不到目前帳號的教材。")
        }
        let material = try await repository.read(id)
        guard visibleMaterials.contains(where: { $0.id == id }) else { throw CancellationError() }
        return material
    }

    @discardableResult
    func position(materialID: String, sceneID: String, groupID: String? = nil) async -> Bool {
        do {
            apply(
                try await repository.savePosition(
                    materialID: materialID, sceneID: sceneID, groupID: groupID))
            return true
        } catch {
            show(error)
            return false
        }
    }

    func toggleReview(storageID: String, material: Material, scene: ReaderScene, group: ReaderGroup)
        async
    {
        let entry = ReviewEntry(
            id: storageID + ":" + scene.id + ":" + group.id, materialID: storageID,
            title: material.title, sceneTitle: scene.title, language: material.language,
            group: group, createdAt: .now)
        do { apply(try await repository.toggleReview(entry)) } catch { show(error) }
    }

    func removeReview(_ entry: ReviewEntry) async {
        do { apply(try await repository.removeReview(entry.id)) } catch { show(error) }
    }

    func remove(_ id: String) async {
        await remove(Set([id]))
    }

    @discardableResult
    func remove(_ ids: Set<String>) async -> Bool {
        guard !isRemoving else { return false }
        let allowed = ids.intersection(visibleMaterials.map(\.id))
        guard !allowed.isEmpty else { return false }
        isRemoving = true
        defer { isRemoving = false }
        do {
            apply(try await repository.remove(allowed))
            return true
        } catch {
            show(error)
            return false
        }
    }

    func isReviewing(storageID: String, material: Material, scene: ReaderScene, group: ReaderGroup)
        -> Bool
    {
        snapshot.review.contains { $0.id == storageID + ":" + scene.id + ":" + group.id }
    }

    func show(_ error: Error) { failure = AppFailure(message: error.localizedDescription) }

    func apply(_ value: LibrarySnapshot) {
        if value.sequence >= snapshot.sequence { snapshot = value }
    }
}
