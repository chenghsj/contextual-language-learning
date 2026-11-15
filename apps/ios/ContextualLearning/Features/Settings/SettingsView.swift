import SwiftUI

struct SettingsView: View {
    let library: LibraryModel
    @Bindable var speech: SpeechService
    let cloud: CloudLibraryModel
    @AppStorage("readerTextScale") private var textScale = 1.0
    @State private var selectedPreviewLanguage: String?
    @Environment(\.appPalette) private var palette
    @AppStorage("appColorTheme") private var colorTheme = AppColorTheme.ocean.rawValue
    @AppStorage("appAppearance") private var appearance = AppAppearance.system.rawValue

    private var previewLanguage: SpeechPreviewLanguage {
        SpeechPreviewLanguage.initial(
            for: selectedPreviewLanguage ?? library.recent?.language
                ?? library.visibleMaterials.first?.language)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(
                        "外觀",
                        selection: Binding(
                            get: { AppAppearance.resolved(appearance) },
                            set: { appearance = $0.rawValue }
                        )
                    ) {
                        ForEach(AppAppearance.allCases) { item in Text(item.title).tag(item) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("appearance-picker")
                    Picker(
                        "配色",
                        selection: Binding(
                            get: { AppColorTheme.resolved(colorTheme) },
                            set: { colorTheme = $0.rawValue }
                        )
                    ) {
                        ForEach(AppColorTheme.allCases) { item in Text(item.title).tag(item) }
                    }
                    .pickerStyle(.menu)
                    .accessibilityValue(AppColorTheme.resolved(colorTheme).title)
                    .accessibilityIdentifier("theme-picker")
                } header: {
                    Text("主題與外觀")
                } footer: {
                    Text("變更會自動保存，並套用到整個 App。")
                        .foregroundStyle(palette.secondaryText)
                }
                Section("閱讀") {
                    Slider(value: $textScale, in: 0.85...1.5, step: 0.05) { Text("文字大小") }
                    Text("文字大小 \(Int(textScale * 100))%\n同時支援系統的較大字體與 VoiceOver。")
                        .font(.caption).foregroundStyle(palette.secondaryText)
                }
                Section("系統朗讀") {
                    LabeledContent("語音與語速", value: "由輔助使用設定管理")
                        .accessibilityIdentifier("speech-system-management")
                    Picker(
                        "試聽語言",
                        selection: Binding(
                            get: { previewLanguage.id }, set: { selectedPreviewLanguage = $0 })
                    ) {
                        ForEach(SpeechPreviewLanguage.all) { language in
                            Text(language.label).tag(language.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("speech-preview-language")
                    Button(
                        speech.isSpeaking ? "停止試聽" : "試聽語音",
                        systemImage: speech.isSpeaking ? "stop.fill" : "speaker.wave.2"
                    ) {
                        if speech.isSpeaking {
                            speech.stop()
                        } else {
                            speech.preview(language: previewLanguage.id)
                        }
                    }.accessibilityIdentifier("preview-speech-voice")
                    if let notice = speech.notice {
                        Text(notice).foregroundStyle(palette.secondaryText)
                    }
                    Text(
                        "閱讀與複習會依教材語言，沿用系統輔助使用的朗讀語音與語速。試聽語言只影響這裡的試聽。"
                    )
                    .font(.caption).foregroundStyle(palette.secondaryText)
                    Text(
                        "調整方式：開啟 iPad 或 iPhone 的「設定 → 輔助使用」，找到「朗讀與語音／朗讀內容（Read & Speak）」，在「聲音」選擇語言與聲音，並調整朗讀速度。"
                    )
                    .font(.caption).foregroundStyle(palette.secondaryText)
                }
                Section("本機內容") {
                    LabeledContent("教材", value: "\(library.visibleMaterials.count) 份")
                    LabeledContent(
                        "內容大小",
                        value: ByteCountFormatter.string(
                            fromByteCount: Int64(library.totalBytes), countStyle: .file))
                    LabeledContent("複習清單", value: "\(library.reviewEntries.count) 組")
                    Text("教材與複習資料保存在這台裝置。可在教材庫左滑移除副本，原始檔案不受影響。")
                        .font(.caption).foregroundStyle(palette.secondaryText)
                }
                Section("Google Drive") { GoogleConnectionView(cloud: cloud, library: library) }
                Section("關於") {
                    Text("Contextual Language Learning")
                    Text("iPhone 與 iPad 原生閱讀器")
                        .font(.subheadline).foregroundStyle(palette.secondaryText)
                    Button("匯入範例教材") { Task { await library.importSample() } }.disabled(
                        library.isImporting)
                }
            }
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .background(palette.mutedSurface)
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("重設外觀") {
                        colorTheme = AppColorTheme.ocean.rawValue
                        appearance = AppAppearance.system.rawValue
                    }
                    .disabled(
                        AppColorTheme.resolved(colorTheme) == .ocean
                            && AppAppearance.resolved(appearance) == .system
                    )
                    .accessibilityLabel("恢復預設外觀")
                    .accessibilityHint("恢復海藍與跟隨系統，保留教材和閱讀設定。")
                    .accessibilityIdentifier("reset-appearance")
                }
            }
            .onChange(of: previewLanguage.id) { _, _ in speech.stop() }
            .onDisappear { speech.stop() }
        }
    }
}
