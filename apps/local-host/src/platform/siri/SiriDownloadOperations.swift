import Foundation
import ObjectiveC.runtime
import SiriTTSService

@objc protocol SiriDownloadDaemonProtocol {
    @objc(subscribedVoicesWithClientId:reply:)
    func subscriptions(clientId: String?, reply: @escaping (AnyObject?) -> Void)
    @objc(subscribeWithVoices:clientId:accessoryId:reply:)
    func subscribe(voices: [AnyObject], clientId: String, accessoryId: String?,
                   reply: @escaping (NSError?) -> Void)
}
private final class SiriDaemonReply<T> {
    private let lock = NSLock()
    private let done = DispatchSemaphore(value: 0)
    private var result: Result<T, Error>?
    func finish(_ value: Result<T, Error>) {
        lock.lock()
        defer { lock.unlock() }
        guard result == nil else { return }
        result = value
        done.signal()
    }
    func wait() throws -> T {
        guard done.wait(timeout: .now() + 12) == .success else {
            throw SiriDownloadError("The Siri download service did not respond.")
        }
        lock.lock()
        defer { lock.unlock() }
        return try result!.get()
    }
}
struct SiriDownloadSubscription {
    let clientId: String
    let accessoryId: String?
    let assetKey: String
}
final class SiriDownloadDaemon {
    private let connection: NSXPCConnection

    init() throws {
        guard let remoteProtocol = NSProtocolFromString("SiriTTSService.DaemonProtocol"),
              let subscriptionClass = NSClassFromString("SiriTTSVoiceSubscription"),
              let voiceClass = NSClassFromString("SiriTTSSynthesisVoice") else {
            throw SiriDownloadError("The Siri download service is incompatible.")
        }
        let methods = [
            ("subscribedVoicesWithClientId:reply:", "v32@0:8@16@?24"),
            ("subscribeWithVoices:clientId:accessoryId:reply:", "v48@0:8@16@24@32@?40"),
        ]
        for (name, expected) in methods {
            let description = protocol_getMethodDescription(remoteProtocol, NSSelectorFromString(name), true, true)
            guard let encoding = description.types, String(cString: encoding) == expected else {
                throw SiriDownloadError("The Siri download service ABI is incompatible.")
            }
        }
        for (klass, names) in [(subscriptionClass, ["clientId", "accessoryId", "voice"]),
                               (voiceClass, ["assetKey"])] {
            for name in names {
                guard let method = class_getInstanceMethod(klass, NSSelectorFromString(name)),
                      let encoding = method_getTypeEncoding(method),
                      String(cString: encoding) == "@16@0:8" else {
                    throw SiriDownloadError("The Siri subscription identity ABI is incompatible.")
                }
            }
        }
        let interface = NSXPCInterface(with: remoteProtocol)
        let classes = NSSet(array: [NSArray.self, NSMutableArray.self, NSDictionary.self,
            NSMutableDictionary.self, NSString.self, NSNumber.self, NSNull.self,
            subscriptionClass, voiceClass]) as! Set<AnyHashable>
        interface.setClasses(classes, for: NSSelectorFromString(methods[0].0), argumentIndex: 0, ofReply: true)
        interface.setClasses(classes, for: NSSelectorFromString(methods[1].0), argumentIndex: 0, ofReply: false)
        connection = NSXPCConnection(machServiceName: "com.apple.sirittsd", options: [])
        connection.remoteObjectInterface = interface
        connection.resume()
    }
    deinit { connection.invalidate() }

    func subscriptions() throws -> [SiriDownloadSubscription] {
        let reply = SiriDaemonReply<[SiriDownloadSubscription]>()
        let object = connection.remoteObjectProxyWithErrorHandler { reply.finish(.failure($0)) }
        let proxy = unsafeBitCast(object as AnyObject, to: SiriDownloadDaemonProtocol.self)
        proxy.subscriptions(clientId: nil) { raw in
            guard let values = raw as? [NSObject],
                  let subscriptionClass = NSClassFromString("SiriTTSVoiceSubscription"),
                  let voiceClass = NSClassFromString("SiriTTSSynthesisVoice") else {
                reply.finish(.failure(SiriDownloadError("Invalid Siri subscriptions response.")))
                return
            }
            var subscriptions: [SiriDownloadSubscription] = []
            for value in values {
                guard value.isKind(of: subscriptionClass),
                      let clientId = value.value(forKey: "clientId") as? String, !clientId.isEmpty,
                      let voice = value.value(forKey: "voice") as? NSObject,
                      voice.isKind(of: voiceClass),
                      let assetKey = voice.value(forKey: "assetKey") as? String, !assetKey.isEmpty else {
                    reply.finish(.failure(SiriDownloadError("Invalid Siri subscription identity.")))
                    return
                }
                let accessory = value.value(forKey: "accessoryId")
                guard accessory == nil || accessory is String else {
                    reply.finish(.failure(SiriDownloadError("Invalid Siri subscription accessory.")))
                    return
                }
                subscriptions.append(SiriDownloadSubscription(clientId: clientId,
                    accessoryId: accessory as? String, assetKey: assetKey))
            }
            reply.finish(.success(subscriptions))
        }
        return try reply.wait()
    }
    func replace(_ voices: [SynthesisVoice], operation: SiriDownloadOperation) throws {
        let operation = try operation.validated()
        guard voices.count <= 1 else { throw SiriDownloadError("Only one Siri voice may be requested.") }
        let reply = SiriDaemonReply<Void>()
        let object = connection.remoteObjectProxyWithErrorHandler { reply.finish(.failure($0)) }
        let proxy = unsafeBitCast(object as AnyObject, to: SiriDownloadDaemonProtocol.self)
        proxy.subscribe(voices: voices, clientId: operation.clientId, accessoryId: nil) { error in
            if let error { reply.finish(.failure(error)) }
            else { reply.finish(.success(())) }
        }
        try reply.wait()
    }
}

struct SiriDownloadObservation: Encodable {
    let operationId: String
    let voiceId: String
    let resource: String
    let subscription: String
    let ordering: String
    let cancelFenced: Bool
    let shared: Bool
}
struct SiriDownloadObservations: Encodable {
    let speechDownloadObservations: [SiriDownloadObservation]
}

func speechDownloadObservations(action: String, operations raw: [SiriDownloadOperation]) throws -> SiriDownloadObservations {
    guard (1...32).contains(raw.count), action == "inspectSpeechDownloads" || raw.count == 1 else {
        throw SiriDownloadError("Invalid Siri download operation count.")
    }
    let operations = try raw.map { try $0.validated() }
    guard Set(operations.map { $0.operationId }).count == operations.count else {
        throw SiriDownloadError("Duplicate Siri download operation.")
    }
    let journal = try SiriDownloadJournal()
    return try journal.withOperations(operations) {
        var receipts = try operations.map { try journal.load($0) }
        // Fence before catalog or daemon reads so a disconnected cancel still prevents a delayed start.
        if action == "cancelSpeechDownload" { try journal.fenceCancel(&receipts[0]) }
        let rows = try catalog()
        let session = DaemonSession()
        guard session.invokeDaemon() else { throw SiriDownloadError("Siri speech is unavailable.") }
        let native = try installed(session)
        let selected = try operations.map { operation -> CatalogVoice in
            guard let row = rows.first(where: { "siri:" + $0.identifier == operation.voiceId }) else {
                throw SiriDownloadError("The selected Siri voice is unavailable.")
            }
            return row
        }
        let daemon = try SiriDownloadDaemon()
        if action == "startSpeechDownload", !selected[0].info(native).installed,
           !selected[0].resourceAvailable {
            let voice = try selected[0].subscription()
            if try journal.enterStart(&receipts[0], assetKey: voice.assetKey) {
                try daemon.replace([voice], operation: operations[0])
                try journal.acknowledgeStart(&receipts[0])
            }
        } else if action == "cancelSpeechDownload" {
            let expectedKey = try receipts[0].assetKey ?? selected[0].subscription().assetKey
            try withdrawSpeechDownload(operations[0], assetKey: expectedKey, daemon: daemon)
        }
        let subscriptions = try daemon.subscriptions()
        let observations = try operations.enumerated().map { index, operation in
            let row = selected[index]
            let expectedKey = try receipts[index].assetKey ?? row.subscription().assetKey
            let own = subscriptions.filter { $0.clientId == operation.clientId }
            guard own.allSatisfy({ siriSubscriptionMatches($0.assetKey, expectedKey) && $0.accessoryId == nil }) else {
                throw SiriDownloadError("The Siri operation subscription identity does not match.")
            }
            var resourceKeys = try Set(rows.filter {
                $0.identifier == row.identifier ||
                (row.resourceAvailable && $0.resourceAvailable && $0.resourceSpecifier == row.resourceSpecifier)
            }.map { try $0.subscription().assetKey })
            resourceKeys.insert(expectedKey)
            let shared = subscriptions.contains { subscription in
                subscription.clientId != operation.clientId && resourceKeys.contains(where: {
                    siriSubscriptionMatches(subscription.assetKey, $0)
                })
            }
            let info = row.info(native)
            return SiriDownloadObservation(operationId: raw[index].operationId, voiceId: operation.voiceId,
                resource: info.installed ? "installed" : row.resourceAvailable ? "downloaded-unusable" : "absent",
                subscription: own.isEmpty ? "absent" : "present", ordering: receipts[index].ordering,
                cancelFenced: receipts[index].cancelFenced, shared: shared)
        }
        return SiriDownloadObservations(speechDownloadObservations: observations)
    }
}

private func withdrawSpeechDownload(_ operation: SiriDownloadOperation, assetKey: String,
                                    daemon: SiriDownloadDaemon) throws {
    let before = try daemon.subscriptions().filter { $0.clientId == operation.clientId }
    guard before.allSatisfy({ siriSubscriptionMatches($0.assetKey, assetKey) && $0.accessoryId == nil }) else {
        throw SiriDownloadError("The Siri operation subscription identity does not match.")
    }
    try daemon.replace([], operation: operation)
    guard try daemon.subscriptions().allSatisfy({ $0.clientId != operation.clientId }) else {
        throw SiriDownloadError("The Siri download request could not be withdrawn.")
    }
}

func removeSpeechResource(voiceId: String) throws -> Bool {
    let journal = try SiriDownloadJournal()
    return try journal.withLock("resource-changes") {
        let rows = try catalog()
        guard let row = rows.first(where: { "siri:" + $0.identifier == voiceId }), row.purgeable else {
            throw SiriDownloadError("The selected Siri resource is not removable.")
        }
        let aliases = rows.filter { $0.resourceSpecifier == row.resourceSpecifier }
        let voiceIds = Set(aliases.map { "siri:" + $0.identifier })
        let keys = try Set(aliases.map { try $0.subscription().assetKey })
        let operations = try journal.operationsForRemoval(voiceIds: voiceIds, assetKeys: keys)
        let daemon = try SiriDownloadDaemon()
        func ownedRequests() throws -> [SiriDownloadSubscription] {
            try daemon.subscriptions().filter { subscription in
                subscription.clientId.hasPrefix("dev.contextual.language_learning.siri-download.") &&
                keys.contains(where: { siriResourceMatches(subscription.assetKey, $0) })
            }
        }
        let clients = Set(operations.map { $0.clientId })
        guard try ownedRequests().allSatisfy({ clients.contains($0.clientId) }) else {
            throw SiriDownloadError("The Siri resource has an unrecognized application download request.")
        }
        for operation in operations {
            try journal.withOperations([operation]) {
                var receipt = try journal.load(operation)
                try journal.fenceCancel(&receipt)
                if let key = receipt.assetKey {
                    try withdrawSpeechDownload(operation, assetKey: key, daemon: daemon)
                } else {
                    guard !receipt.startEntered,
                          try daemon.subscriptions().allSatisfy({ $0.clientId != operation.clientId }) else {
                        throw SiriDownloadError("The Siri download receipt has no verified asset identity.")
                    }
                }
                guard receipt.ordering == "settled" else {
                    throw SiriDownloadError("The Siri download request has not settled. The resource was not removed.")
                }
            }
        }
        guard try ownedRequests().isEmpty else {
            throw SiriDownloadError("The Siri download request could not be withdrawn. The resource was not removed.")
        }
        return try removeResource(row)
    }
}
