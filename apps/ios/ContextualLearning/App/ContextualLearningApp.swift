import SwiftUI
import UIKit

@main
struct ContextualLearningApp: App {
    @State private var library: LibraryModel
    @State private var cloud: CloudLibraryModel
    @State private var speech = SpeechService()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let isUITest = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        let root =
            isUITest
            ? URL.applicationSupportDirectory.appendingPathComponent(
                "ContextualLearningUITests", isDirectory: true) : nil
        if isUITest && ProcessInfo.processInfo.arguments.contains("--reset-library"), let root {
            try? FileManager.default.removeItem(at: root)
        }
        #if DEBUG
            if isUITest && ProcessInfo.processInfo.arguments.contains("--reset-library") {
                UserDefaults.standard.removeObject(forKey: NetflixMomentLinks.defaultsKey)
            }
            let arguments = ProcessInfo.processInfo.arguments
            if let index = arguments.firstIndex(of: "--netflix-seed-moment"),
                arguments.indices.contains(index + 1),
                let moment = try? NetflixMomentTemplate(arguments[index + 1])
            {
                let link = ExternalPlaybackLink(
                    startMs: 0,
                    webURL: "https://www.netflix.com/watch/" + moment.videoID)
                let current =
                    UserDefaults.standard.string(forKey: NetflixMomentLinks.defaultsKey) ?? "{}"
                if let json = try? NetflixMomentLinks(current).saving(moment.originalURL, for: link)
                {
                    UserDefaults.standard.set(json, forKey: NetflixMomentLinks.defaultsKey)
                }
            }
            if isUITest && ProcessInfo.processInfo.arguments.contains("--reset-appearance") {
                UserDefaults.standard.removeObject(forKey: "appColorTheme")
                UserDefaults.standard.removeObject(forKey: "appAppearance")
            }
            if isUITest && ProcessInfo.processInfo.arguments.contains("--seed-import-file"),
                let sample = Bundle.main.url(forResource: "sample-lesson", withExtension: "json")
            {
                let folder = URL.documentsDirectory.appendingPathComponent(
                    "UI Test Imports", isDirectory: true)
                try? FileManager.default.createDirectory(
                    at: folder, withIntermediateDirectories: true)
                try? Data(contentsOf: sample).write(
                    to: folder.appendingPathComponent("Import-test.json"), options: .atomic)
            }
        #endif
        let location =
            root
            ?? URL.applicationSupportDirectory.appendingPathComponent(
                "ContextualLearning", isDirectory: true)
        let contract = ContractEngine()
        let repository = LibraryRepository(root: location, contract: contract)
        let model = LibraryModel(repository: repository)
        library = model
        cloud = CloudLibraryModel(
            library: model, repository: repository, authorization: GoogleAuthorization(),
            contract: contract)
    }

    var body: some Scene {
        WindowGroup {
            readerRoot
        }
    }

    private var readerRoot: some View {
        Group {
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing"),
                    ProcessInfo.processInfo.arguments.contains("--drive-actions-fixture")
                {
                    DriveDownloadInteractionFixture()
                } else {
                    AppRootView(library: library, speech: speech, cloud: cloud)
                }
            #else
                AppRootView(library: library, speech: speech, cloud: cloud)
            #endif
        }
        .task {
            await library.load()
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing"),
                    ProcessInfo.processInfo.arguments.contains("--preload-sample"),
                    library.visibleMaterials.isEmpty
                {
                    await library.importSample()
                }
            #endif
            await cloud.authorization.restoreIfConfigured()
            await cloud.activateAccount()
        }
        .onOpenURL { cloud.authorization.handle($0) }
        .onChange(of: cloud.account?.id) { _, _ in Task { await cloud.activateAccount() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { speech.stop() } }
    }
}

struct AppRootView: View {
    @Bindable var library: LibraryModel
    let speech: SpeechService
    let cloud: CloudLibraryModel
    @AppStorage("appColorTheme") private var colorTheme = AppColorTheme.ocean.rawValue
    @AppStorage("appAppearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        let palette = AppPalette(theme: .resolved(colorTheme))
        TabView {
            LibraryView(library: library, speech: speech, cloud: cloud)
                .tabItem { Label("教材庫", systemImage: "books.vertical") }
            ReviewView(library: library, speech: speech)
                .tabItem { Label("複習", systemImage: "rectangle.on.rectangle") }
            SettingsView(library: library, speech: speech, cloud: cloud)
                .tabItem { Label("設定", systemImage: "gearshape") }
        }
        .tint(palette.accent)
        .environment(\.appPalette, palette)
        .preferredColorScheme(AppAppearance.resolved(appearance).colorScheme)
        .alert(
            "無法完成操作",
            isPresented: Binding(
                get: { library.failure != nil }, set: { if !$0 { library.failure = nil } })
        ) {
            Button("好", role: .cancel) { library.failure = nil }
        } message: {
            Text(library.failure?.message ?? "")
        }
    }
}

enum AppColorTheme: String, CaseIterable, Identifiable {
    case warm, ocean, forest, indigo
    var id: String { rawValue }
    static func resolved(_ raw: String) -> Self { Self(rawValue: raw) ?? .ocean }
    var title: String {
        switch self {
        case .warm: "暖陶"
        case .ocean: "海藍"
        case .forest: "森綠"
        case .indigo: "經典靛藍"
        }
    }
    var detail: String {
        switch self {
        case .warm: "溫暖的橘棕色"
        case .ocean: "沉穩的藍色"
        case .forest: "柔和的綠色"
        case .indigo: "熟悉的靛藍色"
        }
    }
    var accentPair: (UInt32, UInt32) {
        switch self {
        case .warm: (0xA34A00, 0xFFAF60)
        case .ocean: (0x0066CC, 0x64B5FF)
        case .forest: (0x237A45, 0x72D797)
        case .indigo: (0x5852B8, 0xADA7FF)
        }
    }
    var softPair: (UInt32, UInt32) {
        switch self {
        case .warm: (0xFFF1E3, 0x3B2B1C)
        case .ocean: (0xEAF3FF, 0x16314D)
        case .forest: (0xEAF7EE, 0x1B3525)
        case .indigo: (0xF0EEFF, 0x2B2945)
        }
    }
}

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    static func resolved(_ raw: String) -> Self { Self(rawValue: raw) ?? .system }
    var title: String {
        switch self {
        case .system: "跟隨系統"
        case .light: "淺色"
        case .dark: "深色"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct AppPalette {
    let theme: AppColorTheme
    var accent: Color { Self.color(theme.accentPair.0, theme.accentPair.1) }
    var accentSurface: Color { Self.color(theme.softPair.0, theme.softPair.1) }
    var onAccent: Color { Self.color(0xFFFFFF, 0x17191C) }
    var primaryText: Color { Self.color(0x1F2328, 0xF2F3F5) }
    var canvas: Color { Self.color(0xFFFFFF, 0x0E0F11) }
    var sidebar: Color { Self.color(0xF1F2F4, 0x202124) }
    var surface: Color { Self.color(0xFFFFFF, 0x1B1C1F) }
    var mutedSurface: Color { Self.color(0xF4F5F7, 0x292A2D) }
    var secondaryText: Color { Self.color(0x545960, 0xB9BEC6) }
    var divider: Color { Self.color(0xDADDE2, 0x43464C) }
    var success: Color { Self.color(0x237A45, 0x72D797) }
    var error: Color { Self.color(0xB42325, 0xFFB4AB) }

    private static func color(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(
            uiColor: UIColor { traits in
                let rgb = traits.userInterfaceStyle == .dark ? dark : light
                return UIColor(
                    red: Double((rgb >> 16) & 255) / 255,
                    green: Double((rgb >> 8) & 255) / 255,
                    blue: Double(rgb & 255) / 255, alpha: 1)
            })
    }
}

private struct AppPaletteKey: EnvironmentKey {
    static let defaultValue = AppPalette(theme: .ocean)
}

extension EnvironmentValues {
    var appPalette: AppPalette {
        get { self[AppPaletteKey.self] }
        set { self[AppPaletteKey.self] = newValue }
    }
}
