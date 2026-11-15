import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    let library: LibraryModel
    let speech: SpeechService
    let cloud: CloudLibraryModel
    @State private var selection: String?
    @State private var search = ""
    @State private var language = "all"
    @State private var showImporter = false
    @State private var showCloud = false
    @State private var pendingRemovalIDs: Set<String>?
    @State private var isSelecting = false
    @State private var selectedIDs = Set<String>()
    @Environment(\.appPalette) private var palette

    private var filtered: [MaterialSummary] {
        library.visibleMaterials.filter { item in
            (language == "all" || item.language == language)
                && (search.isEmpty
                    || (item.title + " " + item.sourceTitle + " " + item.language)
                        .localizedStandardContains(search))
        }
    }

    var body: some View {
        let recentID = library.recent?.id
        NavigationSplitView {
            List(selection: $selection) {
                if library.isLoading {
                    ProgressView("正在讀取教材…")
                } else if library.visibleMaterials.isEmpty {
                    Section {
                        ContentUnavailableView(
                            "把教材帶著走", systemImage: "books.vertical",
                            description: Text("匯入桌面端產生的教材，隨時閱讀與複習。"))
                        Button {
                            showImporter = true
                        } label: {
                            Label("匯入教材", systemImage: "square.and.arrow.down")
                        }
                        .accessibilityIdentifier("import-material")
                        Button("試讀範例教材") { Task { await library.importSample() } }
                            .accessibilityIdentifier("import-sample")
                            .disabled(library.isImporting)
                    }
                } else {
                    Section("所有教材") {
                        ForEach(filtered) { item in
                            VStack(alignment: .leading) {
                                if isSelecting {
                                    MultiSelectionRow(id: item.id, selectedIDs: $selectedIDs) {
                                        MaterialRow(
                                            item: item,
                                            progress: library.snapshot.positions[item.id],
                                            isRecent: item.id == recentID)
                                    }
                                } else {
                                    NavigationLink(value: item.id) {
                                        MaterialRow(
                                            item: item,
                                            progress: library.snapshot.positions[item.id],
                                            isRecent: item.id == recentID)
                                    }
                                    .tint(.clear)
                                }
                            }
                            .listRowBackground(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(
                                        (isSelecting
                                            ? selectedIDs.contains(item.id) : selection == item.id)
                                            ? palette.accentSurface : palette.sidebar
                                    )
                                    .overlay {
                                        LibraryRowFocusBackground(
                                            color: UIColor(palette.accentSurface)
                                        )
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                        .allowsHitTesting(false)
                                        .accessibilityHidden(true)
                                    }
                                    .padding(.horizontal, 8)
                            )
                            .swipeActions {
                                if !isSelecting {
                                    Button("移除", role: .destructive) {
                                        pendingRemovalIDs = Set([item.id])
                                    }
                                    .tint(.red)
                                    .disabled(library.isRemoving || cloud.batch.isRunning)
                                    .accessibilityIdentifier("remove-material")
                                }
                            }
                        }
                    }
                    if filtered.isEmpty { ContentUnavailableView.search(text: search) }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if isSelecting { selectionActions }
            }
            .disabled(library.isRemoving)
            .scrollContentBackground(.hidden)
            .background {
                palette.sidebar.ignoresSafeArea(.keyboard, edges: .bottom)
            }
            .navigationTitle("教材庫")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "搜尋教材與來源")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(isSelecting ? "取消選取" : "選取") {
                        isSelecting.toggle()
                        selectedIDs.removeAll()
                    }
                    .disabled(
                        library.visibleMaterials.isEmpty || library.isRemoving
                            || library.isImporting || cloud.batch.isRunning
                    )
                    .accessibilityIdentifier("library-selection-mode")
                }
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("語言", selection: $language) {
                            Text("全部語言").tag("all")
                            ForEach(
                                Array(Set(library.visibleMaterials.map(\.language))).sorted(),
                                id: \.self
                            ) { Text(languageLabel($0)).tag($0) }
                        }
                    } label: {
                        Label("篩選語言", systemImage: "line.3.horizontal.decrease")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    if library.isImporting {
                        ProgressView().accessibilityLabel("正在匯入")
                    } else {
                        Button {
                            showImporter = true
                        } label: {
                            Label("匯入教材", systemImage: "plus")
                        }
                        .disabled(isSelecting || library.isRemoving)
                        .accessibilityIdentifier("toolbar-import")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showCloud = true
                    } label: {
                        Label("Google Drive", systemImage: "icloud.and.arrow.down")
                    }
                    .disabled(isSelecting || library.isRemoving)
                    .accessibilityIdentifier("open-drive")
                }
            }
            .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 420)
        } detail: {
            NavigationStack {
                if let selection,
                    let summary = library.visibleMaterials.first(where: { $0.id == selection })
                {
                    MaterialScreen(storageID: selection, library: library, speech: speech)
                        .id(selection + ":" + summary.revision)
                } else {
                    ContentUnavailableView(
                        "選擇一份教材", systemImage: "book", description: Text("選取教材後，原文與解析會顯示在這裡。"))
                }
            }
        }
        .sheet(isPresented: $showCloud) {
            CloudLibraryView(cloud: cloud, library: library, speech: speech)
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [
                .json, .plainText, UTType(filenameExtension: "md") ?? .plainText,
            ], allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls): Task { await library.importFiles(urls) }
            case .failure(let error):
                if (error as NSError).code != NSUserCancelledError { library.show(error) }
            }
        }
        .confirmationDialog(
            "移除 \(pendingRemovalIDs?.count ?? 0) 份本機教材？",
            isPresented: Binding(
                get: { pendingRemovalIDs != nil },
                set: { if !$0 { pendingRemovalIDs = nil } }), titleVisibility: .visible
        ) {
            Button("取消", role: .cancel) {}
            if let ids = pendingRemovalIDs {
                Button("移除教材與本機複習紀錄", role: .destructive) {
                    Task {
                        if await library.remove(ids) {
                            if let current = selection, ids.contains(current) { selection = nil }
                            selectedIDs.removeAll()
                            isSelecting = false
                        }
                    }
                    pendingRemovalIDs = nil
                }
            }
        } message: {
            Text("只移除 App 內的副本與相關本機紀錄，不會更動原始檔案或 Google Drive。")
        }
        .onChange(of: Set(filtered.map(\.id))) { _, ids in selectedIDs.formIntersection(ids) }
        .onChange(of: cloud.account?.id) { _, _ in
            selectedIDs.removeAll()
            isSelecting = false
            pendingRemovalIDs = nil
        }
    }

    private var selectionActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            SelectionSummary(selectedIDs: $selectedIDs, visibleIDs: Set(filtered.map(\.id)))
            Button(role: .destructive) {
                pendingRemovalIDs = selectedIDs
            } label: {
                Label("移除所選（\(selectedIDs.count)）", systemImage: "trash")
            }
            .buttonStyle(.bordered)
            .tint(.red)
            .disabled(selectedIDs.isEmpty || library.isRemoving || cloud.batch.isRunning)
            .accessibilityIdentifier("library-remove-selected")
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }
}

// SwiftUI's focusEffectDisabled does not reach the containing native List cell.
// Replace only that cell's halo; keep native focus, activation and selection intact.
private struct LibraryRowFocusBackground: UIViewRepresentable {
    let color: UIColor

    func makeUIView(context: Context) -> IndicatorView { IndicatorView() }

    func updateUIView(_ view: IndicatorView, context: Context) {
        view.focusColor = color
        view.refresh()
    }

    static func dismantleUIView(_ view: IndicatorView, coordinator: ()) {
        view.detach()
    }

    final class IndicatorView: UIView {
        var focusColor: UIColor = .tintColor
        private weak var cell: UICollectionViewCell?
        private var originalEffect: UIFocusEffect?

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            isAccessibilityElement = false
            NotificationCenter.default.addObserver(
                self, selector: #selector(focusDidChange),
                name: UIFocusSystem.didUpdateNotification, object: nil)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        deinit { NotificationCenter.default.removeObserver(self) }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil { detach() } else { refresh() }
        }

        @objc private func focusDidChange() { refresh() }

        func refresh() {
            var ancestor = superview
            while let node = ancestor, !(node is UICollectionViewCell) {
                ancestor = node.superview
            }
            let current = ancestor as? UICollectionViewCell
            if cell !== current {
                detach()
                cell = current
                originalEffect = current?.focusEffect
            }
            cell?.focusEffect = nil
            backgroundColor = cell?.isFocused == true ? focusColor : .clear
        }

        func detach() {
            if let cell, cell.focusEffect == nil { cell.focusEffect = originalEffect }
            cell = nil
            originalEffect = nil
            backgroundColor = .clear
        }
    }
}

struct MaterialRow: View {
    let item: MaterialSummary
    let progress: StudyPosition?
    var isRecent = false
    @Environment(\.appPalette) private var palette

    private var progressLabel: String {
        guard let progress else { return "尚未開始" }
        guard !item.sceneIDs.isEmpty else { return "已閱讀" }
        return "已看過 \(progress.visitedSceneIDs.count)／\(item.sceneIDs.count) 個場景"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.title).font(.headline).lineLimit(3).foregroundStyle(palette.primaryText)
            if item.kind != .markdown {
                VideoSourceLabel(platform: item.sourcePlatform)
            }
            HStack {
                Text(languageLabel(item.language))
                Text(item.kindLabel)
                Spacer()
                Image(systemName: "checkmark.circle.fill").accessibilityLabel("可離線閱讀")
            }.font(.caption).foregroundStyle(palette.secondaryText)
            HStack {
                Text(progressLabel)
                Spacer(minLength: 6)
                Text("上次閱讀")
                    .foregroundStyle(palette.accent)
                    .opacity(isRecent ? 1 : 0)
                    .accessibilityHidden(!isRecent)
            }
            .font(.caption)
            .foregroundStyle(palette.secondaryText)
            .lineLimit(1)
        }.padding(.vertical, 5)
    }
}

struct VideoSourceLabel: View {
    let platform: String?

    var body: some View {
        let source = VideoSourcePlatform.resolve(platform: platform)
        Label(source?.title ?? "來源未提供", systemImage: "play.rectangle")
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.quaternary, in: Capsule())
            .accessibilityLabel("影片來源：" + (source?.title ?? "未提供"))
    }
}

func languageLabel(_ id: String) -> String {
    switch id {
    case "en": "英文"
    case "ja": "日文"
    case "zh-CN", "zh-TW", "zh": "中文"
    case "ko": "韓文"
    case "es": "西班牙文"
    case "fr": "法文"
    case "de": "德文"
    case "unspecified": "未指定語言"
    default: id
    }
}

struct MultiSelectionRow<Content: View>: View {
    let id: String
    @Binding var selectedIDs: Set<String>
    @ViewBuilder let content: Content

    var body: some View {
        let selected = selectedIDs.contains(id)
        Button {
            if selected { selectedIDs.remove(id) } else { selectedIDs.insert(id) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? Color.accentColor : .secondary)
                    .frame(minWidth: 32, minHeight: 44)
                    .accessibilityHidden(true)
                content.frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(selected ? "已選取" : "未選取")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("select-item-" + id)
    }
}

struct SelectionSummary: View {
    @Binding var selectedIDs: Set<String>
    let visibleIDs: Set<String>

    var body: some View {
        let allSelected = !visibleIDs.isEmpty && visibleIDs.isSubset(of: selectedIDs)
        HStack {
            Text("已選取 \(selectedIDs.count) 項").font(.subheadline.weight(.medium))
                .accessibilityIdentifier("selection-count")
            Spacer()
            Button(allSelected ? "取消全選" : "全選") {
                if allSelected {
                    selectedIDs.subtract(visibleIDs)
                } else {
                    selectedIDs.formUnion(visibleIDs)
                }
            }
            .buttonStyle(.borderless)
            .disabled(visibleIDs.isEmpty)
            .accessibilityIdentifier("selection-toggle-all")
        }
    }
}
