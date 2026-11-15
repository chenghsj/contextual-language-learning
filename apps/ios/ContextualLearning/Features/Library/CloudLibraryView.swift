import SwiftUI
import UIKit

struct CloudLibraryView: View {
    let cloud: CloudLibraryModel
    let library: LibraryModel
    let speech: SpeechService
    @Environment(\.dismiss) private var dismiss
    @State private var section = CloudDownloadCategory.materials
    @State private var isSelecting = false
    @State private var selectedIDs = Set<String>()
    @State private var pendingRemovalIDs: Set<String>?

    private var visibleIDs: Set<String> {
        guard let inventory = cloud.inventory else { return [] }
        return section == .materials
            ? Set(inventory.materials.map { "material:" + $0.id })
            : Set(inventory.favorites.map { "favorite:" + $0.key })
    }

    var body: some View {
        NavigationStack {
            List {
                Section { GoogleConnectionView(cloud: cloud, library: library) }
                if let inventory = cloud.inventory {
                    Section {
                        Picker("內容", selection: $section) {
                            Text("教材").tag(CloudDownloadCategory.materials)
                            Text("雲端收藏").tag(CloudDownloadCategory.favorites)
                        }.pickerStyle(.segmented)
                        if let date = inventory.updatedAt {
                            Text("上次更新 \(date.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if cloud.batch.progress != nil {
                        Section { CloudBatchDownloadControls(cloud: cloud, category: section) }
                    }
                    if section == .materials {
                        Section("Drive 教材") {
                            ForEach(inventory.materials) { item in materialRow(item) }
                            if inventory.materials.isEmpty {
                                Text("尚未找到教材。請先在桌面端備份到同一個 Google 帳號。")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Section("已同步的收藏") {
                            ForEach(inventory.favorites) { favorite in favoriteRow(favorite) }
                            if inventory.favorites.isEmpty {
                                Text("尚未找到已同步的收藏。").foregroundStyle(.secondary)
                            }
                        }
                        Text("這裡讀取桌面端已同步的收藏。手機的本機複習清單會分開保存。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else if cloud.authorization.account != nil {
                    Section {
                        if cloud.isRefreshing {
                            ProgressView("正在讀取教材清單…")
                        } else {
                            Button("讀取 Drive 教材") { cloud.refresh() }
                        }
                    }
                }
                Section {
                    Text("點選「選取」可勾選多個項目，下載或移除已下載的本機副本。Drive 原件會保留。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if isSelecting { selectionActions }
            }
            .navigationTitle("Google Drive")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("完成") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(isSelecting ? "取消選取" : "選取") {
                        isSelecting.toggle()
                        selectedIDs.removeAll()
                    }
                    .disabled(
                        visibleIDs.isEmpty || cloud.batch.isRunning || cloud.isDisconnecting
                            || cloud.isRefreshing || !cloud.downloads.isEmpty || library.isRemoving
                    )
                    .accessibilityIdentifier("drive-selection-mode")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if cloud.isRefreshing {
                        ProgressView()
                    } else {
                        Button {
                            cloud.refresh()
                        } label: {
                            Label("重新整理", systemImage: "arrow.clockwise")
                        }
                        .disabled(
                            cloud.authorization.account == nil || cloud.isDisconnecting
                                || cloud.batch.isRunning || isSelecting || library.isRemoving)
                    }
                }
            }
            .navigationDestination(for: String.self) {
                MaterialScreen(storageID: $0, library: library, speech: speech)
            }
            .confirmationDialog(
                "移除 \(pendingRemovalIDs?.count ?? 0) 份本機副本？",
                isPresented: Binding(
                    get: { pendingRemovalIDs != nil },
                    set: { if !$0 { pendingRemovalIDs = nil } }), titleVisibility: .visible
            ) {
                Button("取消", role: .cancel) {}
                if let ids = pendingRemovalIDs {
                    Button("移除所選副本與本機複習紀錄", role: .destructive) {
                        Task {
                            if await library.remove(ids) {
                                selectedIDs.removeAll()
                                isSelecting = false
                            }
                        }
                        pendingRemovalIDs = nil
                    }
                }
            } message: {
                Text("只移除 App 內的下載副本與相關本機紀錄，Google Drive 原件會保留。")
            }
            .onChange(of: section) { _, _ in selectedIDs.removeAll() }
            .onChange(of: visibleIDs) { _, ids in selectedIDs.formIntersection(ids) }
            .onChange(of: cloud.account?.id) { _, _ in
                selectedIDs.removeAll()
                isSelecting = false
                pendingRemovalIDs = nil
            }
            .task { await cloud.activateAccount() }
        }
    }

    private var selectionActions: some View {
        let downloads = cloud.selectedDownloads(selectedIDs, in: section)
        let copies = cloud.localCopies(selectedIDs, in: section)
        return VStack(alignment: .leading, spacing: 10) {
            SelectionSummary(selectedIDs: $selectedIDs, visibleIDs: visibleIDs)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    downloadSelectionButton(count: downloads.count)
                    removeSelectionButton(ids: copies)
                }
                VStack(alignment: .leading, spacing: 10) {
                    downloadSelectionButton(count: downloads.count)
                    removeSelectionButton(ids: copies)
                }
            }
            Text("已下載項目會略過下載；只能移除已有的本機副本。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
        .disabled(library.isRemoving || cloud.isDisconnecting || cloud.batch.isRunning)
    }

    private func downloadSelectionButton(count: Int) -> some View {
        Button {
            if cloud.downloadSelected(selectedIDs, in: section) {
                selectedIDs.removeAll()
                isSelecting = false
            }
        } label: {
            Label("下載所選（\(count)）", systemImage: "arrow.down.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(count == 0 || cloud.authorization.account == nil || !cloud.downloads.isEmpty)
        .accessibilityIdentifier("drive-download-selected")
    }

    private func removeSelectionButton(ids: Set<String>) -> some View {
        Button(role: .destructive) {
            pendingRemovalIDs = ids
        } label: {
            Label("移除本機副本（\(ids.count)）", systemImage: "trash")
        }
        .buttonStyle(.bordered)
        .tint(.red)
        .disabled(ids.isEmpty || !cloud.downloads.isEmpty)
        .accessibilityIdentifier("drive-remove-selected")
    }

    private func materialInfo(_ item: DriveLibraryItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(item.title).font(.headline)
            Text(languageLabel(item.language)).font(.caption).foregroundStyle(.secondary)
            VideoSourceLabel(
                platform: item.sourcePlatform ?? cloud.downloaded(item)?.sourcePlatform)
            if item.conflict {
                Text("發現重複備份，請先在桌面端確認。").font(.caption).foregroundStyle(.orange)
            }
            if isSelecting, cloud.downloaded(item) != nil {
                Label("已下載", systemImage: "checkmark.circle").font(.caption).foregroundStyle(
                    .secondary)
            }
        }
    }

    private func materialRow(_ item: DriveLibraryItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if isSelecting {
                MultiSelectionRow(id: "material:" + item.id, selectedIDs: $selectedIDs) {
                    materialInfo(item)
                }
                .disabled(library.isRemoving)
            } else {
                materialInfo(item)
                CloudDownloadRowActions(
                    savedID: cloud.downloaded(item)?.id, title: "教材",
                    isDownloading: cloud.downloads.contains("material:" + item.id),
                    canDownload: !item.conflict && cloud.authorization.account != nil
                        && !cloud.isDisconnecting && !cloud.batch.isRunning && !library.isRemoving,
                    feedback: cloud.downloadFeedback["material:" + item.id]
                ) { cloud.download(item) }
            }
        }
        .padding(.vertical, 5)
        .task(id: cloud.isRefreshing) {
            if !cloud.isRefreshing { cloud.requestSource(.material(item)) }
        }
    }

    private func favoriteInfo(_ favorite: CloudFavorite) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(favorite.title).font(.headline)
            Text(favorite.sourceTitle).font(.caption).foregroundStyle(.secondary)
            VideoSourceLabel(
                platform: favorite.sourcePlatform ?? cloud.downloaded(favorite)?.sourcePlatform)
            if !favorite.excerpt.isEmpty { Text(favorite.excerpt).lineLimit(3).font(.subheadline) }
            if isSelecting, cloud.downloaded(favorite) != nil {
                Label("已下載", systemImage: "checkmark.circle").font(.caption).foregroundStyle(
                    .secondary)
            }
        }
    }

    private func favoriteRow(_ favorite: CloudFavorite) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if isSelecting {
                MultiSelectionRow(id: "favorite:" + favorite.key, selectedIDs: $selectedIDs) {
                    favoriteInfo(favorite)
                }
                .disabled(library.isRemoving)
            } else {
                favoriteInfo(favorite)
                CloudDownloadRowActions(
                    savedID: cloud.downloaded(favorite)?.id, title: "收藏",
                    isDownloading: cloud.downloads.contains("favorite:" + favorite.key),
                    canDownload: cloud.authorization.account != nil
                        && !cloud.isDisconnecting && !cloud.batch.isRunning && !library.isRemoving,
                    feedback: cloud.downloadFeedback["favorite:" + favorite.key]
                ) { cloud.download(favorite) }
            }
        }
        .padding(.vertical, 5)
        .task(id: cloud.isRefreshing) {
            if !cloud.isRefreshing { cloud.requestSource(.favorite(favorite)) }
        }
    }
}

private struct CloudBatchDownloadControls: View {
    let cloud: CloudLibraryModel
    let category: CloudDownloadCategory

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let progress = cloud.batch.progress {
                if cloud.batch.isRunning {
                    ProgressView(value: Double(progress.completed), total: Double(progress.total)) {
                        Text(
                            "正在下載\(progress.category.title) \(progress.completed) / \(progress.total)"
                        )
                    }
                    .accessibilityIdentifier("drive-batch-progress")
                    if let title = progress.currentTitle {
                        Text(title).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Button(cloud.batch.isCancelling ? "正在取消…" : "取消下載") {
                        cloud.batch.cancel()
                    }
                    .buttonStyle(.bordered)
                    .disabled(cloud.batch.isCancelling)
                    .accessibilityIdentifier("drive-batch-cancel")
                } else {
                    Label(
                        resultTitle(progress),
                        systemImage: progress.failures.isEmpty && !progress.wasCancelled
                            ? "checkmark.circle" : "info.circle"
                    )
                    .font(.subheadline)
                    .accessibilityIdentifier("drive-batch-result")
                }
                if let reason = progress.stopReason {
                    Text(reason).font(.caption).foregroundStyle(.secondary)
                }
                if progress.skipped > 0 {
                    Text("已略過 \(progress.skipped) 項已下載內容")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if !progress.failures.isEmpty {
                    DisclosureGroup("\(progress.failures.count) 項下載失敗") {
                        ForEach(progress.failures) { failure in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(failure.title).font(.subheadline)
                                Text(failure.message).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                    }
                    .font(.subheadline)
                }
            }
            if category == .materials,
                let conflicts = cloud.inventory?.materials.filter(\.conflict).count, conflicts > 0
            {
                Text("\(conflicts) 份教材有重複備份，批量下載時會略過。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("已下載項目會自動略過；取消時會保留已完成的下載。")
                .font(.caption).foregroundStyle(.secondary)
            if cloud.batch.isRunning {
                Text("下載期間請保持 App 在前景。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func resultTitle(_ progress: CloudDownloadBatch.Progress) -> String {
        let state =
            progress.wasCancelled ? "下載已取消" : progress.stopReason != nil ? "下載已停止" : "下載完成"
        return "\(progress.category.title)\(state)：\(progress.downloaded) / \(progress.total) 項成功"
    }
}

struct GoogleConnectionView: View {
    let cloud: CloudLibraryModel
    let library: LibraryModel
    @State private var presenter: UIViewController?
    @State private var confirmSignOut = false
    @Environment(\.appPalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Label("雲端教材", systemImage: "icloud")
                    .font(.headline)
                    .foregroundStyle(palette.primaryText)
                Text("讀取已備份的教材與收藏，下載後可離線閱讀。")
                    .font(.subheadline)
                    .foregroundStyle(palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let account = cloud.account {
                Text(account.email)
                    .font(.subheadline)
                    .textSelection(.enabled)
                    .foregroundStyle(palette.primaryText)
                if cloud.authorization.account == nil {
                    Text("已下載的教材仍可離線閱讀。重新連結後才能更新 Drive 內容。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            switch cloud.authorization.state {
            case .unconfigured:
                Text("此版本尚未啟用 Google Drive 登入，仍可匯入教材使用。")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("drive-unconfigured")
            case .connecting:
                ProgressView("正在連結 Google…")
            case .disconnected:
                GoogleAccountSignInButton(action: signIn)
                    .disabled(presenter == nil || cloud.isDisconnecting)
                    .accessibilityHint("連結 Google Drive 以讀取已備份的教材與收藏。")
                    .accessibilityIdentifier("google-sign-in")
            case .connected:
                Label("已連結 Google Drive", systemImage: "checkmark.circle")
                    .font(.subheadline).foregroundStyle(palette.success)
            }
            if cloud.account != nil {
                Button("登出並清除此帳號的離線內容", role: .destructive) { confirmSignOut = true }
                    .disabled(cloud.isDisconnecting)
                if cloud.isDisconnecting { ProgressView("正在清除帳號資料…") }
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GooglePresentationAnchor(controller: $presenter).frame(width: 0, height: 0))
        .confirmationDialog(
            "登出 Google Drive？", isPresented: $confirmSignOut, titleVisibility: .visible
        ) {
            Button("登出並清除帳號內容", role: .destructive) { Task { await cloud.disconnect() } }
        } message: {
            Text("這會移除此帳號的離線教材與相關本機複習紀錄。自行匯入的教材及 Drive 原件都會保留。")
        }
    }

    private func signIn() {
        guard let presenter else { return }
        Task {
            do {
                try await cloud.authorization.signIn(presenting: presenter)
                await cloud.activateAccount()
                cloud.refresh()
            } catch {
                let failure = error as NSError
                if !(failure.domain == "com.google.GIDSignIn" && failure.code == -5) {
                    library.show(error)
                }
            }
        }
    }
}

private struct GoogleAccountSignInButton: View {
    let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .subheadline) private var fontSize = 14.0

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image("GoogleSignInLogo")
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
                    .accessibilityHidden(true)
                Text("使用 Google 帳號登入")
                    .font(.system(size: fontSize, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .foregroundStyle(isDark ? Color(white: 0.89) : Color(white: 0.12))
            .background(isDark ? Color(white: 0.075) : .white, in: Capsule())
            .overlay {
                Capsule().strokeBorder(
                    isDark ? Color(white: 0.56) : Color(white: 0.46), lineWidth: 1)
            }
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
    }
}

private struct GooglePresentationAnchor: UIViewControllerRepresentable {
    @Binding var controller: UIViewController?

    func makeUIViewController(context: Context) -> UIViewController {
        let value = UIViewController()
        DispatchQueue.main.async { controller = value }
        return value
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct CloudDownloadRowActions: View {
    let savedID: String?
    let title: String
    let isDownloading: Bool
    let canDownload: Bool
    let feedback: CloudDownloadFeedback?
    let download: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let savedID {
                NavigationLink(value: savedID) {
                    Label("閱讀已下載的" + title, systemImage: "book")
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("drive-read-copy")
            }
            if isDownloading {
                ProgressView("正在下載…")
            } else {
                Button(savedID == nil ? "下載以離線閱讀" : "重新下載", action: download)
                    .buttonStyle(.borderless)
                    .disabled(!canDownload)
                    .accessibilityIdentifier("drive-download-copy")
            }
            if let feedback, feedback.isError || savedID != nil {
                Label(
                    feedback.message,
                    systemImage: feedback.isError ? "exclamationmark.circle" : "checkmark.circle"
                )
                .font(.caption)
                .foregroundStyle(feedback.isError ? Color.red : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("drive-download-feedback")
            }
        }
    }
}

#if DEBUG
    struct DriveDownloadInteractionFixture: View {
        @State private var feedback: CloudDownloadFeedback?
        @State private var count = 0
        var body: some View {
            NavigationStack {
                List {
                    Text("下載次數：\(count)").accessibilityIdentifier("fixture-download-count")
                    CloudDownloadRowActions(
                        savedID: "copy", title: "教材", isDownloading: false,
                        canDownload: true, feedback: feedback
                    ) {
                        count += 1
                        feedback = CloudDownloadFeedback(message: "已是最新版本", isError: false)
                    }
                }
                .navigationDestination(for: String.self) { _ in
                    Text("已開啟閱讀器").accessibilityIdentifier("fixture-reader")
                }
            }
        }
    }
#endif
