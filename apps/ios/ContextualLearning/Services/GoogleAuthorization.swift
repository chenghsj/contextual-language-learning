import Foundation
import GoogleSignIn
import Observation
import UIKit

@MainActor
protocol GoogleAuthorizing: AnyObject {
    var state: GoogleAuthorizationState { get }
    var lastKnownAccount: GoogleAccount? { get }
    var account: GoogleAccount? { get }
    var accountID: String? { get }
    func accessToken() async throws -> String
    func signIn(presenting: UIViewController) async throws
    func restoreIfConfigured() async
    func requireReauthentication()
    func signOut()
    @discardableResult func handle(_ url: URL) -> Bool
}

struct GoogleAccount: Codable, Equatable, Sendable {
    let id: String
    let email: String

    init(id: String?, email: String?) throws {
        guard let id, !id.isEmpty, id.utf8.count <= 256,
            let email, !email.isEmpty, email.utf8.count <= 320,
            email.contains("@")
        else { throw GoogleAuthorizationError.invalidAccount }
        self.id = id
        self.email = email
    }
}

enum GoogleAuthorizationState: Equatable {
    case unconfigured
    case disconnected
    case connecting
    case connected(GoogleAccount)
}

enum GoogleAuthorizationError: Error, LocalizedError, Equatable {
    case unconfigured
    case busy
    case disconnected
    case invalidAccount
    case missingDriveScope
    case accountChanged

    var errorDescription: String? {
        switch self {
        case .unconfigured: return "尚未設定 Google iOS OAuth 用戶端。"
        case .busy: return "Google 授權正在進行，請稍後重試。"
        case .disconnected: return "請先連結 Google 帳號。"
        case .invalidAccount: return "Google 帳號資訊不完整。"
        case .missingDriveScope: return "尚未授權存取此應用程式的 Google Drive 檔案。"
        case .accountChanged: return "Google 帳號已變更，請重新整理。"
        }
    }
}

struct GoogleAuthorizationConfiguration: Equatable {
    let clientID: String
    let reversedClientID: String
    let bundleID: String

    init?(infoDictionary: [String: Any]) {
        guard let clientID = infoDictionary["GIDClientID"] as? String,
            let bundleID = infoDictionary["CFBundleIdentifier"] as? String,
            let types = infoDictionary["CFBundleURLTypes"] as? [[String: Any]],
            clientID.hasSuffix(".apps.googleusercontent.com")
        else { return nil }

        let prefix = String(clientID.dropLast(".apps.googleusercontent.com".count))
        let parts = prefix.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2,
            !parts[0].isEmpty, parts[0].utf8.allSatisfy({ (48...57).contains($0) }),
            !parts[1].isEmpty,
            parts[1].allSatisfy({
                $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_")
            }),
            !["placeholder", "example", "replace", "your-client", "dummy", "sample"].contains(
                where: { clientID.localizedCaseInsensitiveContains($0) }),
            !bundleID.localizedCaseInsensitiveContains("placeholder"),
            !bundleID.localizedCaseInsensitiveContains("example"),
            bundleID.split(separator: ".", omittingEmptySubsequences: false).count >= 3,
            bundleID.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({
                !$0.isEmpty
            }),
            bundleID.allSatisfy({
                $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == ".")
            })
        else { return nil }

        let reversedClientID = "com.googleusercontent.apps." + prefix
        guard
            types.contains(where: {
                ($0["CFBundleURLSchemes"] as? [String])?.contains(reversedClientID) == true
            })
        else {
            return nil
        }
        self.clientID = clientID
        self.reversedClientID = reversedClientID
        self.bundleID = bundleID
    }
}

@MainActor @Observable
final class GoogleAuthorization: GoogleAuthorizing {
    static let driveFileScope = "https://www.googleapis.com/auth/drive.file"
    private static let accountStorageKey = "GoogleAuthorization.lastKnownAccount"

    private(set) var state: GoogleAuthorizationState
    private(set) var lastKnownAccount: GoogleAccount?
    var account: GoogleAccount? {
        guard case .connected(let account) = state else { return nil }
        return account
    }
    var accountID: String? { account?.id }
    let configuration: GoogleAuthorizationConfiguration?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var generation: UInt64 = 0
    @ObservationIgnored private var authorizationInFlight = false

    init(
        infoDictionary: [String: Any] = Bundle.main.infoDictionary ?? [:],
        defaults: UserDefaults = .standard
    ) {
        self.defaults = defaults
        configuration = GoogleAuthorizationConfiguration(infoDictionary: infoDictionary)
        state = configuration == nil ? .unconfigured : .disconnected
        lastKnownAccount = defaults.data(forKey: Self.accountStorageKey).flatMap {
            try? JSONDecoder().decode(GoogleAccount.self, from: $0)
        }
    }

    func signIn(presenting: UIViewController) async throws {
        guard let configuration else { throw GoogleAuthorizationError.unconfigured }
        guard !authorizationInFlight else { throw GoogleAuthorizationError.busy }
        guard case .disconnected = state else { throw GoogleAuthorizationError.busy }
        authorizationInFlight = true
        generation &+= 1
        let operation = generation
        state = .connecting
        let signIn = GIDSignIn.sharedInstance
        signIn.configuration = GIDConfiguration(clientID: configuration.clientID)
        defer { authorizationInFlight = false }

        do {
            let result = try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<GIDSignInResult, Error>) in
                signIn.signIn(
                    withPresenting: presenting, hint: nil, additionalScopes: [Self.driveFileScope]
                ) { result, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let result {
                        continuation.resume(returning: result)
                    } else {
                        continuation.resume(throwing: GoogleAuthorizationError.disconnected)
                    }
                }
            }
            guard operation == generation else {
                signIn.signOut()
                throw GoogleAuthorizationError.accountChanged
            }
            do { try accept(result.user) } catch {
                signIn.signOut()
                throw error
            }
        } catch {
            if operation == generation { state = .disconnected }
            throw error
        }
    }

    func restoreIfConfigured() async {
        guard let configuration, !authorizationInFlight, case .disconnected = state else { return }
        let signIn = GIDSignIn.sharedInstance
        signIn.configuration = GIDConfiguration(clientID: configuration.clientID)
        authorizationInFlight = true
        generation &+= 1
        let operation = generation
        state = .connecting
        defer { authorizationInFlight = false }

        do {
            let user = try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<GIDGoogleUser, Error>) in
                signIn.restorePreviousSignIn { user, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let user {
                        continuation.resume(returning: user)
                    } else {
                        continuation.resume(throwing: GoogleAuthorizationError.disconnected)
                    }
                }
            }
            guard operation == generation else {
                signIn.signOut()
                return
            }
            do { try accept(user) } catch {
                signIn.signOut()
                throw error
            }
        } catch {
            if operation == generation { state = .disconnected }
        }
    }

    func accessToken() async throws -> String {
        guard case .connected(let account) = state else {
            throw GoogleAuthorizationError.disconnected
        }
        let operation = generation
        let signIn = GIDSignIn.sharedInstance
        guard let user = signIn.currentUser, user.userID == account.id else {
            state = .disconnected
            throw GoogleAuthorizationError.accountChanged
        }
        guard Self.hasDriveFileScope(user.grantedScopes) else {
            state = .disconnected
            throw GoogleAuthorizationError.missingDriveScope
        }
        let refreshed: GIDGoogleUser
        do {
            refreshed = try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<GIDGoogleUser, Error>) in
                user.refreshTokensIfNeeded { user, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let user {
                        continuation.resume(returning: user)
                    } else {
                        continuation.resume(throwing: GoogleAuthorizationError.disconnected)
                    }
                }
            }
        } catch {
            if operation == generation { state = .disconnected }
            throw error
        }
        guard operation == generation,
            case .connected(account) = state,
            refreshed.userID == account.id,
            signIn.currentUser?.userID == account.id
        else {
            if operation == generation { state = .disconnected }
            throw GoogleAuthorizationError.accountChanged
        }
        guard Self.hasDriveFileScope(refreshed.grantedScopes) else {
            state = .disconnected
            throw GoogleAuthorizationError.missingDriveScope
        }
        let token = refreshed.accessToken.tokenString
        guard !token.isEmpty else { throw GoogleAuthorizationError.disconnected }
        return token
    }

    func signOut() {
        generation &+= 1
        GIDSignIn.sharedInstance.signOut()
        lastKnownAccount = nil
        defaults.removeObject(forKey: Self.accountStorageKey)
        state = configuration == nil ? .unconfigured : .disconnected
    }

    func requireReauthentication() {
        generation &+= 1
        state = configuration == nil ? .unconfigured : .disconnected
    }

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard let configuration, url.scheme == configuration.reversedClientID else { return false }
        return GIDSignIn.sharedInstance.handle(url)
    }

    static func hasDriveFileScope(_ scopes: [String]?) -> Bool {
        scopes?.contains(driveFileScope) == true
    }

    private func accept(_ user: GIDGoogleUser) throws {
        let account = try GoogleAccount(id: user.userID, email: user.profile?.email)
        guard Self.hasDriveFileScope(user.grantedScopes) else {
            throw GoogleAuthorizationError.missingDriveScope
        }
        if let lastKnownAccount, lastKnownAccount.id != account.id {
            throw GoogleAuthorizationError.accountChanged
        }
        lastKnownAccount = account
        defaults.set(try JSONEncoder().encode(account), forKey: Self.accountStorageKey)
        state = .connected(account)
    }
}
