import Darwin
import Foundation

struct SiriDownloadOperation: Codable {
    let operationId: String
    let voiceId: String

    func validated() throws -> SiriDownloadOperation {
        guard let uuid = UUID(uuidString: operationId),
              uuid.uuidString.lowercased() == operationId.lowercased(),
              voiceId.hasPrefix("siri:"), voiceId.count > 5, voiceId.utf8.count <= 256 else {
            throw SiriDownloadError("Invalid Siri download identity.")
        }
        return SiriDownloadOperation(operationId: uuid.uuidString.lowercased(), voiceId: voiceId)
    }
    var clientId: String { "dev.contextual.language_learning.siri-download." + operationId }
}
struct SiriDownloadError: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
struct SiriDownloadReceipt: Codable {
    let version: Int
    let operationId: String
    let voiceId: String
    var startEntered: Bool
    var startAcknowledged: Bool
    var cancelFenced: Bool
    var assetKey: String?

    init(_ operation: SiriDownloadOperation) {
        version = 1
        operationId = operation.operationId
        voiceId = operation.voiceId
        startEntered = false
        startAcknowledged = false
        cancelFenced = false
        assetKey = nil
    }
    var ordering: String {
        startAcknowledged || (!startEntered && cancelFenced) ? "settled" : "unconfirmed"
    }
}

final class SiriDownloadJournal {
    let directory: URL

    init(directory: URL? = nil) throws {
        self.directory = directory ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Contextual Language Learning/siri-downloads-v1")
        try FileManager.default.createDirectory(at: self.directory,
            withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var info = stat()
        guard lstat(self.directory.path, &info) == 0,
              info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(),
              info.st_mode & 0o077 == 0 else {
            throw SiriDownloadError("The Siri download journal is not private.")
        }
    }

    private func openPrivate(_ path: String, flags: Int32) throws -> Int32 {
        let fd = Darwin.open(path, flags | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw SiriDownloadError("Could not open the Siri download journal.") }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_mode & 0o077 == 0, info.st_nlink == 1 else {
            Darwin.close(fd)
            throw SiriDownloadError("The Siri download journal file is not private.")
        }
        return fd
    }

    func withLock<T>(_ name: String, _ body: () throws -> T) throws -> T {
        let fd = try openPrivate(directory.appendingPathComponent(name + ".lock").path,
                                 flags: O_RDWR | O_CREAT)
        defer { Darwin.close(fd) }
        let deadline = Date(timeIntervalSinceNow: 20)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else {
                throw SiriDownloadError("The Siri download operation is busy.")
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        defer { _ = flock(fd, LOCK_UN) }
        return try body()
    }

    func withOperations<T>(_ operations: [SiriDownloadOperation], _ body: () throws -> T) throws -> T {
        let ids = Array(Set(try operations.map { try $0.validated().operationId })).sorted()
        func acquire(_ index: Int) throws -> T {
            if index == ids.count { return try body() }
            return try withLock(ids[index]) { try acquire(index + 1) }
        }
        return try acquire(0)
    }

    func load(_ operation: SiriDownloadOperation) throws -> SiriDownloadReceipt {
        let operation = try operation.validated()
        guard let receipt = try readReceipt(operation.operationId) else { return SiriDownloadReceipt(operation) }
        guard receipt.voiceId == operation.voiceId else {
            throw SiriDownloadError("The Siri download receipt identity does not match.")
        }
        return receipt
    }

    private func readReceipt(_ operationId: String) throws -> SiriDownloadReceipt? {
        let path = directory.appendingPathComponent(operationId + ".json").path
        var info = stat()
        if lstat(path, &info) != 0 {
            guard errno == ENOENT else { throw SiriDownloadError("Could not read the Siri download receipt.") }
            return nil
        }
        let fd = try openPrivate(path, flags: O_RDONLY)
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        let data = try handle.read(upToCount: 8193) ?? Data()
        guard data.count <= 8192 else { throw SiriDownloadError("Invalid Siri download receipt.") }
        let receipt = try JSONDecoder().decode(SiriDownloadReceipt.self, from: data)
        let operation = try SiriDownloadOperation(operationId: receipt.operationId, voiceId: receipt.voiceId).validated()
        guard receipt.version == 1, receipt.operationId == operationId,
              receipt.operationId == operation.operationId,
              !receipt.startAcknowledged || receipt.startEntered else {
            throw SiriDownloadError("The Siri download receipt identity does not match.")
        }
        return receipt
    }

    func operationsForRemoval(voiceIds: Set<String>, assetKeys: Set<String>) throws -> [SiriDownloadOperation] {
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        var operations: [SiriDownloadOperation] = []
        for file in files where file.pathExtension == "json" {
            let id = file.deletingPathExtension().lastPathComponent
            guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id,
                  let receipt = try readReceipt(id) else {
                throw SiriDownloadError("Invalid Siri download receipt identity.")
            }
            if voiceIds.contains(receipt.voiceId) || receipt.assetKey.map({ key in
                assetKeys.contains(where: { siriResourceMatches(key, $0) })
            }) == true {
                operations.append(SiriDownloadOperation(operationId: id, voiceId: receipt.voiceId))
            }
        }
        return operations
    }

    func save(_ receipt: SiriDownloadReceipt) throws {
        let operation = try SiriDownloadOperation(operationId: receipt.operationId, voiceId: receipt.voiceId).validated()
        let path = directory.appendingPathComponent(operation.operationId + ".json").path
        let temporary = directory.appendingPathComponent("." + UUID().uuidString + ".tmp").path
        let fd = try openPrivate(temporary, flags: O_WRONLY | O_CREAT | O_EXCL)
        defer { Darwin.close(fd); _ = unlink(temporary) }
        let data = try JSONEncoder().encode(receipt)
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw SiriDownloadError("Could not persist the Siri download receipt.") }
                offset += count
            }
        }
        guard fsync(fd) == 0, fcntl(fd, F_FULLFSYNC) == 0, rename(temporary, path) == 0 else {
            throw SiriDownloadError("Could not persist the Siri download receipt.")
        }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { throw SiriDownloadError("Could not persist the Siri download journal.") }
        defer { Darwin.close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw SiriDownloadError("Could not persist the Siri download journal.") }
    }

    func enterStart(_ receipt: inout SiriDownloadReceipt, assetKey: String? = nil) throws -> Bool {
        guard !receipt.cancelFenced, !receipt.startEntered else { return false }
        receipt.assetKey = assetKey
        receipt.startEntered = true
        try save(receipt)
        return true
    }
    func acknowledgeStart(_ receipt: inout SiriDownloadReceipt) throws {
        guard receipt.startEntered, !receipt.cancelFenced else {
            throw SiriDownloadError("Invalid Siri download start acknowledgement.")
        }
        receipt.startAcknowledged = true
        try save(receipt)
    }
    func fenceCancel(_ receipt: inout SiriDownloadReceipt) throws {
        receipt.cancelFenced = true
        try save(receipt)
    }
}

func siriSubscriptionMatches(_ actual: String, _ expected: String) -> Bool {
    let value = actual.components(separatedBy: ":")
    let target = expected.components(separatedBy: ":")
    guard value.count == 6, target.count == 6 else { return false }
    let canonicalWithoutVersion = value[2] == "undefined" &&
        value[4] == "undefined" && value[5] == "0"
    return value[0].caseInsensitiveCompare(target[0]) == .orderedSame &&
        value[1] == target[1] &&
        (value[2] == "undefined" || value[2] == target[2]) &&
        value[3].caseInsensitiveCompare(target[3]) == .orderedSame &&
        (value[4] == "undefined" || value[4] == target[4]) &&
        (value[5] == target[5] || canonicalWithoutVersion)
}

func siriResourceMatches(_ actual: String, _ expected: String) -> Bool {
    let value = actual.components(separatedBy: ":")
    let target = expected.components(separatedBy: ":")
    guard value.count == 6, target.count == 6 else { return false }
    return value[0].caseInsensitiveCompare(target[0]) == .orderedSame &&
        value[1] == target[1] &&
        value[3].caseInsensitiveCompare(target[3]) == .orderedSame &&
        (value[4] == "undefined" || value[4] == target[4])
}
