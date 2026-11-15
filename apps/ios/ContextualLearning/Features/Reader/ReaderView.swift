import SwiftUI
import UIKit

enum ExternalPlaybackFailure: LocalizedError {
    case invalidLink, unavailable, positionNotSaved, unsupportedSeeking
    var errorDescription: String? {
        switch self {
        case .invalidLink: "這個影片時間連結無法使用。"
        case .unavailable: "無法開啟影片。請稍後再試，或使用原始來源連結。"
        case .positionNotSaved: "尚未儲存閱讀位置，請稍後再試。"
        case .unsupportedSeeking: "Netflix 時間僅供參考，請在 Netflix 手動調整播放位置。"
        }
    }
}

enum ExternalPlaybackAction { case timestamp, source }

@MainActor
func openExternalPlayback(
    _ link: ExternalPlaybackLink,
    action: ExternalPlaybackAction = .timestamp,
    moment: NetflixMomentTemplate? = nil,
    prepare: @MainActor () async throws -> Void = {},
    open: @MainActor (URL, Bool) async -> Bool
) async throws {
    guard link.validatedURL != nil else { throw ExternalPlaybackFailure.invalidLink }
    if action == .timestamp && link.platform == .netflix {
        guard let url = moment?.playbackURL(for: link) else {
            throw ExternalPlaybackFailure.unsupportedSeeking
        }
        try await prepare()
        guard await open(url, true) else { throw ExternalPlaybackFailure.unavailable }
        return
    }
    guard let url = action == .source ? link.sourceURL : link.validatedURL else {
        throw ExternalPlaybackFailure.invalidLink
    }
    try await prepare()
    if await open(url, true) { return }
    guard await open(url, false) else { throw ExternalPlaybackFailure.unavailable }
}

@MainActor
func systemPlaybackOpen(_ url: URL, universalLinksOnly: Bool) async -> Bool {
    #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-testing") {
            if arguments.contains("--playback-open-failure") { return false }
            if arguments.contains("--playback-open-success") { return true }
        }
    #endif
    return await UIApplication.shared.open(
        url, options: [.universalLinksOnly: universalLinksOnly])
}

struct ExternalPlaybackButton: View {
    let link: ExternalPlaybackLink
    let identifier: String
    var action: ExternalPlaybackAction = .timestamp
    var prepare: @MainActor () async throws -> Void = {}
    var open: @MainActor (URL, Bool) async -> Bool = systemPlaybackOpen
    var title: String? = nil
    var onPlay: ((ExternalPlaybackLink) -> Void)? = nil
    @State private var opening = false
    @State private var failure: String?
    @AppStorage(NetflixMomentLinks.defaultsKey) private var momentLinks = "{}"
    @Environment(\.appPalette) private var palette

    private var embedded: Bool {
        action == .timestamp && link.usesEmbeddedPlayback(hasPlayer: onPlay != nil)
    }
    private var opensNetflix: Bool { link.platform == .netflix && action == .source }
    private var moment: NetflixMomentTemplate? {
        NetflixMomentLinks(momentLinks).template(for: link)
    }
    private var playsMoment: Bool {
        link.platform == .netflix && action == .timestamp && moment != nil
    }

    var body: some View {
        if link.validatedURL != nil {
            if link.platform == .netflix && action == .timestamp && moment == nil {
                Label("參考時間 \(link.timestamp)", systemImage: "clock")
                    .font(.subheadline).foregroundStyle(palette.secondaryText)
                    .textSelection(.enabled)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Netflix 參考時間 \(link.timestamp)")
                    .accessibilityIdentifier(identifier)
            } else {
                Button {
                    opening = true
                    Task { @MainActor in
                        defer { opening = false }
                        do {
                            if embedded, let onPlay {
                                try await prepare()
                                onPlay(link)
                            } else {
                                try await openExternalPlayback(
                                    link, action: action, moment: moment, prepare: prepare,
                                    open: open)
                            }
                        } catch { failure = error.localizedDescription }
                    }
                } label: {
                    Label(
                        title
                            ?? (opensNetflix
                                ? "在 Netflix 開啟影片"
                                : "\(playsMoment ? "Netflix 片段" : link.platformName) · \(link.timestamp)"),
                        systemImage: embedded ? "play.rectangle" : "arrow.up.right.square"
                    )
                    .fixedSize(horizontal: false, vertical: true)
                }
                .font(.subheadline).buttonStyle(.borderless).disabled(opening)
                .accessibilityLabel(
                    opensNetflix
                        ? "在 Netflix 開啟影片"
                        : playsMoment
                            ? "在 Netflix 播放片段，起點 \(link.timestamp)"
                            : embedded
                                ? "在 App 內播放，時間 \(link.timestamp)"
                                : "在 \(link.platformName) 開啟，時間 \(link.timestamp)"
                )
                .accessibilityHint(embedded ? "在教材上方顯示影片。" : "離開 App 開啟影片，返回後繼續閱讀。")
                .accessibilityIdentifier(identifier)
                .alert(
                    "無法開啟影片",
                    isPresented: Binding(
                        get: { failure != nil }, set: { if !$0 { failure = nil } })
                ) {
                    Button("好", role: .cancel) { failure = nil }
                } message: {
                    Text(failure ?? "")
                }
            }
        }
    }
}

struct NetflixPlaybackNotice: View {
    let link: ExternalPlaybackLink
    let identifier: String
    var prepare: @MainActor () async throws -> Void = {}
    @Environment(\.appPalette) private var palette
    @AppStorage(NetflixMomentLinks.defaultsKey) private var momentLinks = "{}"
    @State private var editing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ExternalPlaybackButton(
                link: link, identifier: identifier, action: .source, prepare: prepare)
            Button(
                NetflixMomentLinks(momentLinks).template(for: link) == nil
                    ? "連結 Moments 片段" : "更換 Moments 連結"
            ) { editing = true }
            .accessibilityIdentifier("configure-netflix-moment")
            if let moment = NetflixMomentLinks(momentLinks).template(for: link) {
                Text("點原文時間會在 Netflix 播放片段，長度沿用分享連結的 \(moment.durationSeconds) 秒。")
                    .font(.caption).foregroundStyle(palette.secondaryText)
            } else {
                Text("先從 Netflix 分享這一集的任一 Moments 連結，即可啟用時間按鈕。未連結時，時間僅供參考。")
                    .font(.caption).foregroundStyle(palette.secondaryText)
            }
        }
        .sheet(isPresented: $editing) {
            NetflixMomentLinkEditor(
                link: link,
                initialURL: NetflixMomentLinks(momentLinks).template(for: link)?.originalURL ?? "")
        }
    }
}

struct NetflixMomentLinkEditor: View {
    let link: ExternalPlaybackLink
    @State private var text: String
    @State private var failure: String?
    @AppStorage(NetflixMomentLinks.defaultsKey) private var momentLinks = "{}"
    @Environment(\.dismiss) private var dismiss

    init(link: ExternalPlaybackLink, initialURL: String) {
        self.link = link
        // Seed once when the editor opens; subsequent edits belong to this sheet.
        _text = State(initialValue: initialURL)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("在 Netflix 開啟這一集，選「剪輯／Moments → 儲存 → 分享 → 複製連結」，再貼到這裡。每一集只需連結一次。")
                    TextField("完整 Moments 分享連結", text: $text, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL).accessibilityIdentifier("netflix-moment-url")
                    PasteButton(payloadType: String.self) { values in
                        if let value = values.first { text = value }
                    }
                    if let failure { Text(failure).foregroundStyle(.red) }
                    Text("將保留分享連結的識別與片段長度，只調整播放起點。連結保存在這台裝置，並適用於同一集的閱讀與複習。")
                        .font(.caption)
                }
                if NetflixMomentLinks(momentLinks).template(for: link) != nil {
                    Button("移除此集的連結", role: .destructive) {
                        momentLinks = NetflixMomentLinks(momentLinks).removing(for: link)
                        dismiss()
                    }.accessibilityIdentifier("remove-netflix-moment")
                }
            }
            .navigationTitle("連結 Netflix Moments")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("儲存") {
                        do {
                            momentLinks = try NetflixMomentLinks(momentLinks).saving(
                                text, for: link)
                            dismiss()
                        } catch { failure = error.localizedDescription }
                    }.accessibilityIdentifier("save-netflix-moment")
                }
            }
        }
    }
}

struct MaterialScreen: View {
    let storageID: String
    let library: LibraryModel
    let speech: SpeechService
    @State private var loader = MaterialLoadModel()

    var body: some View {
        Group {
            switch loader.state {
            case .loading: ProgressView("正在開啟教材…")
            case .failed(let message):
                ContentUnavailableView {
                    Label("無法開啟教材", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("重試") { load(retry: true) }
                }
            case .loaded(let material):
                ReaderView(
                    material: material, storageID: storageID, library: library, speech: speech)
            }
        }
        .onAppear { load() }
        .onChange(of: storageID) { _, _ in load() }
    }

    private func load(retry: Bool = false) {
        loader.load(storageID, retry: retry) {
            try await library.read(storageID)
        }
    }
}

private enum ReaderColumn {
    static let outerInset: CGFloat = 10
    static let textInset: CGFloat = 12
}

struct ReaderView: View {
    let material: Material
    let storageID: String
    let library: LibraryModel
    let speech: SpeechService
    @State private var selectedSceneID: String?
    @State private var visibleGroupID: String?
    @State private var showTranslation = true
    @State private var showPronunciation = false
    @State private var playback = YouTubePlaybackModel()
    @AppStorage("readerTextScale") private var textScale = 1.0
    @Environment(\.appPalette) private var palette

    private var scene: ReaderScene? {
        let target = selectedSceneID ?? library.snapshot.positions[storageID]?.sceneID
        return material.scenes.first { $0.id == target } ?? material.scenes.first
    }

    var body: some View {
        ScrollViewReader { proxy in
            YouTubePlaybackLayout(playback: playback) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        if let scene {
                            sceneHeader(scene)
                                .padding(.horizontal, ReaderColumn.textInset)
                            ForEach(showTranslation ? scene.groups : scene.untranslatedGroups) {
                                group in
                                ReaderGroupView(
                                    group: group, language: material.language,
                                    showTranslation: showTranslation,
                                    showPronunciation: showPronunciation, textScale: textScale,
                                    speech: speech, preparePlayback: preparePlayback,
                                    onPlay: playback.play
                                ) {
                                    Task {
                                        await library.toggleReview(
                                            storageID: storageID, material: material,
                                            scene: scene,
                                            group: group)
                                    }
                                } isReviewing: {
                                    library.isReviewing(
                                        storageID: storageID, material: material, scene: scene,
                                        group: group)
                                }
                                .id(group.id)
                            }
                        } else if let markdown = material.markdown {
                            Text(material.kind == .markdown ? "本機 Markdown" : "自訂教材").font(
                                .caption
                            )
                            .foregroundStyle(palette.secondaryText)
                            SafeMarkdownView(markdown: markdown, textScale: textScale)
                        }
                        if scene?.netflixPlaybackLink == nil,
                            let url = safeSourceURL(material.sourceURL)
                        {
                            Link(destination: url) {
                                Label("開啟原始來源", systemImage: "arrow.up.right.square")
                            }
                            .padding(.top, 12)
                            .padding(.horizontal, ReaderColumn.textInset)
                        }
                    }
                    .scrollTargetLayout()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(ReaderColumn.outerInset)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityIdentifier("reader-content-scroll")
                .scrollPosition(id: $visibleGroupID, anchor: .top)
            }
            // Apply to the layout container, not only its ScrollView: its
            // geometry clip otherwise retains a docked keyboard-sized gap.
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .navigationTitle(material.scenes.isEmpty ? material.title : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let scene {
                    ToolbarItem(placement: .topBarLeading) { sceneMenu(scene) }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Toggle("顯示翻譯", isOn: $showTranslation)
                            Toggle("顯示讀音", isOn: $showPronunciation)
                        } label: {
                            Label("閱讀顯示", systemImage: "textformat")
                        }
                        .accessibilityIdentifier("reader-display-options")
                    }
                }
            }
            .task(id: scene?.id) {
                guard let scene else { return }
                let position = library.snapshot.positions[storageID]
                let remembered = position?.sceneID == scene.id ? position?.groupID : nil
                visibleGroupID = remembered
                await library.position(
                    materialID: storageID, sceneID: scene.id, groupID: remembered)
                if let remembered { proxy.scrollTo(remembered, anchor: .top) }
            }
            .onChange(of: visibleGroupID) { _, groupID in
                guard let scene, let groupID, scene.groups.contains(where: { $0.id == groupID })
                else { return }
                Task {
                    await library.position(
                        materialID: storageID, sceneID: scene.id, groupID: groupID)
                }
            }
            .onChange(of: selectedSceneID) { _, _ in
                speech.stop()
                if let scene { proxy.scrollTo("scene-header-" + scene.id, anchor: .top) }
            }
            .onChange(of: scene?.id) { playback.close() }
            .onDisappear { speech.stop() }
        }
    }

    private func sceneMenu(_ scene: ReaderScene) -> some View {
        Menu {
            Picker(
                "場景",
                selection: Binding(get: { scene.id }, set: { selectedSceneID = $0 })
            ) {
                ForEach(material.scenes) { Text($0.title).tag($0.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet")
                Text(scene.title).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2)
            }
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: 220)
        }
        .accessibilityLabel("切換場景")
        .accessibilityValue(scene.title)
        .accessibilityIdentifier("scene-picker")
    }

    private func sceneHeader(_ scene: ReaderScene) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(scene.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("reader-scene-title")
            Text(scene.context).font(.subheadline).foregroundStyle(palette.secondaryText)
                .textSelection(
                    .enabled)
            if let link = scene.netflixPlaybackLink {
                NetflixPlaybackNotice(
                    link: link, identifier: "open-netflix-source", prepare: preparePlayback)
            }
            if let link = scene.playbackLink {
                ExternalPlaybackButton(
                    link: link, identifier: "play-scene-" + scene.id,
                    prepare: preparePlayback, onPlay: playback.play)
            }
        }.id("scene-header-" + scene.id)
    }

    @MainActor
    private func preparePlayback() async throws {
        speech.stop()
        guard let scene else { return }
        let groupID = visibleGroupID.flatMap { id in
            scene.groups.contains(where: { $0.id == id }) ? id : nil
        }
        guard
            await library.position(
                materialID: storageID, sceneID: scene.id, groupID: groupID)
        else { throw ExternalPlaybackFailure.positionNotSaved }
    }
}

struct ReaderGroupView: View {
    let group: ReaderGroup
    let language: String
    let showTranslation: Bool
    let showPronunciation: Bool
    let textScale: Double
    let speech: SpeechService
    var preparePlayback: (@MainActor () async throws -> Void)? = nil
    var onPlay: ((ExternalPlaybackLink) -> Void)? = nil
    @ScaledMetric(relativeTo: .title3) private var originalSize = 21
    var onReview: (() -> Void)? = nil
    var isReviewing: (() -> Bool)? = nil
    @Environment(\.appPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(group.rows) { row in
                VStack(alignment: .leading, spacing: 9) {
                    Text(row.text).font(
                        .system(size: originalSize * textScale, weight: .medium, design: .serif)
                    ).textSelection(.enabled)
                        .accessibilityIdentifier("source-" + row.id)
                    if showPronunciation, row.pronunciation.contains(where: { $0.reading != nil }) {
                        Text(row.pronunciation.map { $0.reading ?? $0.text }.joined(separator: " "))
                            .font(.subheadline).foregroundStyle(palette.secondaryText)
                            .textSelection(.enabled)
                    }
                    if showTranslation && !row.translation.isEmpty {
                        Text(row.translation).foregroundStyle(palette.secondaryText).textSelection(
                            .enabled
                        )
                        .accessibilityIdentifier("translation-" + row.id)
                    }
                    SentenceSpeechButton(
                        row: row, groupID: group.id, language: language, speech: speech)
                    if let link = row.playbackLink {
                        ExternalPlaybackButton(
                            link: link, identifier: "play-row-" + row.id,
                            prepare: {
                                speech.stop()
                                try await preparePlayback?()
                            }, onPlay: onPlay)
                    }
                }
            }
            if let onReview {
                Button(action: onReview) {
                    Label(
                        isReviewing?() == true ? "已加入本機複習" : "加入本機複習",
                        systemImage: isReviewing?() == true ? "bookmark.fill" : "bookmark")
                }.font(.subheadline).accessibilityIdentifier("review-" + group.id)
                    .tint(isReviewing?() == true ? palette.success : palette.secondaryText)
            }
            if !group.analyses.isEmpty {
                DisclosureGroup("語句解析") {
                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(group.analyses) {
                            AnalysisView(
                                analysis: $0, showTranslation: showTranslation,
                                textScale: textScale, speech: speech, language: language)
                        }
                    }.padding(.top, 12)
                }.accessibilityIdentifier("analysis-" + group.id).tint(palette.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(ReaderColumn.textInset)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.divider))
    }
}

struct SentenceSpeechButton: View {
    let row: ReaderRow
    let groupID: String
    let language: String
    let speech: SpeechService
    @Environment(\.appPalette) private var palette

    private var source: SentenceSpeechSource {
        SentenceSpeechSource(groupID: groupID, rowID: row.id)
    }

    private var isCurrent: Bool { speech.currentSource == source }
    private var title: String {
        isCurrent ? (speech.isPaused ? "繼續朗讀" : "暫停朗讀") : "朗讀句子"
    }
    private var symbol: String {
        isCurrent ? (speech.isPaused ? "play.fill" : "pause.fill") : "speaker.wave.2"
    }

    var body: some View {
        Button {
            speech.toggle(row.text, language: language, source: source)
        } label: {
            Label(title, systemImage: symbol)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .font(.subheadline).buttonStyle(.borderless)
        .accessibilityLabel((isCurrent ? title + "：" : "朗讀：") + row.text)
        .accessibilityIdentifier("speak-row-" + row.id)
        .tint(palette.secondaryText)
    }
}

struct AnalysisView: View {
    let analysis: ReaderAnalysis
    let showTranslation: Bool
    let textScale: Double
    let speech: SpeechService
    let language: String
    @ScaledMetric(relativeTo: .body) private var bodySize = 17
    @Environment(\.appPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !analysis.title.isEmpty {
                Text(analysis.title).font(.headline).textSelection(.enabled)
            }
            ForEach(analysis.basics) { basic in
                VStack(alignment: .leading, spacing: 8) {
                    if !basic.meaning.isEmpty { Text(basic.meaning).textSelection(.enabled) }
                    if !basic.contextExplanation.isEmpty {
                        Text(basic.contextExplanation).foregroundStyle(palette.secondaryText)
                            .textSelection(
                                .enabled)
                    }
                }
            }
            ForEach(analysis.chunks) { chunk in
                VStack(alignment: .leading, spacing: 6) {
                    Text(chunk.text).font(.headline).foregroundStyle(.primary).textSelection(
                        .enabled)
                    if !chunk.meaning.isEmpty { Text(chunk.meaning).textSelection(.enabled) }
                    if !chunk.role.isEmpty {
                        Text(chunk.role).font(.subheadline).foregroundStyle(palette.secondaryText)
                            .textSelection(.enabled)
                    }
                }.padding(.leading, 12).overlay(alignment: .leading) {
                    Rectangle().fill(palette.divider).frame(width: 1)
                }
            }
            ForEach(analysis.notes) { note in
                VStack(alignment: .leading, spacing: 5) {
                    Text(note.title).font(.subheadline.bold())
                    Text(note.explanation).textSelection(.enabled)
                }
            }
            ForEach(analysis.items) { item in
                VStack(alignment: .leading, spacing: 10) {
                    Text(item.expression).font(.headline).textSelection(.enabled)
                    ForEach(item.examples) { example in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(example.situation).font(.caption).foregroundStyle(
                                palette.secondaryText)
                            ForEach(example.dialogue) { line in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(line.text).textSelection(.enabled)
                                    if showTranslation {
                                        Text(line.translation).font(.subheadline).foregroundStyle(
                                            palette.secondaryText
                                        ).textSelection(.enabled)
                                    }
                                }
                            }
                        }.padding(12).background(
                            palette.mutedSurface, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
        }.font(.system(size: bodySize * textScale))
    }
}
