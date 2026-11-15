import XCTest

@testable import ContextualLearning

@MainActor
final class GoogleAuthorizationTests: XCTestCase {
    private let clientID = "1234567890-abcdef.apps.googleusercontent.com"
    private let reversedID = "com.googleusercontent.apps.1234567890-abcdef"

    private func info(
        clientID: String? = nil, scheme: String? = nil,
        bundleID: String = "dev.contextual.language-learning.reader"
    ) -> [String: Any] {
        [
            "GIDClientID": clientID ?? self.clientID,
            "CFBundleIdentifier": bundleID,
            "CFBundleURLTypes": [["CFBundleURLSchemes": [scheme ?? reversedID]]],
        ]
    }

    func testUnconfiguredAppCannotOfferSignInOrToken() async {
        let authorization = GoogleAuthorization(infoDictionary: [:])
        XCTAssertEqual(authorization.state, .unconfigured)
        await authorization.restoreIfConfigured()
        XCTAssertEqual(authorization.state, .unconfigured)
        do {
            try await authorization.signIn(presenting: UIViewController())
            XCTFail("Unconfigured sign-in must fail")
        } catch {
            XCTAssertEqual(error as? GoogleAuthorizationError, .unconfigured)
        }
        do {
            _ = try await authorization.accessToken()
            XCTFail("Disconnected account must not expose a token")
        } catch {
            XCTAssertEqual(error as? GoogleAuthorizationError, .disconnected)
        }
    }

    func testOnlyMatchingClientSchemeAndBundleAreConfigured() {
        XCTAssertEqual(
            GoogleAuthorizationConfiguration(infoDictionary: info())?.reversedClientID, reversedID)
        XCTAssertNil(
            GoogleAuthorizationConfiguration(infoDictionary: info(clientID: "UNCONFIGURED")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(clientID: "123-example.apps.googleusercontent.com")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(clientID: "123-your-client.apps.googleusercontent.com")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(clientID: "123-abc.apps.googleusercontent.com.evil")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(clientID: "abc-def.apps.googleusercontent.com")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(scheme: "com.googleusercontent.apps.other")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(
                infoDictionary: info(bundleID: "placeholder.bundle.id")))
        XCTAssertNil(GoogleAuthorizationConfiguration(infoDictionary: info(bundleID: "reader")))
        XCTAssertNil(
            GoogleAuthorizationConfiguration(infoDictionary: info(bundleID: "dev..reader")))
    }

    func testLastKnownAccountSupportsOfflineStateAndClearsAtExplicitLogout() throws {
        let suite = "GoogleAuthorizationTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let account = try GoogleAccount(id: "1122334455", email: "reader@example.org")
        defaults.set(
            try JSONEncoder().encode(account), forKey: "GoogleAuthorization.lastKnownAccount")

        let authorization = GoogleAuthorization(infoDictionary: info(), defaults: defaults)
        XCTAssertEqual(authorization.state, .disconnected)
        XCTAssertNil(authorization.account)
        XCTAssertNil(authorization.accountID)
        XCTAssertEqual(authorization.lastKnownAccount, account)

        authorization.signOut()
        XCTAssertEqual(authorization.state, .disconnected)
        XCTAssertNil(authorization.lastKnownAccount)
        XCTAssertNil(defaults.data(forKey: "GoogleAuthorization.lastKnownAccount"))
    }

    func testAccountIdentityAndDriveScope() throws {
        let account = try GoogleAccount(id: "1122334455", email: "reader@example.org")
        XCTAssertEqual(account.id, "1122334455")
        XCTAssertEqual(account.email, "reader@example.org")
        XCTAssertThrowsError(try GoogleAccount(id: nil, email: "reader@example.org"))
        XCTAssertThrowsError(try GoogleAccount(id: "1122334455", email: nil))
        XCTAssertFalse(GoogleAuthorization.hasDriveFileScope(nil))
        XCTAssertFalse(
            GoogleAuthorization.hasDriveFileScope(["https://www.googleapis.com/auth/drive.readonly"]
            ))
        XCTAssertTrue(GoogleAuthorization.hasDriveFileScope([GoogleAuthorization.driveFileScope]))
    }
}
