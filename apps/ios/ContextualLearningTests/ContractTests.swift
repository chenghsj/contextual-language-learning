import AVFoundation
import JavaScriptCore
import UIKit
import XCTest

import struct SwiftUI.Color

@testable import ContextualLearning

final class ContractTests: XCTestCase {
    func testAppearanceDefaultsAndInvalidStoredValuesHaveSafeFallbacks() {
        for raw in ["", "unknown", "Dark"] {
            XCTAssertEqual(AppColorTheme.resolved(raw), .ocean)
            XCTAssertEqual(AppAppearance.resolved(raw), .system)
        }
        for theme in AppColorTheme.allCases {
            XCTAssertEqual(AppColorTheme.resolved(theme.rawValue), theme)
        }
        for appearance in AppAppearance.allCases {
            XCTAssertEqual(AppAppearance.resolved(appearance.rawValue), appearance)
        }
        XCTAssertNil(AppAppearance.system.colorScheme)
        XCTAssertEqual(AppAppearance.light.colorScheme, .light)
        XCTAssertEqual(AppAppearance.dark.colorScheme, .dark)
    }

    @MainActor
    func testThemeTextAndActionContrastInLightDarkAndIncreasedContrast() {
        func luminance(_ color: Color, traits: UITraitCollection) -> Double {
            var r: CGFloat = 0
            var g: CGFloat = 0
            var b: CGFloat = 0
            var a: CGFloat = 0
            UIColor(color).resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
            let linear = [r, g, b].map { value in
                let v = Double(value)
                return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
            }
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
        }
        for theme in AppColorTheme.allCases {
            let palette = AppPalette(theme: theme)
            for style in [UIUserInterfaceStyle.light, .dark] {
                for contrast in [UIAccessibilityContrast.normal, .high] {
                    let traits = UITraitCollection(traitsFrom: [
                        UITraitCollection(userInterfaceStyle: style),
                        UITraitCollection(accessibilityContrast: contrast),
                    ])
                    for (foreground, background) in [
                        (palette.accent, palette.surface), (palette.accent, palette.accentSurface),
                        (palette.onAccent, palette.accent),
                        (palette.secondaryText, palette.surface),
                        (palette.secondaryText, palette.canvas),
                        (palette.secondaryText, palette.mutedSurface),
                        (palette.primaryText, palette.accentSurface),
                        (palette.secondaryText, palette.accentSurface),
                        (palette.primaryText, palette.sidebar),
                        (palette.secondaryText, palette.sidebar),
                        (palette.accent, palette.sidebar),
                        (palette.success, palette.surface), (palette.error, palette.surface),
                    ] {
                        let values = [
                            luminance(foreground, traits: traits),
                            luminance(background, traits: traits),
                        ].sorted()
                        XCTAssertGreaterThanOrEqual(
                            (values[1] + 0.05) / (values[0] + 0.05), 4.5,
                            "\(theme) / \(style) / \(contrast)")
                    }
                }
            }
        }
    }

    func testCorpusMatchesAuthoritativeAcceptanceIncludingUnicode() async throws {
        let corpus = try corpus()
        let cases = try XCTUnwrap(corpus["cases"] as? [[String: Any]])
        let engine = ContractEngine()
        XCTAssertGreaterThan(cases.count, 40)
        for test in cases {
            let name = try XCTUnwrap(test["name"] as? String)
            let accepted = try XCTUnwrap(test["accepted"] as? Bool)
            let input = try XCTUnwrap(test["input"])
            let payload = ImportPayload(
                format: .json, original: try JSONSerialization.data(withJSONObject: input),
                pairedMarkdown: nil, suggestedName: name)
            do {
                let material = try await engine.importPayload(payload)
                XCTAssertTrue(accepted, "Unexpected acceptance: " + name)
                XCTAssertFalse(material.scenes.isEmpty, name)
            } catch { XCTAssertFalse(accepted, "Unexpected rejection: \(name): \(error)") }
        }
    }

    func testProjectionRetainsGroupsAndBothTranslationModes() async throws {
        let corpus = try corpus()
        let cases = try XCTUnwrap(corpus["cases"] as? [[String: Any]])
        let first = try XCTUnwrap(cases.first?["input"])
        let engine = ContractEngine()
        let value = try await engine.importPayload(
            ImportPayload(
                format: .json, original: try JSONSerialization.data(withJSONObject: first),
                pairedMarkdown: nil, suggestedName: "fixture"))
        let expected = try XCTUnwrap((corpus["presentation"] as? [[String: Any]])?.first)
        let expectedGroups = try XCTUnwrap(expected["groups"] as? [[String: Any]])
        XCTAssertEqual(
            value.scenes.first?.groups.map(\.id), expectedGroups.compactMap { $0["id"] as? String })
        let expectedAnalyses = expectedGroups.flatMap { ($0["analyses"] as? [[String: Any]]) ?? [] }
            .compactMap { $0["id"] as? String }
        XCTAssertEqual(value.scenes.first?.groups.flatMap(\.analyses).map(\.id), expectedAnalyses)
        XCTAssertEqual(
            value.scenes.first?.groups.flatMap(\.rows).map(\.text),
            ["Why were you still home?", "I was about to head out when you called."])
        XCTAssertEqual(
            value.scenes.first?.untranslatedGroups.map(\.id), value.scenes.first?.groups.map(\.id))
    }

    func testStrictUTF8SizeAndMissingContractFailClosed() async throws {
        let engine = ContractEngine()
        for bytes in [
            Data(), Data([0xff, 0xfe]), Data(repeating: 65, count: ContractEngine.maximumBytes + 1),
        ] {
            do {
                _ = try await engine.importPayload(
                    ImportPayload(
                        format: .json, original: bytes, pairedMarkdown: nil, suggestedName: "bad"))
                XCTFail("Invalid bytes accepted")
            } catch { XCTAssertNotNil(error.localizedDescription) }
        }
        let broken = ContractEngine(script: "var CLLContract = {};")
        do {
            _ = try await broken.importPayload(
                ImportPayload(
                    format: .json, original: Data("{}".utf8), pairedMarkdown: nil,
                    suggestedName: "bad"))
            XCTFail("Missing function accepted")
        } catch { XCTAssertNotNil(error.localizedDescription) }
    }

    func testLocalMarkdownRemainsDistinctAndDeterministic() async throws {
        let engine = ContractEngine()
        let payload = ImportPayload(
            format: .markdown, original: Data("# 測試\n\n內容".utf8), pairedMarkdown: nil,
            suggestedName: "本機筆記")
        let first = try await engine.importPayload(payload)
        let second = try await engine.importPayload(payload)
        XCTAssertEqual(first.kind, .markdown)
        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(first.markdown, "# 測試\n\n內容")
    }

    func testGeneratedCustomDocumentAndPairedBackupValidateSameContent() async throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "custom-document", withExtension: "json"))
        let data = try Data(contentsOf: url)
        var metadata = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let markdown = try XCTUnwrap(metadata.removeValue(forKey: "markdown") as? String)
        let bytes = Data(markdown.utf8)
        metadata["markdownHash"] = sha256(bytes)
        let engine = ContractEngine()
        let complete = try await engine.importPayload(
            ImportPayload(
                format: .json, original: data, pairedMarkdown: nil, suggestedName: "custom"))
        let paired = try await engine.importPayload(
            ImportPayload(
                format: .json, original: try JSONSerialization.data(withJSONObject: metadata),
                pairedMarkdown: bytes, suggestedName: "custom"))
        XCTAssertEqual(complete, paired)
        metadata["markdownHash"] = String(repeating: "0", count: 64)
        do {
            _ = try await engine.importPayload(
                ImportPayload(
                    format: .json, original: try JSONSerialization.data(withJSONObject: metadata),
                    pairedMarkdown: bytes, suggestedName: "custom"))
            XCTFail("Wrong paired Markdown accepted")
        } catch {}
    }

    func testUnsafeLinksAreNeverAllowed() {
        for value in [
            "javascript:alert(1)", "file:///tmp/private", "data:text/html,hello", "https:foo",
            "mailto:private@example.com",
        ] { XCTAssertNil(safeSourceURL(value)) }
        XCTAssertNotNil(safeSourceURL("https://example.com/video"))
        let inline = MarkdownParser.inline(
            "[bad](javascript:alert) [good](https://example.com) ![remote](https://example.com/image.png) <script>alert(1)</script>"
        )
        XCTAssertFalse(String(inline.characters).contains("<script>"))
        XCTAssertTrue(String(inline.characters).contains("圖片已略過"))
        for run in inline.runs {
            if let link = run.link { XCTAssertNotNil(safeSourceURL(link.absoluteString)) }
        }
    }

    func testMarkdownSupportsBlockKinds() {
        let blocks = MarkdownParser.parse(
            "# Title\n\n- Item\n> Quote\n```swift\nlet value = 1\n```\n| A | B |\n| --- | --- |\n| C | D |"
        )
        XCTAssertEqual(blocks.count, 5)
        guard case .table(let rows) = blocks.last?.kind else { return XCTFail("Table missing") }
        XCTAssertEqual(rows, [["A", "B"], ["C", "D"]])
    }

    func testProjectedYouTubeLinksDecodeAndOldReviewSnapshotsRemainReadable() async throws {
        var document = try XCTUnwrap(
            (try corpus()["cases"] as? [[String: Any]])?.first?["input"] as? [String: Any])
        var source = try XCTUnwrap(document["source"] as? [String: Any])
        source["platform"] = "youtube"
        source["url"] = "https://youtu.be/aqz-KE-bpKQ?t=999"
        document["source"] = source
        document["playbackOverrides"] = ["cue-1": ["startMs": 83_000, "endMs": 85_000]]
        let material = try await ContractEngine().importPayload(
            ImportPayload(
                format: .json, original: try JSONSerialization.data(withJSONObject: document),
                pairedMarkdown: nil, suggestedName: "YouTube"))
        let scene = try XCTUnwrap(material.scenes.first)
        let row = try XCTUnwrap(scene.groups.first?.rows.first)
        XCTAssertEqual(row.playbackLink?.startMs, 83_000)
        XCTAssertEqual(row.playbackLink?.segmentEndMs, 85_000)
        XCTAssertEqual(
            row.playbackLink?.validatedURL?.absoluteString,
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s")
        XCTAssertNotNil(scene.playbackLink)
        XCTAssertEqual(scene.untranslatedGroups.first?.rows.first?.playbackLink, row.playbackLink)
        let old = Data(
            """
            {"id":"old","materialID":"local:old","title":"Old","sceneTitle":"Scene","language":"en","createdAt":0,
             "group":{"id":"cue-1","rows":[{"id":"cue-1","text":"Original","translation":"","pronunciation":[]}],"analyses":[]}}
            """.utf8)
        let review = try JSONDecoder().decode(ReviewEntry.self, from: old)
        XCTAssertNil(review.group.rows.first?.playbackLink)
        let oldScene = Data(
            """
            {"id":"old","title":"Old","context":"","groups":[],"untranslatedGroups":[]}
            """.utf8)
        XCTAssertNil(try JSONDecoder().decode(ReaderScene.self, from: oldScene).playbackLink)
        let roundTrip = try JSONDecoder().decode(ReaderRow.self, from: JSONEncoder().encode(row))
        XCTAssertEqual(roundTrip.playbackLink, row.playbackLink)
    }

    func testProjectedNetflixLinksDecodeAndSurviveReviewSnapshots() async throws {
        var document = try XCTUnwrap(
            (try corpus()["cases"] as? [[String: Any]])?.first?["input"] as? [String: Any])
        var source = try XCTUnwrap(document["source"] as? [String: Any])
        source["platform"] = "netflix"
        source["url"] = "https://netflix.com/watch/80057281?t=999#old"
        document["source"] = source
        document["playbackOverrides"] = ["cue-1": ["startMs": 83_125, "endMs": 85_500]]
        let material = try await ContractEngine().importPayload(
            ImportPayload(
                format: .json, original: try JSONSerialization.data(withJSONObject: document),
                pairedMarkdown: nil, suggestedName: "Netflix"))
        let scene = try XCTUnwrap(material.scenes.first)
        let group = try XCTUnwrap(scene.groups.first)
        let link = try XCTUnwrap(group.rows.first?.playbackLink)
        XCTAssertEqual(link.platform, .netflix)
        XCTAssertEqual(
            link.validatedURL?.absoluteString, "https://www.netflix.com/watch/80057281")
        XCTAssertEqual(link.timestamp, "1:23")
        XCTAssertEqual(link.startMs, 83_125)
        XCTAssertFalse(link.usesEmbeddedPlayback(hasPlayer: true))
        XCTAssertNotNil(scene.playbackLink?.validatedURL)
        let review = ReviewEntry(
            id: "netflix", materialID: "local:netflix", title: material.title,
            sceneTitle: scene.title, language: material.language, group: group, createdAt: .now)
        let decoded = try JSONDecoder().decode(ReviewEntry.self, from: JSONEncoder().encode(review))
        XCTAssertEqual(decoded.group.rows.first?.playbackLink, link)
        XCTAssertEqual(decoded.group.netflixPlaybackLink, link)
        XCTAssertEqual(scene.netflixPlaybackLink?.platform, .netflix)
    }

    @MainActor
    func testNetflixLinksNeverBecomeYouTubePlaybackRequests() {
        let link = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.netflix.com/watch/80057281?t=83", endMs: 85_000)
        let model = YouTubePlaybackModel()
        model.play(link)
        XCTAssertNil(model.request)
        XCTAssertNil(YouTubePlaybackRequest(link: link).json)
        XCTAssertFalse(link.usesEmbeddedPlayback(hasPlayer: true))
        let youtube = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s")
        XCTAssertTrue(youtube.usesEmbeddedPlayback(hasPlayer: true))
        XCTAssertFalse(youtube.usesEmbeddedPlayback(hasPlayer: false))
    }

    func testNetflixPlaybackBoundaryRejectsTamperedURLsAndTimes() {
        let canonical = "https://www.netflix.com/watch/80057281?t=83"
        XCTAssertNotNil(ExternalPlaybackLink(startMs: 83_999, webURL: canonical).validatedURL)
        let source = "https://www.netflix.com/watch/80057281"
        XCTAssertEqual(
            ExternalPlaybackLink(startMs: 83_999, webURL: source).sourceURL?.absoluteString, source)
        XCTAssertEqual(
            ExternalPlaybackLink(startMs: 83_999, webURL: canonical).sourceURL?.absoluteString,
            source)
        XCTAssertNotNil(
            ExternalPlaybackLink(
                startMs: 0,
                webURL: "https://www.netflix.com/watch/80057281?t=0"
            ).validatedURL)
        for url in [
            canonical + "#old", canonical + "&t=83", canonical + "&start=7",
            canonical.replacingOccurrences(of: "t=83", with: "t=82"),
            canonical.replacingOccurrences(of: "t=83", with: "t=83s"),
            canonical.replacingOccurrences(
                of: "www.netflix.com", with: "www.netflix.com.evil.test"),
            canonical.replacingOccurrences(of: "www.netflix.com", with: "user@www.netflix.com"),
            canonical.replacingOccurrences(of: "www.netflix.com", with: "www.netflix.com:444"),
            canonical.replacingOccurrences(of: "watch/", with: "title/"),
            canonical.replacingOccurrences(of: "80057281?", with: "80057281/extra?"),
            canonical.replacingOccurrences(of: "https:", with: "http:"),
        ] { XCTAssertNil(ExternalPlaybackLink(startMs: 83_000, webURL: url).validatedURL, url) }
        for start in [-1.0, Double.nan, Double.infinity, 43_200_000] {
            XCTAssertNil(ExternalPlaybackLink(startMs: start, webURL: canonical).validatedURL)
        }
    }

    @MainActor
    func testNetflixTimestampTapsCannotReopenVideoOrSavePosition() async {
        var events: [String] = []
        for seconds in [83, 92] {
            let link = ExternalPlaybackLink(
                startMs: Double(seconds * 1000),
                webURL: "https://www.netflix.com/watch/80057281?t=\(seconds)")
            do {
                try await openExternalPlayback(
                    link, prepare: { events.append("saved") },
                    open: { _, _ in
                        events.append("opened")
                        return true
                    })
                XCTFail("Netflix timestamps must not navigate")
            } catch {
                XCTAssertEqual(
                    error.localizedDescription,
                    ExternalPlaybackFailure.unsupportedSeeking.localizedDescription)
            }
        }
        XCTAssertEqual(events, [], "Reference times must never reopen Netflix or navigate away")
    }

    @MainActor
    func testNetflixSourceOpeningStripsLegacyTimeAndFallsBackOnlyWhenAppUnavailable() async throws {
        let link = ExternalPlaybackLink(
            startMs: 83_125,
            webURL: "https://www.netflix.com/watch/80057281?t=83", endMs: 85_500)
        for results in [[true], [false, true], [false, false]] {
            var events: [String] = []
            var calls = 0
            do {
                try await openExternalPlayback(
                    link, action: .source, prepare: { events.append("saved") },
                    open: { url, appOnly in
                        XCTAssertEqual(url.absoluteString, "https://www.netflix.com/watch/80057281")
                        events.append(appOnly ? "app" : "web")
                        defer { calls += 1 }
                        return results[calls]
                    })
                XCTAssertTrue(results.contains(true))
            } catch {
                XCTAssertEqual(results, [false, false])
                XCTAssertEqual(
                    error.localizedDescription,
                    ExternalPlaybackFailure.unavailable.localizedDescription)
            }
            XCTAssertEqual(
                events, results.count == 1 ? ["saved", "app"] : ["saved", "app", "web"])
        }
    }

    @MainActor
    func testNetflixSourceNeverOpensAfterPositionSaveFails() async {
        let link = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.netflix.com/watch/80057281")
        var opened = false
        do {
            try await openExternalPlayback(
                link, action: .source,
                prepare: { throw ExternalPlaybackFailure.positionNotSaved },
                open: { _, _ in
                    opened = true
                    return true
                })
            XCTFail("Opened Netflix after persistence failed")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                ExternalPlaybackFailure.positionNotSaved.localizedDescription)
        }
        XCTAssertFalse(opened)
    }

    private var momentFixture: String {
        "https://www.netflix.com/watch/80057281?s=i&trkid=123&t=798&d=39&momentUuid=00000000-0000-4000-8000-000000000001&shareType=Moment&shareUuid=00000000-0000-4000-8000-000000000002&trg=cp&unifiedEntityIdEncoded=Video%3A80057281"
    }

    func testMomentTemplateChangesOnlyTimeAndPreservesOfficialMetadata() throws {
        let moment = try NetflixMomentTemplate(momentFixture)
        for start in [0.0, 83_999, 858_000] {
            let link = ExternalPlaybackLink(
                startMs: start,
                webURL: "https://www.netflix.com/watch/80057281", endMs: start + 2000)
            XCTAssertEqual(
                moment.playbackURL(for: link)?.absoluteString,
                momentFixture.replacingOccurrences(of: "t=798&", with: "t=\(Int(start / 1000))&"))
        }
        XCTAssertEqual(
            moment.durationSeconds, 39, "Never infer a short clip duration from cue ends")
        let other = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.netflix.com/watch/81787986")
        XCTAssertNil(moment.playbackURL(for: other))
    }

    func testMomentValidationAndEpisodeScopedPersistence() throws {
        let link = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.netflix.com/watch/80057281")
        let store = NetflixMomentLinks("invalid JSON")
        XCTAssertNil(store.template(for: link))
        let saved = try store.saving(momentFixture, for: link)
        let restored = NetflixMomentLinks(saved)
        XCTAssertEqual(restored.template(for: link)?.originalURL, momentFixture)
        XCTAssertNil(NetflixMomentLinks(restored.removing(for: link)).template(for: link))
        for invalid in [
            momentFixture.replacingOccurrences(
                of: "www.netflix.com", with: "www.netflix.com.evil.test"),
            momentFixture.replacingOccurrences(of: "https:", with: "nflx:"),
            momentFixture.replacingOccurrences(of: "d=39", with: "d=0"),
            momentFixture.replacingOccurrences(of: "d=39", with: "d=121"),
            momentFixture.replacingOccurrences(of: "shareType=Moment", with: "shareType=Other"),
            momentFixture.replacingOccurrences(of: "momentUuid=", with: "missing="),
            momentFixture + "&t=1", momentFixture + "#fragment",
            momentFixture.replacingOccurrences(of: "Video%3A80057281", with: "Video%3A81787986"),
        ] { XCTAssertThrowsError(try NetflixMomentTemplate(invalid), invalid) }
        let other = ExternalPlaybackLink(
            startMs: 0,
            webURL: "https://www.netflix.com/watch/81787986")
        XCTAssertThrowsError(try restored.saving(momentFixture, for: other))
    }

    @MainActor
    func testLinkedMomentOpensOnlyInAppAndPreservesPositionBeforeOpening() async throws {
        let link = ExternalPlaybackLink(
            startMs: 83_999,
            webURL: "https://www.netflix.com/watch/80057281?t=83", endMs: 85_000)
        let moment = try NetflixMomentTemplate(momentFixture)
        for accepted in [true, false] {
            var events: [String] = []
            do {
                try await openExternalPlayback(
                    link, moment: moment,
                    prepare: { events.append("saved") },
                    open: { url, appOnly in
                        XCTAssertTrue(appOnly, "Never send a failed Moment to the browser")
                        XCTAssertEqual(url, moment.playbackURL(for: link))
                        events.append("opened")
                        return accepted
                    })
                XCTAssertTrue(accepted)
            } catch { XCTAssertFalse(accepted) }
            XCTAssertEqual(events, ["saved", "opened"])
        }
        var opened = false
        do {
            try await openExternalPlayback(
                link, moment: moment,
                prepare: { throw ExternalPlaybackFailure.positionNotSaved },
                open: { _, _ in
                    opened = true
                    return true
                })
            XCTFail("Opened after failed save")
        } catch { XCTAssertFalse(opened) }
    }

    func testPlaybackBoundaryRejectsTamperedTimeHostAndURL() {
        let canonical = "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s"
        XCTAssertNotNil(ExternalPlaybackLink(startMs: 83_999, webURL: canonical).validatedURL)
        XCTAssertNotNil(
            ExternalPlaybackLink(
                startMs: 0, webURL: canonical.replacingOccurrences(of: "83s", with: "0s")
            ).validatedURL)
        for url in [
            canonical + "#old", canonical + "&start=7",
            canonical.replacingOccurrences(of: "83s", with: "82s"),
            canonical.replacingOccurrences(
                of: "www.youtube.com", with: "www.youtube.com.evil.test"),
            canonical.replacingOccurrences(of: "www.youtube.com", with: "user@www.youtube.com"),
            canonical.replacingOccurrences(of: "www.youtube.com", with: "www.youtube.com:444"),
            canonical.replacingOccurrences(of: "https:", with: "http:"),
        ] { XCTAssertNil(ExternalPlaybackLink(startMs: 83_000, webURL: url).validatedURL, url) }
        for start in [-1.0, Double.nan, Double.infinity, 43_200_000] {
            XCTAssertNil(ExternalPlaybackLink(startMs: start, webURL: canonical).validatedURL)
        }
    }

    @MainActor
    func testSegmentPlaybackDefaultModesPrecisionAndLegacySnapshots() throws {
        let url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s"
        let link = ExternalPlaybackLink(startMs: 83_125, webURL: url, endMs: 85_500)
        let model = YouTubePlaybackModel()
        model.play(link)
        XCTAssertEqual(model.effectiveMode, .once)
        XCTAssertEqual(link.timeRange, "1:23–1:25")
        let first = try XCTUnwrap(model.request)
        let json = try XCTUnwrap(first.json?.data(using: .utf8))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: json) as? [String: Any])
        XCTAssertEqual(payload["startSeconds"] as? Double, 83.125)
        XCTAssertEqual(payload["endSeconds"] as? Double, 85.5)
        model.mode = .loop
        XCTAssertEqual(model.request?.id, first.id, "Changing mode must not restart the segment")
        model.status = .loopWaiting
        model.togglePlayback()
        XCTAssertEqual(model.command?.action, "pause")
        model.replay()
        XCTAssertNotEqual(model.request?.id, first.id)
        XCTAssertNil(model.command)
        XCTAssertEqual(model.effectiveMode, .loop)

        let old = try JSONDecoder().decode(
            ExternalPlaybackLink.self,
            from: Data("{\"startMs\":83125,\"webURL\":\"\(url)\"}".utf8))
        model.play(old)
        XCTAssertNil(old.segmentEndMs)
        XCTAssertEqual(model.effectiveMode, .continuous)
        model.close()
        XCTAssertNil(model.request)
    }

    func testInvalidSegmentEndsNeverEnableBoundedPlayback() {
        for end in [83_000, 82_000, Double.nan, Double.infinity, 43_200_001] {
            let link = ExternalPlaybackLink(
                startMs: 83_000, webURL: "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s",
                endMs: end)
            XCTAssertNil(link.segmentEndMs)
            XCTAssertNotNil(link.validatedURL, "A legacy external link remains usable")
        }
    }

    @MainActor
    func testExternalPlaybackPreparesBeforeOpeningAndFallsBackOnlyAfterFailure() async throws {
        let link = ExternalPlaybackLink(
            startMs: 83_000,
            webURL: "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=83s")
        for results in [[true], [false, true], [false, false]] {
            var events: [String] = []
            var calls = 0
            do {
                try await openExternalPlayback(
                    link, prepare: { events.append("prepare") },
                    open: { url, universalOnly in
                        XCTAssertEqual(url, link.validatedURL)
                        events.append(universalOnly ? "universal" : "https")
                        defer { calls += 1 }
                        return results[calls]
                    })
                XCTAssertTrue(results.contains(true))
            } catch {
                XCTAssertEqual(results, [false, false])
                XCTAssertEqual(
                    error.localizedDescription,
                    ExternalPlaybackFailure.unavailable.localizedDescription)
            }
            XCTAssertEqual(
                events,
                results.count == 1 ? ["prepare", "universal"] : ["prepare", "universal", "https"])
        }
        var opened = false
        do {
            try await openExternalPlayback(
                link, prepare: { throw ExternalPlaybackFailure.positionNotSaved },
                open: { _, _ in
                    opened = true
                    return true
                })
            XCTFail("Opened after persistence failed")
        } catch { XCTAssertFalse(opened) }
        do {
            try await openExternalPlayback(
                ExternalPlaybackLink(startMs: -1, webURL: link.webURL),
                open: { _, _ in
                    opened = true
                    return true
                })
            XCTFail("Opened invalid link")
        } catch { XCTAssertFalse(opened) }
    }

    @MainActor
    func testMaterialLoadSurvivesCancelledCallerAndCoalescesReentry() async throws {
        let material = Material(
            contractVersion: 1, kind: .markdown, documentID: "one", title: "One", language: "en",
            createdAt: "", sourceTitle: "", sourceURL: nil, scenes: [], markdown: "hello")
        let model = MaterialLoadModel()
        var resume: CheckedContinuation<Material, Error>?
        var calls = 0
        let started = expectation(description: "read started")
        let caller = Task { @MainActor in
            let work = model.load("one") {
                calls += 1
                return try await withCheckedThrowingContinuation {
                    resume = $0
                    started.fulfill()
                }
            }
            await work.value
        }
        await fulfillment(of: [started], timeout: 2)
        caller.cancel()
        let reentry = model.load("one") {
            calls += 1
            return material
        }
        resume?.resume(returning: material)
        await reentry.value
        await caller.value
        XCTAssertEqual(calls, 1)
        guard case .loaded(let loaded) = model.state else {
            return XCTFail("Cancelled caller dropped read result")
        }
        XCTAssertEqual(loaded, material)
    }

    @MainActor
    func testMaterialLoadReplacementAndRetryIgnoreStaleResult() async throws {
        let first = Material(
            contractVersion: 1, kind: .markdown, documentID: "one", title: "One", language: "en",
            createdAt: "", sourceTitle: "", sourceURL: nil, scenes: [], markdown: "hello")
        let model = MaterialLoadModel()
        var resume: CheckedContinuation<Material, Error>?
        let started = expectation(description: "old read started")
        let old = model.load("one") {
            try await withCheckedThrowingContinuation {
                resume = $0
                started.fulfill()
            }
        }
        await fulfillment(of: [started], timeout: 2)
        await model.load("two") { throw ImportFailure.invalid("failed") }.value
        resume?.resume(returning: first)
        await old.value
        guard case .failed = model.state else { return XCTFail("Stale read replaced failure") }
        await model.load("two", retry: true) { first }.value
        guard case .loaded(let loaded) = model.state else { return XCTFail("Retry did not load") }
        XCTAssertEqual(loaded, first)
    }

    func testEmbeddedPlayerRepeatedSeekBackgroundAndNetworkFailure() throws {
        let context = try XCTUnwrap(JSContext())
        context.exceptionHandler = { _, error in XCTFail(error?.toString() ?? "JS exception") }
        context.evaluateScript(
            """
            var window = this, calls = [], messages = [], options;
            function clearTimeout() {} function clearInterval() {}
            function setTimeout() { return 1; } function setInterval() { return 1; }
            window.location = {origin: "https://dev.contextual.language-learning.reader"};
            window.webkit = {messageHandlers: {youtubePlayer: {postMessage: function(v) {messages.push(v);}}}};
            var YT = {Player: function(id, value) {
              options = value;
              return {loadVideoById: function(v){calls.push(["load",v.startSeconds]);},
                cueVideoById: function(v){calls.push(["cue",v.startSeconds]);},
                seekTo: function(v){calls.push(["seek",v]);},
                playVideo: function(){calls.push(["play"]);},
                pauseVideo: function(){calls.push(["pause"]);}};
            }};
            """)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "youtube-player", withExtension: "js"))
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        context.evaluateScript(
            """
            CLLYouTubePlayer.play({id:"a",videoID:"aqz-KE-bpKQ",startSeconds:83});
            onYouTubeIframeAPIReady(); options.events.onReady();
            CLLYouTubePlayer.play({id:"a",videoID:"aqz-KE-bpKQ",startSeconds:83});
            CLLYouTubePlayer.play({id:"b",videoID:"aqz-KE-bpKQ",startSeconds:360});
            CLLYouTubePlayer.play({id:"c",videoID:"aqz-KE-bpKQ",startSeconds:83});
            """)
        XCTAssertEqual(context.evaluateScript("options.videoId")?.toString(), "aqz-KE-bpKQ")
        XCTAssertEqual(context.evaluateScript("options.playerVars.start")?.toInt32(), 83)
        XCTAssertEqual(
            context.evaluateScript("JSON.stringify(calls)")?.toString(),
            "[[\"seek\",83],[\"play\"],[\"seek\",360],[\"play\"],[\"seek\",83],[\"play\"]]")
        context.evaluateScript(
            """
            CLLYouTubePlayer.setActive(false);
            CLLYouTubePlayer.play({id:"d",videoID:"_vRos9BS0Ak",startSeconds:851});
            options.events.onError({data:150});
            """)
        XCTAssertEqual(
            context.evaluateScript("JSON.stringify(calls.slice(-2))")?.toString(),
            "[[\"pause\"],[\"cue\",851]]")
        XCTAssertEqual(context.evaluateScript("messages[messages.length-1].code")?.toInt32(), 150)
        context.evaluateScript("CLLYouTubePlayer.setActive(true);")
        XCTAssertEqual(
            context.evaluateScript("JSON.stringify(calls.slice(-2))")?.toString(),
            "[[\"seek\",851],[\"play\"]]")
        context.evaluateScript(
            "CLLYouTubeNetworkFailure(); CLLYouTubePlayer.play({id:'e',videoID:'_vRos9BS0Ak',startSeconds:900});"
        )
        XCTAssertEqual(
            context.evaluateScript("messages[messages.length-1].requestID")?.toString(), "e")
        XCTAssertEqual(context.evaluateScript("messages[messages.length-1].code")?.toInt32(), -1)
    }

    @MainActor
    func testSentenceSpeechPausesAndResumesWithoutRestartingUtterance() throws {
        let synthesizer = RecordingSpeechSynthesizer()
        let service = SpeechService(synthesizer: synthesizer)
        let source = SentenceSpeechSource(groupID: "group", rowID: "row")
        service.toggle("Hello world.", language: "en-US", source: source)
        XCTAssertEqual(service.currentSource, source)
        XCTAssertTrue(service.isSpeaking)
        XCTAssertFalse(service.isPaused)
        service.toggle("Hello world.", language: "en-US", source: source)
        XCTAssertTrue(service.isPaused)
        XCTAssertEqual(synthesizer.pauses, 1)
        service.toggle("Hello world.", language: "en-US", source: source)
        XCTAssertFalse(service.isPaused)
        XCTAssertEqual(synthesizer.resumes, 1)
        XCTAssertEqual(synthesizer.utterances.count, 1, "Resume must keep the same utterance")
        service.stop()
        XCTAssertNil(service.currentSource)
        XCTAssertFalse(service.isSpeaking)
        XCTAssertFalse(service.isPaused)
    }

    @MainActor
    func testSwitchingSentenceWhilePausedIgnoresPreviousCompletion() async throws {
        let synthesizer = RecordingSpeechSynthesizer()
        let service = SpeechService(synthesizer: synthesizer)
        let first = SentenceSpeechSource(groupID: "first", rowID: "same-row-id")
        let second = SentenceSpeechSource(groupID: "second", rowID: "same-row-id")
        service.toggle("Same sentence.", language: "en-US", source: first)
        let previous = try XCTUnwrap(synthesizer.utterances.last)
        service.toggle("Same sentence.", language: "en-US", source: first)
        service.toggle("Same sentence.", language: "en-US", source: second)
        XCTAssertEqual(service.currentSource, second)
        XCTAssertFalse(service.isPaused)
        XCTAssertEqual(synthesizer.utterances.count, 2)
        service.speechSynthesizer(AVSpeechSynthesizer(), didCancel: previous)
        await Task.yield()
        XCTAssertEqual(service.currentSource, second)
        XCTAssertTrue(service.isSpeaking)
        synthesizer.isSpeaking = false
        service.speechSynthesizer(
            AVSpeechSynthesizer(), didFinish: try XCTUnwrap(synthesizer.utterances.last))
        for _ in 0..<10 where service.isSpeaking { await Task.yield() }
        XCTAssertNil(service.currentSource)
        XCTAssertFalse(service.isSpeaking)
        XCTAssertFalse(service.isPaused)
        service.toggle("Same sentence.", language: "en-US", source: second)
        XCTAssertEqual(synthesizer.utterances.count, 3, "Finished sentences can be replayed")
        service.stop()
    }

    @MainActor
    func testSentenceSpeechOnlyChangesPauseStateWhenSystemAcceptsRequest() {
        let synthesizer = RecordingSpeechSynthesizer()
        let service = SpeechService(synthesizer: synthesizer)
        let source = SentenceSpeechSource(groupID: "group", rowID: "row")
        service.toggle("Hello world.", language: "en-US", source: source)
        synthesizer.acceptsPause = false
        service.toggle("Hello world.", language: "en-US", source: source)
        XCTAssertFalse(service.isPaused)
        synthesizer.acceptsPause = true
        service.toggle("Hello world.", language: "en-US", source: source)
        synthesizer.acceptsResume = false
        service.toggle("Hello world.", language: "en-US", source: source)
        XCTAssertTrue(service.isPaused)
        service.stop()
        XCTAssertFalse(service.isPaused)
        XCTAssertNil(service.currentSource)
    }

    func testSystemSettingsSpeechSeedsJapaneseLanguageAndRequestsAssistiveSettings() throws {
        let utterance = try XCTUnwrap(
            systemSettingsSpeechUtterance(text: "本題に戻ろう。", language: "ja_JP"))
        XCTAssertEqual(utterance.speechString, "本題に戻ろう。")
        XCTAssertEqual(utterance.voice?.language, "ja-JP")
        XCTAssertTrue(utterance.prefersAssistiveTechnologySettings)
    }

    @MainActor
    func testSystemManagedSpeechUsesEachLanguageAndPreservesRequestedRegions() throws {
        let service = SpeechService()
        for language in ["ja-JP", "en-US", "en-GB", "ko-KR", "zh-TW", "zh-CN"] {
            let utterance = try XCTUnwrap(service.makeUtterance("1, 2, 3.", language: language))
            XCTAssertEqual(utterance.voice?.language, language)
            XCTAssertTrue(utterance.prefersAssistiveTechnologySettings)
        }
    }

    @MainActor
    func testLegacyManualVoiceAndRateCannotOverrideSystemManagedSpeech() throws {
        let defaults = UserDefaults.standard
        let previousVoice = defaults.object(forKey: "speechVoiceID")
        let previousRate = defaults.object(forKey: "speechRate")
        defer {
            defaults.set(previousVoice, forKey: "speechVoiceID")
            defaults.set(previousRate, forKey: "speechRate")
        }
        defaults.set("com.apple.ttsbundle.siri_O-ren_ja-JP_compact", forKey: "speechVoiceID")
        defaults.set(Float(0.2), forKey: "speechRate")
        let service = SpeechService()
        let utterance = try XCTUnwrap(service.makeUtterance("Hello.", language: "en-US"))
        XCTAssertEqual(utterance.voice?.language, "en-US")
        XCTAssertTrue(utterance.prefersAssistiveTechnologySettings)
        XCTAssertEqual(utterance.rate, AVSpeechUtteranceDefaultSpeechRate)
    }

    func testUnknownSpeechLanguageDoesNotSilentlyBecomeEnglish() {
        for language in ["", "  ", "unspecified", "UND"] {
            XCTAssertNil(systemSettingsSpeechUtterance(text: "本題に戻ろう。", language: language))
        }
    }

    func testPreviewLanguagesCoverLearningLanguagesAndPreserveChineseVariant() {
        XCTAssertEqual(
            SpeechPreviewLanguage.all.map(\.id),
            [
                "en", "ja", "ko", "es", "fr", "de", "it", "pt", "id", "th", "ms", "vi", "zh-TW",
                "zh-CN",
            ])
        XCTAssertEqual(SpeechPreviewLanguage.initial(for: "ja_JP").id, "ja")
        XCTAssertEqual(SpeechPreviewLanguage.initial(for: "en-GB").id, "en")
        XCTAssertEqual(SpeechPreviewLanguage.initial(for: "zh-Hans").id, "zh-CN")
        XCTAssertEqual(SpeechPreviewLanguage.initial(for: "zh-Hant").id, "zh-TW")
        XCTAssertNotEqual(
            SpeechPreviewLanguage.initial(for: "zh-CN").sample,
            SpeechPreviewLanguage.initial(for: "zh-TW").sample)
    }

    private func corpus() throws -> [String: Any] {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "contract-corpus", withExtension: "json"))
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
}

@MainActor
private final class RecordingSpeechSynthesizer: SpeechSynthesizing {
    weak var delegate: AVSpeechSynthesizerDelegate?
    var isSpeaking = false
    var utterances: [AVSpeechUtterance] = []
    var pauses = 0
    var resumes = 0
    var acceptsPause = true
    var acceptsResume = true

    func speak(_ utterance: AVSpeechUtterance) {
        utterances.append(utterance)
        isSpeaking = true
    }

    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool {
        isSpeaking = false
        return true
    }

    func pauseSpeaking(at boundary: AVSpeechBoundary) -> Bool {
        pauses += 1
        return acceptsPause
    }

    func continueSpeaking() -> Bool {
        resumes += 1
        return acceptsResume
    }
}
