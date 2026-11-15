import Foundation
import Observation

struct CloudDownloadFeedback: Equatable {
    let message: String
    let isError: Bool
}

@MainActor @Observable
final class CloudLibraryModel {
    private(set) var inventory: CloudInventory?
    private(set) var isRefreshing = false
    private(set) var downloads = Set<String>()
    private(set) var isDisconnecting = false
    let batch = CloudDownloadBatch()
    let authorization: any GoogleAuthorizing
    private(set) var downloadFeedback: [String: CloudDownloadFeedback] = [:]
    private let library: LibraryModel
    private let repository: LibraryRepository
    private let reader: DriveInventoryReader
    @ObservationIgnored private var generation: UInt64 = 0
    @ObservationIgnored private var activeAccountID: String?
    @ObservationIgnored private var work: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var sourceQueue: [CloudDownloadTarget] = []
    @ObservationIgnored private var attemptedSources = Set<String>()

    init(
        library: LibraryModel, repository: LibraryRepository, authorization: any GoogleAuthorizing,
        transport: DriveTransport = DriveTransport(), contract: ContractEngine
    ) {
        self.library = library
        self.repository = repository
        self.authorization = authorization
        reader = DriveInventoryReader(transport: transport, contract: contract)
    }

    var account: GoogleAccount? { authorization.account ?? authorization.lastKnownAccount }

    func activateAccount() async {
        let accountID = account?.id
        guard accountID != activeAccountID else { return }
        invalidate()
        activeAccountID = accountID
        library.cloudAccountID = accountID
        inventory = nil
        guard let accountID else { return }
        let operation = generation
        do {
            let cached = try await repository.loadCloudInventory(accountID: accountID)
            guard operation == generation else { return }
            inventory = cached
        } catch { if operation == generation { library.show(error) } }
    }

    func refresh() {
        guard let accountID = authorization.accountID, !isRefreshing, !isDisconnecting,
            !batch.isRunning
        else {
            return
        }
        let operation = generation
        isRefreshing = true
        work["refresh"] = Task {
            defer {
                if operation == generation {
                    isRefreshing = false
                    work.removeValue(forKey: "refresh")
                }
            }
            do {
                let token = try await authorization.accessToken()
                try check(operation, accountID: accountID)
                var value = try await reader.refresh(accountID: accountID, accessToken: token)
                try check(operation, accountID: accountID)
                if let previous = inventory {
                    let materials = Dictionary(
                        previous.materials.map { ($0.id, $0) },
                        uniquingKeysWith: { first, _ in first })
                    let favorites = Dictionary(
                        previous.favorites.map { ($0.id, $0) },
                        uniquingKeysWith: { first, _ in first })
                    for index in value.materials.indices {
                        let item = value.materials[index]
                        if let old = materials[item.id], old.json == item.json,
                            item.sourcePlatform == nil
                        {
                            value.materials[index].sourcePlatform = old.sourcePlatform
                        }
                    }
                    for index in value.favorites.indices {
                        let item = value.favorites[index]
                        if let old = favorites[item.id], old.source == item.source {
                            value.favorites[index].sourcePlatform = old.sourcePlatform
                        }
                    }
                }
                try await repository.saveCloudInventory(value)
                try check(operation, accountID: accountID)
                inventory = value
                attemptedSources.removeAll()
            } catch { handle(error, operation: operation) }
        }
    }

    @discardableResult
    func download(_ item: DriveLibraryItem) -> Task<Void, Never>? {
        download(.material(item))
    }

    @discardableResult
    func download(_ favorite: CloudFavorite) -> Task<Void, Never>? {
        download(.favorite(favorite))
    }

    func requestSource(_ target: CloudDownloadTarget) {
        guard let accountID = authorization.accountID, !isDisconnecting,
            attemptedSources.insert(target.id).inserted
        else { return }
        switch target {
        case .material(let item):
            guard item.sourcePlatform == nil, !item.conflict else { return }
        case .favorite(let favorite):
            guard favorite.sourcePlatform == nil else { return }
        }
        sourceQueue.append(target)
        guard work["source-metadata"] == nil else { return }
        let operation = generation
        work["source-metadata"] = Task {
            defer { if operation == generation { work.removeValue(forKey: "source-metadata") } }
            while operation == generation, !sourceQueue.isEmpty {
                let target = sourceQueue.removeFirst()
                do {
                    try check(operation, accountID: accountID)
                    let token = try await authorization.accessToken()
                    try check(operation, accountID: accountID)
                    let platform: String
                    switch target {
                    case .material(let item):
                        if let saved = downloaded(item)?.sourcePlatform {
                            platform = saved
                        } else {
                            platform = try await reader.transport.sourcePlatform(
                                item: item, accessToken: token)
                        }
                    case .favorite(let favorite):
                        if let saved = downloaded(favorite)?.sourcePlatform {
                            platform = saved
                        } else {
                            let bytes = try await reader.transport.readFavorite(
                                file: favorite.source, maxBytes: 20 * 1_048_576, accessToken: token)
                            platform =
                                VideoSourcePlatform.readJSON(bytes, favorite: true)?.rawValue ?? ""
                        }
                    }
                    try check(operation, accountID: accountID)
                    if let value = setSource(platform, for: target) {
                        try await repository.saveCloudInventory(value)
                    }
                } catch {
                    if operation != generation || Task.isCancelled { return }
                    if error as? DriveTransportError == .unauthorized {
                        authorization.requireReauthentication()
                        sourceQueue.removeAll()
                        return
                    }
                    // Source labels are optional metadata; a failed lookup must not block reading.
                }
            }
        }
    }

    @discardableResult
    private func setSource(_ platform: String, for target: CloudDownloadTarget) -> CloudInventory? {
        guard var value = inventory else { return nil }
        switch target {
        case .material(let item):
            guard
                let index = value.materials.firstIndex(where: {
                    $0.id == item.id && $0.json == item.json
                })
            else { return nil }
            value.materials[index].sourcePlatform = platform
        case .favorite(let favorite):
            guard
                let index = value.favorites.firstIndex(where: {
                    $0.id == favorite.id && $0.source == favorite.source
                })
            else { return nil }
            value.favorites[index].sourcePlatform = platform
        }
        inventory = value
        return value
    }

    func pendingDownloads(in category: CloudDownloadCategory) -> [CloudDownloadTarget] {
        guard let inventory, let account, inventory.accountID == account.id else { return [] }
        let namespace = "google:" + account.id
        switch category {
        case .materials:
            let saved = Set(
                library.snapshot.materials.filter { $0.namespace == namespace }.map {
                    $0.kind.rawValue + ":" + $0.documentID.lowercased()
                })
            return inventory.materials.filter {
                !$0.conflict && !saved.contains($0.kind.rawValue + ":" + $0.documentId.lowercased())
                    && !downloads.contains("material:" + $0.id)
            }.map(CloudDownloadTarget.material)
        case .favorites:
            let saved = Set(library.snapshot.materials.map(\.namespace))
            return inventory.favorites.filter {
                !saved.contains(favoriteNamespace($0.key, accountID: account.id))
                    && !downloads.contains("favorite:" + $0.key)
            }.map(CloudDownloadTarget.favorite)
        }
    }

    func selectedDownloads(_ ids: Set<String>, in category: CloudDownloadCategory)
        -> [CloudDownloadTarget]
    {
        pendingDownloads(in: category).filter { ids.contains($0.id) }
    }

    func localCopies(_ ids: Set<String>, in category: CloudDownloadCategory) -> Set<String> {
        guard let inventory else { return [] }
        switch category {
        case .materials:
            return Set(
                inventory.materials.compactMap {
                    ids.contains("material:" + $0.id) ? downloaded($0)?.id : nil
                })
        case .favorites:
            return Set(
                inventory.favorites.compactMap {
                    ids.contains("favorite:" + $0.key) ? downloaded($0)?.id : nil
                })
        }
    }

    @discardableResult
    func downloadSelected(_ ids: Set<String>, in category: CloudDownloadCategory) -> Bool {
        guard let accountID = authorization.accountID, !isDisconnecting, !isRefreshing,
            downloads.isEmpty, !batch.isRunning, !library.isRemoving
        else { return false }
        let operation = generation
        return batch.start(selectedDownloads(ids, in: category), category: category) { target in
            try self.check(operation, accountID: accountID)
            switch target {
            case .material(let item): if self.downloaded(item) != nil { return false }
            case .favorite(let favorite): if self.downloaded(favorite) != nil { return false }
            }
            do {
                try await self.downloadTarget(target, operation: operation, accountID: accountID)
                return true
            } catch {
                if operation == self.generation,
                    error as? DriveTransportError == .unauthorized
                {
                    self.authorization.requireReauthentication()
                }
                throw error
            }
        } != nil
    }

    func downloaded(_ item: DriveLibraryItem) -> MaterialSummary? {
        guard let account else { return nil }
        return library.snapshot.materials.first {
            $0.namespace == "google:" + account.id
                && $0.documentID.caseInsensitiveCompare(item.documentId) == .orderedSame
                && $0.kind.rawValue == item.kind.rawValue
        }
    }

    func downloaded(_ favorite: CloudFavorite) -> MaterialSummary? {
        guard let account else { return nil }
        return library.snapshot.materials.first {
            $0.namespace == favoriteNamespace(favorite.key, accountID: account.id)
        }
    }

    func disconnect() async {
        guard !isDisconnecting else { return }
        isDisconnecting = true
        invalidate()
        defer { isDisconnecting = false }
        guard let accountID = account?.id else {
            authorization.signOut()
            return
        }
        do {
            let value = try await repository.removeCloudAccount(accountID)
            library.apply(value)
            inventory = nil
            authorization.signOut()
            library.cloudAccountID = nil
            activeAccountID = nil
        } catch { library.show(error) }
    }

    private func savedRevision(_ target: CloudDownloadTarget) -> String? {
        switch target {
        case .material(let item): downloaded(item)?.revision
        case .favorite(let favorite): downloaded(favorite)?.revision
        }
    }

    private func download(_ target: CloudDownloadTarget) -> Task<Void, Never>? {
        let key = target.id
        guard let accountID = authorization.accountID, !downloads.contains(key), !isDisconnecting,
            !batch.isRunning, !library.isRemoving
        else { return nil }
        let operation = generation
        let previousRevision = savedRevision(target)
        downloadFeedback.removeValue(forKey: key)
        downloads.insert(key)
        work[key] = Task {
            defer {
                if operation == generation {
                    downloads.remove(key)
                    work.removeValue(forKey: key)
                }
            }
            do {
                try await downloadTarget(target, operation: operation, accountID: accountID)
                guard operation == generation else { return }
                let unchanged = previousRevision != nil && previousRevision == savedRevision(target)
                downloadFeedback[key] = CloudDownloadFeedback(
                    message: unchanged ? "已是最新版本" : "下載完成，已更新本機副本", isError: false)
            } catch {
                guard operation == generation, !Task.isCancelled, !(error is CancellationError)
                else {
                    return
                }
                if error as? DriveTransportError == .unauthorized {
                    authorization.requireReauthentication()
                }
                downloadFeedback[key] = CloudDownloadFeedback(
                    message: error.localizedDescription, isError: true)
            }
        }
        return work[key]
    }

    private func downloadTarget(
        _ target: CloudDownloadTarget, operation: UInt64, accountID: String
    ) async throws {
        try check(operation, accountID: accountID)
        downloads.insert(target.id)
        defer { if operation == generation { downloads.remove(target.id) } }
        let token = try await authorization.accessToken()
        try check(operation, accountID: accountID)
        let input: ImportPayload
        let namespace: String
        var resolvedTarget = target
        switch target {
        case .material(let item):
            let value = try await reader.transport.download(
                item: item, accessToken: token, refreshMetadata: downloaded(item) != nil)
            try check(operation, accountID: accountID)
            resolvedTarget = .material(value.item)
            if let index = inventory?.materials.firstIndex(where: { $0.id == item.id }) {
                inventory?.materials[index] = value.item
            }
            input = ImportPayload(
                format: .json, original: value.jsonData, pairedMarkdown: value.markdownData,
                suggestedName: value.item.title)
            namespace = "google:" + accountID
        case .favorite(let favorite):
            var current = favorite
            if downloaded(favorite) != nil {
                let latest = try await reader.refresh(accountID: accountID, accessToken: token)
                try check(operation, accountID: accountID)
                guard let found = latest.favorites.first(where: { $0.key == favorite.key }) else {
                    throw DriveTransportError.missingFile
                }
                current = found
                if let index = inventory?.favorites.firstIndex(where: { $0.key == favorite.key }) {
                    inventory?.favorites[index] = current
                }
            }
            resolvedTarget = .favorite(current)
            input = try await reader.favoritePayload(
                current, accountID: accountID, accessToken: token)
            namespace = favoriteNamespace(favorite.key, accountID: accountID)
        }
        try check(operation, accountID: accountID)
        let snapshot = try await repository.store(input, namespace: namespace)
        // A committed item stays visible even if cancellation arrived during the transaction.
        guard operation == generation, authorization.accountID == accountID else {
            throw CancellationError()
        }
        library.apply(snapshot)
        if let value = setSource(
            VideoSourcePlatform.readPayload(input)?.rawValue ?? "", for: resolvedTarget)
        {
            try? await repository.saveCloudInventory(value)
        }
    }

    private func check(_ operation: UInt64, accountID: String) throws {
        try Task.checkCancellation()
        guard generation == operation, authorization.accountID == accountID else {
            throw CancellationError()
        }
    }

    private func handle(_ error: Error, operation: UInt64) {
        guard generation == operation, !(error is CancellationError), !Task.isCancelled else {
            return
        }
        if error as? DriveTransportError == .unauthorized {
            authorization.requireReauthentication()
        }
        library.show(error)
    }

    private func invalidate() {
        generation &+= 1
        batch.reset()
        sourceQueue.removeAll()
        attemptedSources.removeAll()
        downloadFeedback.removeAll()
        for task in work.values { task.cancel() }
        work.removeAll()
        downloads.removeAll()
        isRefreshing = false
    }

    private func favoriteNamespace(_ key: String, accountID: String) -> String {
        "google:" + accountID + ":favorite:" + key
    }
}

enum CloudDownloadCategory: String, Equatable {
    case materials, favorites
    var title: String { self == .materials ? "教材" : "收藏" }
}

enum CloudDownloadTarget: Identifiable, Sendable {
    case material(DriveLibraryItem)
    case favorite(CloudFavorite)

    var id: String {
        switch self {
        case .material(let item): "material:" + item.id
        case .favorite(let favorite): "favorite:" + favorite.key
        }
    }

    var title: String {
        switch self {
        case .material(let item): item.title
        case .favorite(let favorite): favorite.title
        }
    }
}

@MainActor @Observable
final class CloudDownloadBatch {
    struct Failure: Identifiable, Equatable {
        let id: String
        let title: String
        let message: String
    }

    struct Progress: Equatable {
        let category: CloudDownloadCategory
        let total: Int
        var completed = 0
        var downloaded = 0
        var skipped = 0
        var failures: [Failure] = []
        var currentTitle: String?
        var wasCancelled = false
        var stopReason: String?
    }

    private(set) var progress: Progress?
    private(set) var isRunning = false
    private(set) var isCancelling = false
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation: UInt64 = 0

    @discardableResult
    func start(
        _ targets: [CloudDownloadTarget], category: CloudDownloadCategory,
        download: @escaping @MainActor (CloudDownloadTarget) async throws -> Bool
    ) -> Task<Void, Never>? {
        guard !isRunning else { return nil }
        var seen = Set<String>()
        let targets = targets.filter { seen.insert($0.id).inserted }
        guard !targets.isEmpty else { return nil }
        generation &+= 1
        let operation = generation
        progress = Progress(category: category, total: targets.count)
        isRunning = true
        isCancelling = false
        task = Task {
            defer {
                if generation == operation {
                    progress?.currentTitle = nil
                    isRunning = false
                    isCancelling = false
                    task = nil
                }
            }
            for target in targets {
                guard generation == operation else { return }
                do {
                    try Task.checkCancellation()
                    progress?.currentTitle = target.title
                    let imported = try await download(target)
                    guard generation == operation else { return }
                    progress?.completed += 1
                    if imported { progress?.downloaded += 1 } else { progress?.skipped += 1 }
                } catch {
                    guard generation == operation else { return }
                    if Task.isCancelled || error is CancellationError
                        || (error as? URLError)?.code == .cancelled
                    {
                        progress?.wasCancelled = true
                        break
                    }
                    progress?.completed += 1
                    progress?.failures.append(
                        Failure(
                            id: target.id, title: target.title, message: error.localizedDescription)
                    )
                    if Self.requiresSignIn(error) {
                        progress?.stopReason = error.localizedDescription
                        break
                    }
                }
            }
        }
        return task
    }

    func cancel() {
        guard isRunning else { return }
        isCancelling = true
        task?.cancel()
    }

    func reset() {
        generation &+= 1
        task?.cancel()
        task = nil
        progress = nil
        isRunning = false
        isCancelling = false
    }

    private static func requiresSignIn(_ error: Error) -> Bool {
        error is GoogleAuthorizationError
            || error as? DriveTransportError == .unauthorized
            || error as? DriveTransportError == .invalidAccessToken
    }
}
