import Foundation

struct DriveInventoryReader: Sendable {
    let transport: DriveTransport
    let contract: ContractEngine

    func refresh(accountID: String, accessToken: String) async throws -> CloudInventory {
        let collection = sha256(Data(("favorites-v1:" + accountID).utf8))
        let materials = try await transport.listLibrary(accessToken: accessToken)
        let sources = try await transport.listFavoriteFiles(
            collectionId: collection, kind: .operation, accessToken: accessToken)
        let catalogFiles = try await transport.listFavoriteFiles(
            collectionId: collection, kind: .catalog, accessToken: accessToken)
        guard catalogFiles.count <= 10_000 else { throw DriveTransportError.tooManyFiles }
        var catalogs: [FavoriteCatalogInput] = []
        var totalBytes = 0
        for file in catalogFiles {
            let bytes = try await transport.readFavorite(
                file: file, maxBytes: 1_048_576, accessToken: accessToken)
            totalBytes += bytes.count
            guard totalBytes <= ContractEngine.maximumBytes else {
                throw DriveTransportError.tooLarge
            }
            guard let text = String(data: bytes, encoding: .utf8) else {
                throw DriveTransportError.invalidUTF8
            }
            catalogs.append(FavoriteCatalogInput(file: file, text: text))
        }
        let after = try await transport.listFavoriteFiles(
            collectionId: collection, kind: .operation, accessToken: accessToken)
        let inventoryKey: (DriveFavoriteFile) -> String = {
            [$0.id, $0.operationId, $0.hash, $0.schema].joined(separator: ":")
        }
        guard sources.map(inventoryKey).sorted() == after.map(inventoryKey).sorted() else {
            throw ImportFailure.invalid("雲端收藏正在更新，請重新整理。")
        }
        let favorites = try await contract.projectFavorites(
            collectionID: collection, sources: after, catalogs: catalogs)
        try Task.checkCancellation()
        return CloudInventory(
            accountID: accountID, materials: materials, favorites: favorites, updatedAt: .now)
    }

    func favoritePayload(_ favorite: CloudFavorite, accountID: String, accessToken: String)
        async throws -> ImportPayload
    {
        let bytes = try await transport.readFavorite(
            file: favorite.source, maxBytes: 20 * 1_048_576, accessToken: accessToken)
        guard let operation = String(data: bytes, encoding: .utf8) else {
            throw DriveTransportError.invalidUTF8
        }
        let envelope = FavoriteDownloadEnvelope(
            collectionID: sha256(Data(("favorites-v1:" + accountID).utf8)), key: favorite.key,
            catalog: favorite.catalog, operation: operation)
        return ImportPayload(
            format: .favorite, original: try JSONEncoder().encode(envelope), pairedMarkdown: nil,
            suggestedName: favorite.title)
    }
}
