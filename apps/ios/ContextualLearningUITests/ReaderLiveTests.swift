import UIKit
import XCTest

final class ReaderLiveTests: XCTestCase {
    func testFloatingSearchKeyboardKeepsReaderContentFullHeight() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--preload-sample", "-appAppearance", "light",
        ]
        app.launch()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let reader = app.scrollViews["reader-content-scroll"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10))
        let before = reader.frame
        let lowerReview = app.buttons["review-cue-2"]
        XCTAssertTrue(lowerReview.isHittable)
        let visibleText = CGRect(
            x: lowerReview.frame.minX, y: lowerReview.frame.minY,
            width: 60, height: lowerReview.frame.height)
        let beforeInk = try darkPixels(XCUIScreen.main.screenshot(), in: visibleText, app: app)
        XCTAssertGreaterThan(beforeInk, 50)
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.exists)
        search.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), app.debugDescription)
        let docked = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        docked.name = "search-keyboard-initial"
        docked.lifetime = .keepAlways
        add(docked)
        let initialGeometry = XCTAttachment(
            string:
                "before=\(before) initialReader=\(reader.frame) keyboard=\(keyboard.frame)\n"
                + app.debugDescription)
        initialGeometry.name = "search-keyboard-initial-geometry"
        initialGeometry.lifetime = .keepAlways
        add(initialGeometry)
        guard !keyboard.frame.isEmpty, !keyboard.frame.isInfinite else {
            XCTFail("Software keyboard must have visible bounds before attempting floating mode")
            return
        }
        if keyboard.frame.width >= app.frame.width * 0.7 {
            keyboard.pinch(withScale: 0.4, velocity: -1)
        }
        let settled = expectation(description: "Keyboard transition settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { settled.fulfill() }
        wait(for: [settled], timeout: 3)
        let floating = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        floating.name = "search-keyboard-floating"
        floating.lifetime = .keepAlways
        add(floating)
        let geometry = XCTAttachment(
            string:
                "before=\(before) after=\(reader.frame) keyboard=\(keyboard.frame) app=\(app.frame)\n"
                + app.debugDescription)
        geometry.name = "search-keyboard-geometry"
        geometry.lifetime = .keepAlways
        add(geometry)
        XCTAssertLessThan(
            keyboard.frame.width, app.frame.width * 0.7, "Floating keyboard must be reproduced")
        XCTAssertEqual(
            reader.frame.height, before.height, accuracy: 4,
            "Floating search keyboard must not reserve a full-width blank region over the reader")
        XCTAssertTrue(
            lowerReview.isHittable,
            "Reader controls outside the floating keyboard must remain usable")
        XCTAssertFalse(
            visibleText.intersects(keyboard.frame), "Reference text must be outside the keyboard")
        XCTAssertGreaterThan(
            try darkPixels(XCUIScreen.main.screenshot(), in: visibleText, app: app),
            beforeInk / 2,
            "Keyboard backdrop must not erase reader text outside its floating bounds")
        lowerReview.tap()
        XCTAssertEqual(lowerReview.label, "已加入本機複習")
        search.tap()
        search.typeText("zzzz")
        XCTAssertFalse(lesson.exists)
        let clear = search.buttons.firstMatch
        XCTAssertTrue(clear.exists)
        clear.tap()
        XCTAssertTrue(lesson.waitForExistence(timeout: 5))
        if keyboard.exists {
            let hide = keyboard.descendants(matching: .any).matching(
                NSPredicate(format: "label IN %@", ["Hide keyboard", "隱藏鍵盤", "收起鍵盤"])
            ).firstMatch
            XCTAssertTrue(hide.exists, app.debugDescription)
            if hide.exists { hide.tap() }
        }
        XCTAssertFalse(keyboard.exists)
        XCTAssertTrue(lowerReview.isHittable)
        XCTAssertGreaterThan(
            try darkPixels(XCUIScreen.main.screenshot(), in: visibleText, app: app), beforeInk / 2)
    }

    private func darkPixels(_ screenshot: XCUIScreenshot, in rect: CGRect, app: XCUIApplication)
        throws -> Int
    {
        let image = try XCTUnwrap(screenshot.image.cgImage)
        let scale = CGFloat(image.width) / app.frame.width
        let crop = try XCTUnwrap(
            image.cropping(to: rect.applying(CGAffineTransform(scaleX: scale, y: scale))))
        var pixels = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
        try pixels.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(
                CGContext(
                    data: buffer.baseAddress, width: crop.width, height: crop.height,
                    bitsPerComponent: 8,
                    bytesPerRow: crop.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
        }
        return stride(from: 0, to: pixels.count, by: 4).filter {
            pixels[$0] < 190 && pixels[$0 + 1] < 190 && pixels[$0 + 2] < 190
        }.count
    }

    func testRedownloadButtonIsIndependentFromReadLinkAndShowsFeedback() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--drive-actions-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["drive-download-copy"].waitForExistence(timeout: 10))
        app.buttons["drive-download-copy"].tap()
        XCTAssertTrue(app.staticTexts["下載次數：1"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["drive-download-feedback"].exists)
        XCTAssertFalse(app.staticTexts["fixture-reader"].exists)
        app.buttons["drive-download-copy"].tap()
        XCTAssertTrue(app.staticTexts["下載次數：2"].exists)
        app.buttons["drive-read-copy"].tap()
        XCTAssertTrue(app.staticTexts["fixture-reader"].waitForExistence(timeout: 5))
    }

    func testSelectedLocalRemovalRequiresConfirmationAndCanBeCancelled() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        XCTAssertTrue(app.buttons["library-selection-mode"].waitForExistence(timeout: 10))
        app.buttons["library-selection-mode"].tap()
        let row = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "select-item-local:")
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["library-remove-selected"].isEnabled)
        row.tap()
        XCTAssertTrue(app.staticTexts["已選取 1 項"].exists)
        XCTAssertFalse(app.staticTexts["Why were you still home?"].exists)
        app.buttons["selection-toggle-all"].tap()
        XCTAssertTrue(app.staticTexts["已選取 0 項"].exists)
        app.buttons["selection-toggle-all"].tap()
        XCTAssertTrue(app.staticTexts["已選取 1 項"].exists)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "library-multi-selection"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["library-remove-selected"].tap()
        XCTAssertTrue(app.buttons["移除教材與本機複習紀錄"].waitForExistence(timeout: 5))
        if app.buttons["取消"].exists {
            app.buttons["取消"].tap()
        } else {
            // Regular-width iPad confirmation popovers dismiss by tapping outside.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        }
        XCTAssertTrue(row.exists)
        XCTAssertTrue(app.staticTexts["已選取 1 項"].exists)
        app.buttons["library-remove-selected"].tap()
        app.buttons["移除教材與本機複習紀錄"].tap()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["範例教材：時間與轉折"].exists)
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
    }

    func testLibraryShowsVideoSourceAndRetainsItAfterRelaunch() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        for (argument, title) in [("--youtube-sample", "YouTube"), ("--netflix-sample", "Netflix")]
        {
            let app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--reset-library", argument]
            app.launch()
            XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
            app.buttons["import-sample"].tap()
            let source = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", "影片來源：" + title)).firstMatch
            XCTAssertTrue(source.waitForExistence(timeout: 10), app.debugDescription)
            XCTAssertGreaterThanOrEqual(source.frame.minX, app.frame.minX)
            XCTAssertLessThanOrEqual(source.frame.maxX, app.frame.maxX)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "library-source-" + title.lowercased()
            screenshot.lifetime = .keepAlways
            add(screenshot)
            app.terminate()
            app.launchArguments = ["--ui-testing"]
            app.launch()
            XCTAssertTrue(source.waitForExistence(timeout: 10), app.debugDescription)
            app.terminate()
        }
    }

    func testSentenceSpeechControlStaysInlineAndSupportsPauseResume() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let first = app.buttons["speak-row-cue-1"]
        let second = app.buttons["speak-row-cue-2"]
        XCTAssertTrue(second.waitForExistence(timeout: 10))
        if !second.isHittable { app.scrollViews["reader-content-scroll"].swipeUp() }
        XCTAssertTrue(first.label.hasPrefix("朗讀："))
        second.tap()
        XCTAssertTrue(second.label.hasPrefix("暫停朗讀："))
        XCTAssertTrue(first.label.hasPrefix("朗讀："))
        XCTAssertFalse(app.buttons["stop-speech"].exists)
        second.tap()
        XCTAssertTrue(second.label.hasPrefix("繼續朗讀："))
        XCTAssertTrue(second.isHittable)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "sentence-inline-paused"
        image.lifetime = .keepAlways
        add(image)
        second.tap()
        XCTAssertTrue(second.label.hasPrefix("暫停朗讀："))
        second.tap()
        XCTAssertTrue(second.label.hasPrefix("繼續朗讀："))
        first.tap()
        XCTAssertTrue(first.label.hasPrefix("暫停朗讀："))
        XCTAssertTrue(second.label.hasPrefix("朗讀："))
        first.tap()
        XCTAssertTrue(first.label.hasPrefix("繼續朗讀："))
    }

    func testNetflixReferenceTimesDoNotReopenVideoInReaderAndReview() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--netflix-sample", "--playback-open-failure",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let scene = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "play-scene-")
        ).firstMatch
        XCTAssertTrue(scene.waitForExistence(timeout: 10))
        XCTAssertEqual(scene.label, "Netflix 參考時間 1:23")
        XCTAssertFalse(
            app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "play-scene-")
            ).firstMatch.exists)
        let row = app.descendants(matching: .any).matching(identifier: "play-row-cue-1").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.label, "Netflix 參考時間 1:23")
        XCTAssertFalse(app.buttons["play-row-cue-1"].exists)
        let alert = app.alerts["無法開啟影片"]
        for target in [scene, row, row] {
            target.tap()
            XCTAssertFalse(alert.exists, "Reference timestamps must not open a URL")
        }
        let source = app.buttons["open-netflix-source"]
        XCTAssertEqual(app.buttons.matching(identifier: "open-netflix-source").count, 1)
        XCTAssertEqual(source.label, "在 Netflix 開啟影片")
        source.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["好"].tap()
        XCTAssertFalse(app.buttons["video-playback-mode"].exists)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "netflix-reference-times"
        image.lifetime = .keepAlways
        add(image)
        let review = app.buttons["review-cue-1"]
        if !review.isHittable { app.scrollViews["reader-content-scroll"].swipeUp() }
        review.tap()
        app.terminate()
        app.launchArguments = ["--ui-testing", "--playback-open-failure"]
        app.launch()
        selectTab("複習", in: app)
        XCTAssertTrue(app.buttons["start-review"].waitForExistence(timeout: 5))
        app.buttons["start-review"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.label, "Netflix 參考時間 1:23")
        XCTAssertFalse(app.buttons["play-row-cue-1"].exists)
        row.tap()
        XCTAssertFalse(alert.exists)
        XCTAssertEqual(app.buttons.matching(identifier: "open-netflix-source").count, 1)
        source.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["好"].tap()
        app.buttons["reveal-answer"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertFalse(alert.exists)
        XCTAssertFalse(app.buttons["play-row-cue-1"].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "open-netflix-source").count, 1)
        XCTAssertFalse(app.buttons["video-playback-mode"].exists)
    }

    func testLinkedNetflixMomentsPersistThroughReviewAndCanBeRemoved() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--netflix-sample", "--playback-open-failure",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let configure = app.buttons["configure-netflix-moment"]
        XCTAssertTrue(configure.waitForExistence(timeout: 10))
        configure.tap()
        let input = app.descendants(matching: .any).matching(identifier: "netflix-moment-url")
            .firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText(
            "https://www.netflix.com/watch/80057281?s=i&trkid=123&t=798&d=39&momentUuid=00000000-0000-4000-8000-000000000001&shareType=Moment&shareUuid=00000000-0000-4000-8000-000000000002&trg=cp&unifiedEntityIdEncoded=Video%3A80057281"
        )
        app.buttons["save-netflix-moment"].tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.label, "在 Netflix 播放片段，起點 1:23")
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "netflix-linked-moment-reader"
        image.lifetime = .keepAlways
        add(image)
        row.tap()
        let alert = app.alerts["無法開啟影片"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["好"].tap()
        let review = app.buttons["review-cue-1"]
        if !review.isHittable { app.scrollViews["reader-content-scroll"].swipeUp() }
        review.tap()
        app.terminate()
        app.launchArguments = ["--ui-testing", "--playback-open-failure"]
        app.launch()
        selectTab("複習", in: app)
        XCTAssertTrue(app.buttons["start-review"].waitForExistence(timeout: 5))
        app.buttons["start-review"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.label, "在 Netflix 播放片段，起點 1:23")
        app.buttons["reveal-answer"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        configure.tap()
        XCTAssertTrue(app.buttons["remove-netflix-moment"].waitForExistence(timeout: 5))
        app.buttons["remove-netflix-moment"].tap()
        let reference = app.descendants(matching: .any).matching(identifier: "play-row-cue-1")
            .firstMatch
        XCTAssertTrue(reference.waitForExistence(timeout: 5))
        XCTAssertEqual(reference.label, "Netflix 參考時間 1:23")
        XCTAssertFalse(row.exists)
    }

    func testPlaybackModeMenuKeepsAnchorAndControlsStable() {
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let play = app.buttons["play-row-cue-1"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        play.tap()
        let mode = app.buttons["video-playback-mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 10))
        waitForPlaybackStatus("片段已播完", mode: mode)
        XCTAssertFalse(app.staticTexts["片段已播完"].exists)
        func settledModeFrame() -> CGRect {
            var previous = CGRect.null
            var changedAt = Date.timeIntervalSinceReferenceDate
            let settled = XCTNSPredicateExpectation(
                predicate: NSPredicate { _, _ in
                    let current = mode.frame
                    if current != previous {
                        previous = current
                        changedAt = Date.timeIntervalSinceReferenceDate
                        return false
                    }
                    return Date.timeIntervalSinceReferenceDate - changedAt >= 0.3
                }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed)
            return mode.frame
        }
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            for title in ["播放一次", "重複此片段"] {
                let before = settledModeFrame()
                let keepingSelection = (mode.value as? String)?.contains(title) == true
                let replay = app.buttons["video-replay-segment"].frame
                let toggle = app.buttons["video-toggle-playback"].frame
                XCTAssertLessThanOrEqual(before.width, 200)
                XCTAssertGreaterThanOrEqual(before.height, 44)
                mode.tap()
                let option = app.buttons[title]
                XCTAssertTrue(option.waitForExistence(timeout: 5))
                XCTAssertTrue(option.isHittable)
                let image = XCTAttachment(screenshot: app.screenshot())
                image.name = "mode-native-menu-\(orientation.rawValue)-\(title)"
                image.lifetime = .keepAlways
                add(image)
                option.tap()
                XCTAssertTrue(mode.waitForExistence(timeout: 5))
                _ = settledModeFrame()
                XCTAssertTrue((mode.value as? String)?.contains(title) == true)
                XCTAssertEqual(mode.frame.minX, before.minX, accuracy: 1)
                XCTAssertEqual(mode.frame.minY, before.minY, accuracy: 1)
                if keepingSelection {
                    XCTAssertEqual(mode.frame.width, before.width, accuracy: 1)
                }
                XCTAssertLessThanOrEqual(mode.frame.width, 200)
                XCTAssertEqual(mode.frame.height, before.height, accuracy: 1)
                XCTAssertEqual(app.buttons["video-replay-segment"].frame, replay)
                XCTAssertEqual(app.buttons["video-toggle-playback"].frame, toggle)
            }
        }
    }

    func testNativeReaderToolbarSurvivesRepeatedSidebarToggles() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        XCTAssertTrue(app.buttons["scene-picker"].waitForExistence(timeout: 10))
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            for index in 0..<4 {
                let toggle = app.buttons.matching(
                    NSPredicate(
                        format:
                            "label CONTAINS[c] 'sidebar' OR label CONTAINS '側邊' OR identifier CONTAINS[c] 'sidebar'"
                    )
                ).firstMatch
                XCTAssertTrue(toggle.waitForExistence(timeout: 5), app.debugDescription)
                XCTAssertTrue(toggle.isHittable)
                toggle.tap()
                let restored = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "exists == true AND hittable == true"),
                    object: toggle)
                XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 5), .completed)
                XCTAssertTrue(app.navigationBars.buttons["scene-picker"].isHittable)
                XCTAssertTrue(app.navigationBars.buttons["reader-display-options"].isHittable)
                let analysis = app.buttons.matching(
                    NSPredicate(format: "identifier BEGINSWITH %@", "analysis-")
                ).firstMatch
                XCTAssertTrue(analysis.exists, app.debugDescription)
                if analysis.exists {
                    XCTAssertEqual(
                        analysis.frame.minX, app.staticTexts["reader-scene-title"].frame.minX,
                        accuracy: 2)
                    XCTAssertEqual(analysis.frame.maxX, app.frame.maxX - 22, accuracy: 2)
                }
                let image = XCTAttachment(screenshot: app.screenshot())
                image.name = "native-toolbar-\(orientation.rawValue)-toggle-\(index)"
                image.lifetime = .keepAlways
                add(image)
            }
        }
    }

    func testReaderControlsTitleAndSentencesShareLeadingAlignment() {
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let source = app.staticTexts.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "source-")
        ).firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            let title = app.staticTexts["reader-scene-title"]
            let picker = app.buttons["scene-picker"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            XCTAssertLessThan(picker.frame.minY, app.frame.minY + 140)
            XCTAssertTrue(app.navigationBars.buttons["scene-picker"].isHittable)
            XCTAssertEqual(app.buttons["play-row-cue-1"].frame.minX, title.frame.minX, accuracy: 2)
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "reader-aligned-\(orientation.rawValue)"
            image.lifetime = .keepAlways
            add(image)
        }
        app.buttons["play-row-cue-1"].tap()
        XCTAssertTrue(app.webViews["youtube-embedded-player"].waitForExistence(timeout: 10))
        let title = app.staticTexts["reader-scene-title"]
        XCTAssertTrue(app.navigationBars.buttons["scene-picker"].isHittable)
        XCTAssertEqual(app.buttons["play-row-cue-1"].frame.minX, title.frame.minX, accuracy: 2)
        let pickerY = app.buttons["scene-picker"].frame.minY
        app.scrollViews["reader-content-scroll"].swipeUp()
        XCTAssertTrue(app.buttons["scene-picker"].isHittable)
        XCTAssertEqual(app.buttons["scene-picker"].frame.minY, pickerY, accuracy: 2)
    }

    func testRemoveMaterialSwipeWaitsForConfirmation() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--reset-appearance"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        app.cells.containing(.staticText, identifier: "範例教材：時間與轉折").firstMatch.swipeLeft()
        let remove = app.buttons["移除"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "destructive-remove-swipe"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        remove.tap()
        XCTAssertTrue(app.buttons["移除教材與本機複習紀錄"].waitForExistence(timeout: 5))
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
    }

    func testSidebarSelectionContrastAndSettingsWidthInBothAppearances() {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--reset-appearance"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 10))
        for appearance in ["淺色", "深色"] {
            selectTab("設定", in: app)
            let settings = app.buttons["theme-picker"]
            XCTAssertTrue(settings.waitForExistence(timeout: 5))
            XCTAssertLessThanOrEqual(settings.frame.width, 720)
            chooseTheme("暖陶", in: app)
            app.segmentedControls["appearance-picker"].buttons[appearance].tap()
            XCTAssertLessThanOrEqual(app.buttons["theme-picker"].frame.width, 720)
            XCTAssertEqual(app.buttons["theme-picker"].frame.midX, app.frame.midX, accuracy: 8)
            XCTAssertGreaterThanOrEqual(app.buttons["theme-picker"].frame.minX, app.frame.minX)
            XCTAssertLessThanOrEqual(app.buttons["theme-picker"].frame.maxX, app.frame.maxX)
            let form = XCTAttachment(screenshot: app.screenshot())
            form.name = "bounded-settings-\(appearance)"
            form.lifetime = .keepAlways
            add(form)
            selectTab("教材庫", in: app)
            lesson.tap()
            XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 5))
            XCTAssertTrue(
                app.cells.containing(.staticText, identifier: "範例教材：時間與轉折").firstMatch.isSelected)
            let sidebar = XCTAttachment(screenshot: app.screenshot())
            sidebar.name = "active-sidebar-\(appearance)"
            sidebar.lifetime = .keepAlways
            add(sidebar)
        }
        selectTab("設定", in: app)
        app.buttons["reset-appearance"].tap()
    }

    func testThemeSettingsApplyPersistResetAndKeepReaderAndReview() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--reset-appearance", "--youtube-sample",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        XCTAssertTrue(app.buttons["play-row-cue-1"].waitForExistence(timeout: 10))
        app.buttons["play-row-cue-1"].tap()
        XCTAssertTrue(app.buttons["video-playback-mode"].waitForExistence(timeout: 5))
        selectTab("設定", in: app)
        XCTAssertTrue(app.buttons["theme-picker"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["theme-picker"].value as? String, "海藍")
        let picker = app.segmentedControls["appearance-picker"]
        for (theme, appearance) in [
            ("warm", "淺色"), ("ocean", "深色"), ("forest", "淺色"), ("indigo", "深色"),
        ] {
            chooseTheme(themeName(theme), in: app)
            picker.buttons[appearance].tap()
            XCTAssertEqual(app.buttons["theme-picker"].value as? String, themeName(theme))
            XCTAssertTrue(picker.buttons[appearance].isSelected)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "theme-\(theme)-\(appearance)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
        chooseTheme("海藍", in: app)
        picker.buttons["深色"].tap()
        selectTab("教材庫", in: app)
        XCTAssertTrue(app.buttons["video-playback-mode"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["video-playback-time"].label.contains("1:23–1:25"))
        let reader = XCTAttachment(screenshot: app.screenshot())
        reader.name = "theme-ocean-dark-reader"
        reader.lifetime = .keepAlways
        add(reader)
        app.buttons["close-video-player"].tap()
        app.buttons["review-cue-1"].tap()
        selectTab("複習", in: app)
        XCTAssertTrue(app.buttons["start-review"].waitForExistence(timeout: 5))
        app.buttons["start-review"].tap()
        app.buttons["play-row-cue-1"].tap()
        XCTAssertTrue(app.buttons["video-playback-mode"].waitForExistence(timeout: 5))
        let review = XCTAttachment(screenshot: app.screenshot())
        review.name = "theme-ocean-dark-review"
        review.lifetime = .keepAlways
        add(review)
        app.buttons["結束"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        selectTab("設定", in: app)
        XCTAssertTrue(app.buttons["theme-picker"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["theme-picker"].value as? String, "海藍")
        XCTAssertTrue(picker.buttons["深色"].isSelected)
        app.buttons["reset-appearance"].tap()
        XCTAssertEqual(app.buttons["theme-picker"].value as? String, "海藍")
        XCTAssertTrue(picker.buttons["跟隨系統"].isSelected)
        XCTAssertFalse(app.buttons["reset-appearance"].isEnabled)
    }

    func testShortLandscapeKeepsPlaybackControlsReachable() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        let toggle = app.buttons["video-toggle-playback"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        let panel = app.scrollViews["video-panel-scroll"]
        panel.swipeUp()
        waitForPlaybackStatus("片段已播完", mode: app.buttons["video-playback-mode"])
        XCTAssertTrue(toggle.isHittable)
        XCTAssertLessThanOrEqual(toggle.frame.maxY, panel.frame.maxY)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "segment-short-landscape-controls"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testSegmentPlaybackModesAndReviewControls() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let play = app.buttons["play-row-cue-1"]
        XCTAssertTrue(play.waitForExistence(timeout: 10))
        play.tap()
        let mode = app.buttons["video-playback-mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 10))
        XCTAssertTrue((mode.value as? String)?.contains("播放一次") == true)
        XCTAssertTrue(app.staticTexts["video-playback-time"].label.contains("1:23–1:25"))
        waitForPlaybackStatus("片段已播完", mode: mode)
        mode.tap()
        app.buttons["重複此片段"].tap()
        XCTAssertTrue((mode.value as? String)?.contains("重複此片段") == true)
        app.buttons["video-replay-segment"].tap()
        waitForPlaybackStatus("稍後重播", mode: mode)
        waitForPlaybackStatus("片段間隔 0.5 秒重播", mode: mode)
        waitForPlaybackStatus("稍後重播", mode: mode)
        app.buttons["video-toggle-playback"].tap()
        waitForPlaybackStatus("已暫停", mode: mode)
        mode.tap()
        app.buttons["繼續播放影片"].tap()
        XCTAssertTrue((mode.value as? String)?.contains("繼續播放影片") == true)
        mode.tap()
        app.buttons["播放一次"].tap()
        app.buttons["video-replay-segment"].tap()
        waitForPlaybackStatus("片段已播完", mode: mode)
        let toggle = app.buttons["video-toggle-playback"]
        XCTAssertTrue(toggle.exists)
        XCTAssertTrue(app.buttons["video-replay-segment"].exists)
        XCTAssertLessThanOrEqual(toggle.frame.maxX, app.frame.maxX)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "segment-player-controls"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["close-video-player"].tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].exists)
        app.buttons["review-cue-1"].tap()
        selectTab("複習", in: app)
        app.buttons["start-review"].tap()
        app.buttons["play-row-cue-1"].tap()
        XCTAssertTrue(mode.waitForExistence(timeout: 5))
        XCTAssertTrue((mode.value as? String)?.contains("播放一次") == true)
        XCTAssertTrue(app.staticTexts["video-playback-time"].label.contains("1:23–1:25"))
    }

    func testOpeningMaterialKeepsLibraryRowAndSectionStable() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lessons = app.staticTexts.matching(identifier: "範例教材：時間與轉折")
        XCTAssertTrue(lessons.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["尚未開始"].exists)
        let row = app.cells.containing(.staticText, identifier: "範例教材：時間與轉折").firstMatch
        let before = row.frame
        lessons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["上次閱讀"].waitForExistence(timeout: 5))
        XCTAssertEqual(lessons.count, 1, "Opening a material must not duplicate its library row")
        XCTAssertEqual(row.frame.minY, before.minY, accuracy: 2)
        XCTAssertEqual(row.frame.height, before.height, accuracy: 2)
        XCTAssertTrue(row.isSelected, "Progress updates must preserve the selected row")
        XCTAssertFalse(app.staticTexts["繼續閱讀"].exists)
        selectTab("複習", in: app)
        selectTab("教材庫", in: app)
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 5))
        XCTAssertEqual(lessons.count, 1)
        XCTAssertEqual(row.frame.minY, before.minY, accuracy: 2)
        XCTAssertEqual(row.frame.height, before.height, accuracy: 2)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "library-single-stable-row"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testCompactLibraryReturnsToSingleRowAndResumesReading() {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lessons = app.staticTexts.matching(identifier: "範例教材：時間與轉折")
        XCTAssertTrue(lessons.firstMatch.waitForExistence(timeout: 10))
        let row = app.cells.containing(.staticText, identifier: "範例教材：時間與轉折").firstMatch
        let before = row.frame
        let section = app.staticTexts["所有教材"]
        let offsetInSection = before.minY - section.frame.minY
        lessons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 10))
        app.navigationBars.buttons["教材庫"].tap()
        XCTAssertTrue(lessons.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(lessons.count, 1)
        XCTAssertEqual(row.frame.minY - section.frame.minY, offsetInSection, accuracy: 2)
        XCTAssertEqual(row.frame.height, before.height, accuracy: 2)
        XCTAssertTrue(app.staticTexts["上次閱讀"].exists)
        let returnedFrame = row.frame
        lessons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["教材庫"].tap()
        XCTAssertTrue(lessons.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(row.frame.minY, returnedFrame.minY, accuracy: 2)
        XCTAssertEqual(row.frame.height, returnedFrame.height, accuracy: 2)
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(lessons.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(lessons.count, 1)
        XCTAssertTrue(app.staticTexts["上次閱讀"].exists)
        lessons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "library-compact-resumed-reader"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testPortraitVideoStacksWithLibrarySidebarCollapsed() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let sidebar = app.buttons.matching(
            NSPredicate(
                format:
                    "label CONTAINS[c] 'sidebar' OR label CONTAINS '側邊' OR identifier CONTAINS[c] 'sidebar'"
            )
        ).firstMatch
        XCTAssertTrue(sidebar.exists, app.debugDescription)
        guard sidebar.exists else { return }
        sidebar.tap()
        row.tap()
        let video = app.webViews["youtube-embedded-player"].firstMatch
        XCTAssertTrue(video.waitForExistence(timeout: 5))
        let reading = app.scrollViews["reader-content-scroll"]
        XCTAssertGreaterThan(reading.frame.width, app.frame.width * 0.8)
        XCTAssertLessThanOrEqual(video.frame.maxY, reading.frame.minY + 1)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "portrait-collapsed-sidebar-player"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 5), .completed)
        XCTAssertLessThanOrEqual(video.frame.maxX, reading.frame.minX + 1)
        XCTAssertTrue(app.otherElements["player-reader-divider"].isHittable)
        XCUIDevice.shared.orientation = .portrait
        let portrait = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                app.frame.height > app.frame.width && video.frame.maxY <= reading.frame.minY + 1
            }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [portrait], timeout: 5), .completed)
        XCTAssertFalse(app.otherElements["player-reader-divider"].exists)
        XCTAssertEqual(app.webViews.matching(identifier: "youtube-embedded-player").count, 1)
    }

    func testYouTubeTimestampButtonsAndFailureKeepReaderAndReviewPosition() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--youtube-sample", "--playback-open-failure",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let scene = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "play-scene-")
        ).firstMatch
        XCTAssertTrue(scene.waitForExistence(timeout: 10))
        XCTAssertTrue(scene.label.contains("1:23"))
        let readerImage = XCTAttachment(screenshot: app.screenshot())
        readerImage.name = "youtube-reader-timestamps"
        readerImage.lifetime = .keepAlways
        add(readerImage)
        scene.tap()
        XCTAssertTrue(app.staticTexts["video-playback-time"].waitForExistence(timeout: 5))
        app.buttons["video-open-external"].tap()
        XCTAssertTrue(app.alerts["無法開啟影片"].waitForExistence(timeout: 5))
        app.alerts.buttons["好"].tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.contains("1:23"))
        app.buttons["close-video-player"].tap()
        row.tap()
        XCTAssertTrue(app.staticTexts["video-playback-time"].waitForExistence(timeout: 5))
        app.buttons["video-open-external"].tap()
        XCTAssertTrue(app.alerts["無法開啟影片"].waitForExistence(timeout: 5))
        app.alerts.buttons["好"].tap()
        app.buttons["close-video-player"].tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].exists)
        app.buttons["review-cue-1"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing", "--playback-open-success"]
        app.launch()
        selectTab("複習", in: app)
        XCTAssertTrue(app.buttons["start-review"].waitForExistence(timeout: 5))
        app.buttons["start-review"].tap()
        XCTAssertTrue(app.buttons["play-row-cue-1"].waitForExistence(timeout: 5))
        app.buttons["play-row-cue-1"].tap()
        XCTAssertFalse(app.alerts["無法開啟影片"].exists)
        XCTAssertTrue(app.buttons["reveal-answer"].exists)
        XCTAssertTrue(app.staticTexts["video-playback-time"].waitForExistence(timeout: 5))
        app.buttons["close-video-player"].tap()
        app.buttons["reveal-answer"].tap()
        XCTAssertTrue(
            app.buttons["play-row-cue-1"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "play-row-"))
                .count, 1)
        let reviewImage = XCTAttachment(screenshot: app.screenshot())
        reviewImage.name = "youtube-review-timestamp"
        reviewImage.lifetime = .keepAlways
        add(reviewImage)
    }

    func testYouTubeLayoutKeepsReadingAndReviewUsableWhenRotating() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "--youtube-sample", "--playback-open-failure",
        ]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["close-video-player"].waitForExistence(timeout: 5))
        assertPlaybackLayout(
            in: app, scrollID: "reader-content-scroll", minimumReadingHeight: 220,
            name: "player-portrait", stacked: true)
        let scenePicker = app.buttons["scene-picker"]
        XCTAssertTrue(scenePicker.isHittable)
        let pickerTop = scenePicker.frame.minY
        app.scrollViews["reader-content-scroll"].swipeUp()
        XCTAssertTrue(scenePicker.isHittable, "Scene switching must remain available while reading")
        XCTAssertEqual(scenePicker.frame.minY, pickerTop, accuracy: 5)
        scenePicker.tap()
        let selectedScene = app.buttons["正準備出門時接到電話"].firstMatch
        XCTAssertTrue(selectedScene.waitForExistence(timeout: 3))
        selectedScene.tap()
        app.scrollViews["reader-content-scroll"].swipeDown()
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [landscape], timeout: 5), .completed)
        assertPlaybackLayout(
            in: app, scrollID: "reader-content-scroll", minimumReadingHeight: 220,
            name: "player-landscape", stacked: false)
        let divider = app.otherElements["player-reader-divider"]
        XCTAssertTrue(divider.waitForExistence(timeout: 5))
        divider.doubleTap()
        let video = app.webViews["youtube-embedded-player"].firstMatch
        let originalWidth = video.frame.width
        let start = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 65, dy: 0)))
        let resized = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in video.frame.width > originalWidth + 20 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 5), .completed)
        let firstResizeWidth = video.frame.width
        let reading = app.scrollViews["reader-content-scroll"]
        let readingStart = reading.frame.minX
        let expectedShift = min(100, reading.frame.width - 320)
        let secondStart = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        secondStart.press(
            forDuration: 0.1, thenDragTo: secondStart.withOffset(CGVector(dx: 100, dy: 0)))
        let expandedAgain = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in video.frame.width > firstResizeWidth + 40 },
            object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expandedAgain], timeout: 5), .completed,
            "Visible video must keep growing beyond its previous height cap")
        XCTAssertEqual(reading.frame.minX - readingStart, expectedShift, accuracy: 6)
        XCTAssertEqual(video.frame.height, video.frame.width * 9 / 16, accuracy: 1)
        let resizedWidth = video.frame.width
        app.terminate()
        app.launchArguments = ["--ui-testing", "--youtube-sample", "--playback-open-failure"]
        app.launch()
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(divider.waitForExistence(timeout: 5))
        XCTAssertEqual(
            video.frame.width, resizedWidth, accuracy: 5, "Reader split should survive relaunch")
        divider.doubleTap()
        XCTAssertEqual(
            app.webViews.matching(identifier: "youtube-embedded-player").count, 1,
            "Resizing must retain one player")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.buttons["close-video-player"].isHittable)
        app.buttons["close-video-player"].tap()
        app.buttons["review-cue-1"].tap()
        selectTab("複習", in: app)
        app.buttons["start-review"].tap()
        XCTAssertTrue(app.buttons["play-row-cue-1"].waitForExistence(timeout: 5))
        app.buttons["play-row-cue-1"].tap()
        assertPlaybackLayout(
            in: app, scrollID: "review-content-scroll", minimumReadingHeight: 140,
            name: "player-review", stacked: true)
        if !app.buttons["reveal-answer"].isHittable {
            app.scrollViews["review-content-scroll"].swipeUp()
        }
        XCTAssertTrue(app.buttons["reveal-answer"].isHittable)
    }

    private func assertPlaybackLayout(
        in app: XCUIApplication, scrollID: String, minimumReadingHeight: CGFloat, name: String,
        stacked: Bool,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let player = app.webViews["youtube-embedded-player"].firstMatch
        let reading = app.scrollViews[scrollID].firstMatch
        XCTAssertTrue(
            player.waitForExistence(timeout: 5), app.debugDescription, file: file, line: line)
        guard reading.waitForExistence(timeout: 5) else {
            XCTFail(app.debugDescription, file: file, line: line)
            return
        }
        let video = player.frame
        let text = reading.frame
        XCTAssertGreaterThanOrEqual(video.height, 199, file: file, line: line)
        XCTAssertLessThanOrEqual(
            video.height, video.maxY <= text.minY + 1 ? 301 : max(200, text.height - 120) + 1,
            file: file, line: line)
        XCTAssertGreaterThanOrEqual(text.height, minimumReadingHeight, file: file, line: line)
        XCTAssertGreaterThanOrEqual(text.width, 280, file: file, line: line)
        XCTAssertTrue(
            stacked ? video.maxY <= text.minY + 1 : video.maxX <= text.minX + 1,
            "Unexpected player placement: \(video), reading: \(text)", file: file, line: line)
        XCTAssertTrue(app.buttons["video-open-external"].isHittable, file: file, line: line)
        XCTAssertTrue(app.buttons["close-video-player"].isHittable, file: file, line: line)
        let geometry = XCTAttachment(string: "window=\(app.frame) player=\(video) reading=\(text)")
        geometry.name = name + "-geometry"
        geometry.lifetime = .keepAlways
        add(geometry)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testSpeechSettingsUseSystemManagementAndSwitchPreviewLanguage() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        selectTab("設定", in: app)
        XCTAssertTrue(app.staticTexts["speech-system-management"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["speech-voice-picker"].exists)
        XCTAssertFalse(app.sliders["朗讀速度"].exists)
        let language = app.buttons["speech-preview-language"]
        XCTAssertTrue(language.waitForExistence(timeout: 5))
        let preview = app.buttons["preview-speech-voice"]
        for choice in ["日文", "英文"] {
            language.tap()
            let option = app.buttons[choice].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            option.tap()
            XCTAssertTrue(preview.isHittable)
            preview.tap()
            XCTAssertFalse(app.alerts["無法完成操作"].exists)
            if preview.label == "停止試聽" { preview.tap() }
        }
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "system-managed-speech-and-language-preview"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testYouTubeHTTPSFallbackCanReturnToSameReader() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--youtube-sample"]
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let row = app.buttons["play-row-cue-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["video-open-external"].waitForExistence(timeout: 5))
        app.buttons["video-open-external"].tap()
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Why were you still home?"].exists)
    }

    func testAdaptiveReaderAnalysisAndDriveConfigurationState() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launch()
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let source = app.staticTexts["Why were you still home?"].firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in app.frame.width > app.frame.height }, object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [landscape], timeout: 5), .completed,
            "App frame \(app.frame), main window \(app.windows.firstMatch.frame)")
        XCTAssertLessThanOrEqual(source.frame.maxX, app.frame.maxX + 1)
        let reader = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        reader.name = "reader-landscape"
        reader.lifetime = .keepAlways
        add(reader)
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        let analysis = app.buttons["analysis-cue-1"]
        XCTAssertTrue(analysis.waitForExistence(timeout: 5))
        analysis.tap()
        XCTAssertTrue(
            app.staticTexts["後一句回應這個問題；字幕沒有說明人物關係。"].firstMatch
                .waitForExistence(timeout: 5))
        selectTab("設定", in: app)
        app.swipeUp()
        let unavailable = app.staticTexts["drive-unconfigured"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["google-sign-in"].exists)
    }

    func testLargeTypeReaderKeepsSourceWithinViewport() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "--ui-testing", "--reset-library", "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        for _ in 0..<4 where !app.buttons["import-sample"].isHittable {
            app.collectionViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(app.buttons["import-sample"].waitForExistence(timeout: 10))
        app.buttons["import-sample"].tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 10))
        lesson.tap()
        let source = app.staticTexts["Why were you still home?"].firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        XCTAssertLessThanOrEqual(source.frame.width, app.frame.width)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "reader-large-type"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testSampleReadingReviewAndRelaunch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        let sample = app.buttons["import-sample"]
        XCTAssertTrue(sample.waitForExistence(timeout: 10))
        sample.tap()
        let lesson = app.staticTexts["範例教材：時間與轉折"].firstMatch
        XCTAssertTrue(lesson.waitForExistence(timeout: 15))
        lesson.tap()
        XCTAssertTrue(app.staticTexts["Why were you still home?"].waitForExistence(timeout: 10))
        let review = app.buttons["review-cue-1"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        review.tap()
        selectTab("複習", in: app)
        let start = app.buttons["start-review"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        let reveal = app.buttons["reveal-answer"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["你那時為什麼還在家？"].exists)
        reveal.tap()
        XCTAssertTrue(app.staticTexts["你那時為什麼還在家？"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "review-revealed"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["next-review"].tap()
        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.staticTexts["範例教材：時間與轉折"].firstMatch.waitForExistence(timeout: 10))
        selectTab("複習", in: app)
        XCTAssertTrue(app.buttons["start-review"].waitForExistence(timeout: 5))
    }

    func testFilesImporterCanBeCancelledWithoutError() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library"]
        app.launch()
        app.buttons["import-material"].tap()
        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.waitForExistence(timeout: 5) {
            cancel.tap()
        } else if app.buttons["取消"].firstMatch.exists {
            app.buttons["取消"].firstMatch.tap()
        } else {
            XCTFail("Files importer did not expose its cancel action")
        }
        XCTAssertFalse(app.alerts["無法完成操作"].exists)
    }

    func testImportsJSONThroughSystemFilesPicker() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "--reset-library", "--seed-import-file"]
        app.launch()
        XCTAssertTrue(app.buttons["import-material"].waitForExistence(timeout: 10))
        app.buttons["import-material"].tap()
        let browse = app.buttons.matching(
            NSPredicate(format: "label IN %@", ["Browse", "瀏覽"])
        ).firstMatch
        if browse.waitForExistence(timeout: 5) { browse.tap() }
        let device = app.staticTexts.matching(
            NSPredicate(
                format: "label IN %@", ["On My iPhone", "On My iPad", "我的iPhone", "我的iPad"])
        ).firstMatch
        if device.waitForExistence(timeout: 3) { device.tap() }
        let appFolder = app.staticTexts["Contextual Learning"].firstMatch
        if appFolder.waitForExistence(timeout: 5) { appFolder.tap() }
        let folder = app.staticTexts["UI Test Imports"].firstMatch
        guard folder.waitForExistence(timeout: 5) else {
            XCTFail(app.debugDescription)
            return
        }
        folder.tap()
        let file = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Import-test")
        ).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        file.tap()
        let selected = XCTAttachment(screenshot: app.screenshot())
        selected.name = "files-selected"
        selected.lifetime = .keepAlways
        add(selected)
        let open = app.buttons.matching(
            NSPredicate(format: "label IN %@", ["Open", "打開", "開啟"])
        ).firstMatch
        if open.waitForExistence(timeout: 2) { open.tap() }
        XCTAssertTrue(
            app.staticTexts["範例教材：時間與轉折"].firstMatch.waitForExistence(timeout: 15),
            app.debugDescription)
        XCTAssertFalse(app.alerts["無法完成操作"].exists)
    }

    private func themeName(_ id: String) -> String {
        ["warm": "暖陶", "ocean": "海藍", "forest": "森綠", "indigo": "經典靛藍"][id]!
    }

    private func chooseTheme(_ title: String, in app: XCUIApplication) {
        app.buttons["theme-picker"].tap()
        app.buttons[title].tap()
    }

    private func selectTab(_ title: String, in app: XCUIApplication) {
        let tab = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", title)).firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 5), app.debugDescription)
        tab.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func waitForPlaybackStatus(
        _ text: String, mode: XCUIElement, file: StaticString = #filePath, line: UInt = #line
    ) {
        let status = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in (mode.value as? String)?.contains(text) == true },
            object: nil)
        XCTAssertEqual(
            XCTWaiter.wait(for: [status], timeout: 25), .completed,
            "Expected playback status: \(text); actual: \(String(describing: mode.value))",
            file: file, line: line)
    }

}
