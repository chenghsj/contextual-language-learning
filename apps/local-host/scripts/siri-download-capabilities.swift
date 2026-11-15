import Darwin
import Foundation
import ObjectiveC.runtime

let frameworkNames = ["SiriTTSService", "MobileAsset", "TextToSpeech", "UnifiedAssetFramework"]
var frameworks: [[String: Any]] = []
var handles: [UnsafeMutableRawPointer] = []
for name in frameworkNames {
    let path = "/System/Library/PrivateFrameworks/\(name).framework/\(name)"
    let handle = dlopen(path, RTLD_LAZY | RTLD_LOCAL)
    if let handle { handles.append(handle) }
    frameworks.append(["name": name, "loaded": handle != nil])
}

let methodPattern = try NSRegularExpression(
    pattern: "cancel|subscrib|download|lock|status|progress|eliminat|remove",
    options: .caseInsensitive)
func relevantMethods(_ cls: AnyClass, includeAll: Bool = false) -> [[String: String]] {
    var count: UInt32 = 0
    guard let methods = class_copyMethodList(cls, &count) else { return [] }
    defer { free(methods) }
    return (0..<Int(count)).compactMap { index in
        let method = methods[index]
        let selector = NSStringFromSelector(method_getName(method))
        let range = NSRange(selector.startIndex..., in: selector)
        guard includeAll || methodPattern.firstMatch(in: selector, range: range) != nil else { return nil }
        return [
            "selector": selector,
            "encoding": method_getTypeEncoding(method).map { String(cString: $0) } ?? "",
        ]
    }.sorted { $0["selector"]! < $1["selector"]! }
}

let capacity = objc_getClassList(nil, 0)
guard capacity > 0 else { fatalError("Objective-C runtime class enumeration is unavailable") }
let classes = UnsafeMutablePointer<AnyClass>.allocate(capacity: Int(capacity))
defer { classes.deallocate() }
let count = min(capacity, objc_getClassList(AutoreleasingUnsafeMutablePointer(classes), capacity))
let records: [[String: Any]] = (0..<Int(count)).compactMap { index in
    let cls: AnyClass = classes[index]
    let name = NSStringFromClass(cls)
    let includeAll = ["TTSAsset", "TTSAssetType", "SiriTTSDaemonSession", "UAFAssetSetManager", "UAFAssetSubscription"].contains(name)
    guard name.hasPrefix("MAAutoAsset") || name == "MAAsset" ||
        name.contains("DaemonSession") || name.contains("TTSAsset") || name.hasPrefix("UAF") else { return nil }
    return [
        "name": name,
        "instanceMethods": relevantMethods(cls, includeAll: includeAll),
        "classMethods": object_getClass(cls).map { relevantMethods($0, includeAll: includeAll) } ?? [],
    ]
}.sorted { ($0["name"] as! String) < ($1["name"] as! String) }

var report: [String: Any] = [
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "inspectionOnly": true,
    "frameworks": frameworks,
    "classes": records,
    "cancellationGate": "INCONCLUSIVE",
    "reason": "Runtime method presence does not prove a download can be cancelled or its result verified.",
]
if CommandLine.arguments.contains("--catalog") {
    guard let assetClass = NSClassFromString("SiriTTSService.TTSAsset"),
        let typeClass = NSClassFromString("TTSAssetType"),
        class_getClassMethod(typeClass, NSSelectorFromString("gryphonVoice")) != nil,
        class_getClassMethod(assetClass, NSSelectorFromString("listAssetsOfTypes:matching:")) != nil,
        let voiceType = (typeClass as AnyObject).perform(NSSelectorFromString("gryphonVoice"))?.takeUnretainedValue(),
        let assets = (assetClass as AnyObject).perform(
            NSSelectorFromString("listAssetsOfTypes:matching:"), with: NSArray(object: voiceType),
            with: NSDictionary())?.takeUnretainedValue() as? [NSObject]
    else { fatalError("Siri asset catalog is unavailable") }
    let fields = ["identifier", "name", "primaryLanguage", "technology", "locallyAvailable", "downloadSize", "downloading"]
    report["assets"] = assets.map { asset -> [String: Any] in
        var entry: [String: Any] = ["class": NSStringFromClass(type(of: asset))]
        for field in fields {
            guard class_getInstanceMethod(type(of: asset), NSSelectorFromString(field)) != nil,
                let value = asset.value(forKey: field) else { continue }
            if let string = value as? String { entry[field] = string }
            else if let number = value as? NSNumber { entry[field] = number }
        }
        return entry
    }
}
let output = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(output)
FileHandle.standardOutput.write(Data("\n".utf8))
