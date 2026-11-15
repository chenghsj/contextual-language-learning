import Foundation

struct CloudFavorite: Codable, Sendable, Identifiable {
    let key: String
    let title: String
    let sourceTitle: String
    let language: String
    let excerpt: String
    let catalog: String
    let source: DriveFavoriteFile
    var sourcePlatform: String? = nil
    var id: String { key }
}

struct FavoriteCatalogInput: Codable, Sendable {
    let file: DriveFavoriteFile
    let text: String
}

struct FavoriteDownloadEnvelope: Codable, Sendable {
    let collectionID: String
    let key: String
    let catalog: String
    let operation: String
}

struct CloudInventory: Codable, Sendable {
    var version = 1
    let accountID: String
    var materials: [DriveLibraryItem]
    var favorites: [CloudFavorite]
    var updatedAt: Date?
}
