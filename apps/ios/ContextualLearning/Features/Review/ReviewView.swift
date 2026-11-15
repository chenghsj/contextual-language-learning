import SwiftUI

struct ReviewView: View {
    @Environment(\.appPalette) private var palette
    private struct Session: Identifiable {
        let id = UUID()
        let entries: [ReviewEntry]
    }

    let library: LibraryModel
    let speech: SpeechService
    @State private var session: Session?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("先回想句意，再揭示翻譯與解析。複習清單只保存在這台裝置。")
                        .font(.subheadline).foregroundStyle(palette.secondaryText)
                }
                if library.reviewEntries.isEmpty {
                    ContentUnavailableView(
                        "還沒有複習內容", systemImage: "bookmark", description: Text("閱讀時將想再練習的句子加入本機複習。"))
                } else {
                    Section {
                        Button {
                            session = Session(entries: library.reviewEntries)
                        } label: {
                            Label("開始複習", systemImage: "play.fill")
                        }
                        .accessibilityIdentifier("start-review")
                    }
                    Section("本機複習清單") {
                        ForEach(library.reviewEntries) { entry in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(entry.group.rows.map(\.text).joined(separator: " ")).font(
                                    .headline
                                ).lineLimit(3)
                                Text(entry.title).font(.caption).foregroundStyle(
                                    palette.secondaryText)
                            }
                            .swipeActions {
                                Button("移除", role: .destructive) {
                                    Task { await library.removeReview(entry) }
                                }
                                .tint(.red)
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(palette.canvas)
            .navigationTitle("複習")
            .sheet(item: $session) { ReviewSessionView(entries: $0.entries, speech: speech) }
        }
    }
}

struct ReviewSessionView: View {
    @Environment(\.appPalette) private var palette
    let entries: [ReviewEntry]
    let speech: SpeechService
    @Environment(\.dismiss) private var dismiss
    @State private var position = 0
    @State private var revealed = false
    @State private var playback = YouTubePlaybackModel()

    private var current: ReviewEntry? {
        entries.indices.contains(position) ? entries[position] : nil
    }

    var body: some View {
        NavigationStack {
            YouTubePlaybackLayout(playback: playback) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        if let entry = current {
                            Text("\(position + 1)／\(entries.count)").font(.subheadline)
                                .foregroundStyle(
                                    palette.secondaryText)
                            Text(entry.sceneTitle).font(.headline)
                            if let link = entry.group.netflixPlaybackLink {
                                NetflixPlaybackNotice(
                                    link: link, identifier: "open-netflix-source",
                                    prepare: { speech.stop() })
                            }
                            if revealed {
                                ReaderGroupView(
                                    group: entry.group, language: entry.language,
                                    showTranslation: true,
                                    showPronunciation: true, textScale: 1, speech: speech,
                                    onPlay: playback.play
                                )
                            } else {
                                VStack(alignment: .leading, spacing: 18) {
                                    ForEach(entry.group.rows) { row in
                                        Text(row.text).font(.title3).textSelection(.enabled)
                                        SentenceSpeechButton(
                                            row: row, groupID: entry.group.id,
                                            language: entry.language, speech: speech)
                                        if let link = row.playbackLink {
                                            ExternalPlaybackButton(
                                                link: link, identifier: "play-row-" + row.id,
                                                prepare: {
                                                    speech.stop()
                                                }, onPlay: playback.play)
                                        }
                                    }
                                }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(
                                        palette.surface,
                                        in: RoundedRectangle(cornerRadius: 16)
                                    )
                                Button("顯示翻譯與解析") { revealed = true }.buttonStyle(
                                    .borderedProminent
                                )
                                .accessibilityIdentifier("reveal-answer")
                                .foregroundStyle(palette.onAccent)
                            }
                            if revealed {
                                Button(position + 1 == entries.count ? "完成這次複習" : "下一句") {
                                    speech.stop()
                                    playback.close()
                                    if position + 1 < entries.count {
                                        position += 1
                                        revealed = false
                                    } else {
                                        dismiss()
                                    }
                                }.buttonStyle(.borderedProminent).accessibilityIdentifier(
                                    "next-review"
                                )
                                .foregroundStyle(palette.onAccent)
                            }
                        }
                    }.frame(maxWidth: 720, alignment: .leading).padding().frame(maxWidth: .infinity)
                }
                .accessibilityIdentifier("review-content-scroll")
            }
            .navigationTitle("本機複習")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("結束") {
                        speech.stop()
                        dismiss()
                    }
                }
            }
            .onDisappear { speech.stop() }
        }
    }
}
