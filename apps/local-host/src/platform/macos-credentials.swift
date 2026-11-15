import Foundation
import Security

// Only stdin/stdout carry credential data. argv and diagnostic output never contain it.
struct Request: Decodable {
    let action: String
    let service: String
    let account: String
    let value: String?
}
func fail() -> Never {
    fputs("macOS Keychain operation failed.\n", stderr)
    exit(1)
}
do {
    let request = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
    guard request.service == "dev.contextual.language-learning.ai.v1",
          request.account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { fail() }
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: request.service,
        kSecAttrAccount as String: request.account,
        kSecAttrSynchronizable as String: false,
    ]
    var response: [String: Any]
    if request.action == "read" {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { response = ["missing": true] }
        else {
            guard status == errSecSuccess, let data = result as? Data,
                  let value = String(data: data, encoding: .utf8) else { fail() }
            response = ["value": value]
        }
    } else if request.action == "write", let value = request.value {
        let attributes = [kSecValueData as String: Data(value.utf8)]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = Data(value.utf8)
            item[kSecAttrLabel as String] = "Contextual Language Learning AI credentials"
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { fail() }
        } else if status != errSecSuccess { fail() }
        response = ["value": ""]
    } else { fail() }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: response))
} catch { fail() }
