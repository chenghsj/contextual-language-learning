import Observation
import SwiftUI
import WebKit

struct YouTubePlaybackRequest: Identifiable {
    let id = UUID()
    let link: ExternalPlaybackLink

    var json: String? {
        guard link.platform == .youtube, let url = link.validatedURL,
            let videoID = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "v" })?.value,
            let data = try? JSONSerialization.data(withJSONObject: [
                "id": id.uuidString, "videoID": videoID,
                "startSeconds": link.startMs / 1000,
                "endSeconds": link.segmentEndMs.map { $0 / 1000 } as Any? ?? NSNull(),
            ]), let value = String(data: data, encoding: .utf8)
        else { return nil }
        return value
    }
}

@MainActor @Observable
final class YouTubePlaybackModel {
    enum Mode: String, CaseIterable, Identifiable {
        case once, loop, continuous
        var id: String { rawValue }
        var title: String {
            switch self {
            case .once: "播放一次"
            case .loop: "重複此片段"
            case .continuous: "繼續播放影片"
            }
        }

    }

    enum Status: Equatable {
        case loading, playing, paused, completed, loopWaiting, tapToPlay
        case failed(Int)
    }
    struct Command {
        let id = UUID()
        let action: String
    }
    private(set) var request: YouTubePlaybackRequest?
    private(set) var command: Command?
    var mode = Mode.once
    var status = Status.loading
    private(set) var sessionID = UUID()

    var hasSegmentEnd: Bool { request?.link.segmentEndMs != nil }
    var effectiveMode: Mode { hasSegmentEnd ? mode : .continuous }
    var isPlaying: Bool { status == .playing || status == .loopWaiting }
    var canControl: Bool {
        switch status {
        case .loading, .failed: false
        default: true
        }
    }
    var statusLabel: String {
        if !hasSegmentEnd { return "缺少結束時間，將繼續播放影片" }
        switch status {
        case .completed: return "片段已播完"
        case .paused: return "已暫停"
        case .loopWaiting: return "稍後重播"
        case .tapToPlay: return "點播放開始"
        case .loading: return "正在載入…"
        default:
            switch effectiveMode {
            case .once: return "播完此片段即暫停"
            case .loop: return "片段間隔 0.5 秒重播"
            case .continuous: return "繼續播放後續影片"
            }
        }
    }

    func play(_ link: ExternalPlaybackLink) {
        guard link.platform == .youtube else { return }
        status = .loading
        command = nil
        request = YouTubePlaybackRequest(link: link)
    }

    func togglePlayback() {
        guard canControl else { return }
        command = Command(action: isPlaying ? "pause" : "resume")
    }

    func replay() {
        if let link = request?.link { play(link) }
    }

    func close() {
        request = nil
        command = nil
    }

    func retry() {
        guard let link = request?.link else { return }
        sessionID = UUID()
        play(link)
    }
}

struct YouTubePlaybackLayout<Content: View>: View {
    let playback: YouTubePlaybackModel
    @ViewBuilder let content: Content
    @AppStorage("readerVideoFraction") private var videoFraction = 0.0
    @GestureState private var splitDrag: SplitDrag?
    @Environment(\.appPalette) private var palette

    private struct SplitDrag {
        let startWidth: CGFloat
        let translation: CGFloat

        var width: CGFloat { startWidth + translation }
    }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let beside =
                size.width > size.height
                && (size.width >= 760 || (size.height < 440 && size.width >= 680))
            let minimumPanel = CGFloat(280)
            let maximumPanel = max(minimumPanel, size.width - 344)
            let proposed =
                splitDrag?.width
                ?? (videoFraction > 0 ? size.width * videoFraction : min(420, size.width * 0.42))
            let panelWidth = beside ? min(maximumPanel, max(minimumPanel, proposed)) : size.width
            let heightLimit =
                beside ? max(200, size.height - 172) : max(200, min(300, size.height * 0.30))
            let videoWidth = min(max(200, panelWidth - 32), heightLimit * 16 / 9)
            let videoSize = CGSize(width: videoWidth, height: max(200, videoWidth * 9 / 16))
            let layout =
                beside
                ? AnyLayout(HStackLayout(alignment: .top, spacing: 0))
                : AnyLayout(VStackLayout(spacing: 0))
            layout {
                if playback.request != nil {
                    YouTubePlaybackPanel(playback: playback, videoSize: videoSize)
                        .frame(width: panelWidth, height: min(size.height, videoSize.height + 120))
                        .clipped()
                    if beside {
                        ZStack {
                            Rectangle().fill(palette.divider).frame(width: 1)
                            Capsule().fill(palette.secondaryText).frame(width: 4, height: 36)
                        }
                        .frame(width: 24).frame(maxHeight: .infinity)
                        .background(palette.surface)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(
                                minimumDistance: 1, coordinateSpace: .named("playback-split")
                            )
                            .updating($splitDrag) { value, state, transaction in
                                transaction.animation = nil
                                state = SplitDrag(
                                    startWidth: state?.startWidth ?? panelWidth,
                                    translation: value.translation.width)
                            }.onEnded { value in
                                let width =
                                    (splitDrag?.startWidth ?? panelWidth) + value.translation.width
                                videoFraction =
                                    min(maximumPanel, max(minimumPanel, width)) / size.width
                            }
                        )
                        .onTapGesture(count: 2) { videoFraction = 0 }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("影片與原文分隔線")
                        .accessibilityValue("影片寬度 \(Int(panelWidth / size.width * 100))%")
                        .accessibilityHint("左右拖曳調整寬度，點兩下恢復預設。")
                        .accessibilityAdjustableAction { direction in
                            let change: CGFloat = direction == .increment ? 40 : -40
                            videoFraction =
                                min(maximumPanel, max(minimumPanel, panelWidth + change))
                                / size.width
                        }
                        .accessibilityAction(named: "恢復預設寬度") { videoFraction = 0 }
                        .accessibilityIdentifier("player-reader-divider")
                    } else {
                        Divider().accessibilityHidden(true)
                    }
                }
                content.frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
            }
            .frame(width: size.width, height: size.height, alignment: .top)
            .coordinateSpace(name: "playback-split")
            .background(palette.canvas)
            .clipped()
        }
    }
}

private struct PlaybackModeButtonStyle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glass)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}

struct YouTubePlaybackPanel: View {
    let playback: YouTubePlaybackModel
    let videoSize: CGSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var isVisible = true
    @Environment(\.appPalette) private var palette

    private var isLoading: Bool {
        if case .loading = playback.status { return true }
        return false
    }

    var body: some View {
        if let request = playback.request {
            ScrollView {
                VStack(spacing: 8) {
                    HStack {
                        Text("YouTube · \(request.link.timeRange)").font(.subheadline)
                            .monospacedDigit().fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("video-playback-time")
                        ProgressView().controlSize(.small)
                            .opacity(isLoading ? 1 : 0)
                            .accessibilityHidden(!isLoading)
                        Spacer()
                        ExternalPlaybackButton(
                            link: request.link, identifier: "video-open-external",
                            title: "在 YouTube 開啟"
                        )
                        .labelStyle(.iconOnly)
                        .tint(palette.secondaryText)
                        .frame(minWidth: 44, minHeight: 44)
                        .help("在 YouTube 開啟")
                        Button("關閉影片", systemImage: "xmark") { playback.close() }
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                            .tint(palette.secondaryText)
                            .accessibilityIdentifier("close-video-player")
                    }
                    YouTubeWebPlayer(
                        playback: playback, isActive: isVisible && scenePhase == .active
                    )
                    .id(playback.sessionID)
                    .frame(width: videoSize.width, height: videoSize.height)
                    .background(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityIdentifier("youtube-embedded-player")
                    HStack(alignment: .top, spacing: 8) {
                        Menu {
                            Picker(
                                "播放模式",
                                selection: Binding(
                                    get: { playback.effectiveMode }, set: { playback.mode = $0 })
                            ) {
                                ForEach(YouTubePlaybackModel.Mode.allCases) { mode in
                                    Text(mode.title).tag(mode)
                                        .disabled(!playback.hasSegmentEnd && mode != .continuous)
                                }
                            }
                            if !playback.hasSegmentEnd {
                                Text("這個片段沒有結束時間，將繼續播放影片。")
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(playback.effectiveMode.title)
                                Image(systemName: "chevron.down").font(.caption2)
                            }
                            .font(.subheadline).lineLimit(1)
                            .frame(minHeight: 30, alignment: .leading)
                        }
                        .modifier(PlaybackModeButtonStyle())
                        .accessibilityLabel("播放模式")
                        .accessibilityValue(
                            playback.effectiveMode.title + "，" + playback.statusLabel
                        )
                        .accessibilityIdentifier("video-playback-mode")
                        Spacer(minLength: 0)
                        Button("重播片段", systemImage: "backward.end") { playback.replay() }
                            .labelStyle(.iconOnly).frame(minWidth: 44, minHeight: 44)
                            .tint(palette.secondaryText)
                            .disabled(!playback.canControl)
                            .accessibilityIdentifier("video-replay-segment")
                        Button {
                            playback.togglePlayback()
                        } label: {
                            Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                                .frame(width: 44, height: 44)
                                .foregroundStyle(
                                    playback.canControl ? palette.onAccent : palette.secondaryText
                                )
                                .background(
                                    playback.canControl ? palette.accent : palette.mutedSurface,
                                    in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(playback.isPlaying ? "暫停播放" : "播放片段")
                        .disabled(!playback.canControl)
                        .accessibilityIdentifier("video-toggle-playback")
                    }
                    switch playback.status {
                    case .failed(let code):
                        HStack {
                            Text(
                                code == 101 || code == 150
                                    ? "這部影片不允許在 App 內播放，可改在 YouTube 開啟。"
                                    : "影片無法載入，請重試或在 YouTube 開啟。"
                            )
                            .font(.caption).foregroundStyle(palette.error)
                            Button("重試") { playback.retry() }
                        }.accessibilityIdentifier("video-playback-error")
                    default: EmptyView()
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 12)
            }
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityIdentifier("video-panel-scroll")
            .frame(maxWidth: .infinity).background(palette.surface)
            .onAppear { isVisible = true }
            .onDisappear { isVisible = false }
        }
    }
}

struct YouTubeWebPlayer: UIViewRepresentable {
    let playback: YouTubePlaybackModel
    let isActive: Bool

    func makeCoordinator() -> Coordinator { Coordinator(playback: playback, isActive: isActive) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(context.coordinator, name: "youtubePlayer")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        let origin =
            "https://"
            + (Bundle.main.bundleIdentifier ?? "dev.contextual.language-learning.reader")
            .lowercased()
        let script =
            Bundle.main.url(forResource: "youtube-player", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        let html = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <meta name="referrer" content="strict-origin-when-cross-origin">
            <style>html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}</style>
            </head><body><div id="player"></div><script>\(script)
            CLLYouTubePlayer.setActive(\(isActive ? "true" : "false"));
            CLLYouTubePlayer.setMode("\(playback.effectiveMode.rawValue)");
            CLLYouTubePlayer.play(\(playback.request?.json ?? "null"));</script>
            <script src="https://www.youtube.com/iframe_api" onerror="CLLYouTubeNetworkFailure()"></script>
            </body></html>
            """
        webView.loadHTMLString(html, baseURL: URL(string: origin))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.apply(isActive: isActive)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.evaluateJavaScript("window.CLLYouTubePlayer?.setActive(false)")
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: "youtubePlayer")
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let playback: YouTubePlaybackModel
        weak var webView: WKWebView?
        private var sentRequestID: UUID?
        private var sentCommandID: UUID?
        private let sessionID: UUID
        private var isActive: Bool

        init(playback: YouTubePlaybackModel, isActive: Bool) {
            self.playback = playback
            self.sessionID = playback.sessionID
            self.isActive = isActive
        }

        func apply(isActive: Bool) {
            self.isActive = isActive
            guard sessionID == playback.sessionID else { return }
            webView?.evaluateJavaScript(
                "window.CLLYouTubePlayer?.setActive(\(isActive ? "true" : "false"))")
            webView?.evaluateJavaScript(
                "window.CLLYouTubePlayer?.setMode('\(playback.effectiveMode.rawValue)')")
            if let request = playback.request, request.id != sentRequestID, let json = request.json
            {
                webView?.evaluateJavaScript("window.CLLYouTubePlayer?.play(\(json))") {
                    [weak self] _, error in
                    if error == nil { self?.sentRequestID = request.id }
                }
            }
            if let command = playback.command, command.id != sentCommandID {
                webView?.evaluateJavaScript("window.CLLYouTubePlayer?.command('\(command.action)')")
                {
                    [weak self] _, error in
                    if error == nil { self?.sentCommandID = command.id }
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            sentRequestID = nil
            apply(isActive: isActive)
        }

        func userContentController(
            _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
        ) {
            guard sessionID == playback.sessionID, message.frameInfo.isMainFrame,
                let data = message.body as? [String: Any],
                data["requestID"] as? String == playback.request?.id.uuidString,
                let state = data["state"] as? String
            else { return }
            switch state {
            case "playing": playback.status = .playing
            case "paused": playback.status = .paused
            case "completed": playback.status = .completed
            case "loop-waiting": playback.status = .loopWaiting
            case "tap-to-play": playback.status = .tapToPlay
            case "failed": playback.status = .failed(data["code"] as? Int ?? -1)
            default: break
            }
        }

        func webView(
            _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            guard sessionID == playback.sessionID else { return }
            playback.status = .failed(-1)
        }
    }
}
