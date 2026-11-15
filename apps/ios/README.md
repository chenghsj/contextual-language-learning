# Contextual Learning for iPhone and iPad

Native SwiftUI reading and local review for existing Contextual Language Learning materials. The universal target requires iOS / iPadOS 17 or later. Simulator verification currently uses iOS 26.5; minimum-version and physical-device acceptance remain open.

## Run locally

1. Install the repository dependencies with `pnpm install` from the repository root. Xcode checks the bundled contract fingerprint against these source dependencies.
2. Run `node apps/ios/scripts/build-contract.mjs --check`. If core sources changed intentionally, regenerate with `node apps/ios/scripts/build-contract.mjs` and review the resource diff.
3. Open `apps/ios/ContextualLearning.xcodeproj`, select the shared `ContextualLearning` scheme and an iPhone or iPad simulator, then Run.
4. Choose **試讀範例教材**, or import files through **匯入教材**. No account is required for local reading and review.

The Xcode project is checked in. Regenerating it requires Ruby's `xcodeproj` gem and `ruby apps/ios/scripts/generate-project.rb`. Ordinary builds do not need the gem. Google Sign-In 9.2.0 is pinned through Swift Package Manager. Device installation requires an appropriate bundle identifier and signing team in Xcode.

```sh
xcodebuild -project apps/ios/ContextualLearning.xcodeproj \
  -scheme ContextualLearning \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/cll-ios-build \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  CODE_SIGNING_ALLOWED=NO test
```

If edited UI tests still log an older interaction sequence, remove only the test runner from the chosen simulator before rerunning. In this environment, reinstalling the runner was necessary to confirm current test code. This leaves the app and its materials intact.

```sh
xcrun simctl uninstall SIMULATOR_UDID \
  dev.contextual.language-learning.contextuallearninguitests.xctrunner
```

## Reading and review

Import standard V7 JSON, a complete generated custom JSON document, custom metadata JSON together with its matching Markdown, or standalone `.md` / `.markdown`. Files are read through security-scoped access and copied into private storage. Individual inputs are bounded to 25,000,000 bytes and a Files import batch to 50,000,000 bytes. Invalid imports preserve the previous material.

The library supports title/source/language search, language filtering, recent reading and local removal. The reader provides scenes, original text, optional translations and pronunciation, expandable analysis, system speech and saved position. iPad uses a native split view. Local review stores selected groups and reveals their answers on request; review entries survive relaunch. It has no spaced-repetition scheduler or cross-device progress synchronization.

The native Markdown renderer supports headings, paragraphs, lists, quotes, fenced code, simple pipe tables and safe HTTP(S) links. Raw HTML is removed and remote images are omitted. It is a bounded reader, not a full CommonMark editor.

## Netflix App playback with a Moments link

Open **連結 Moments 片段** in a Netflix lesson and paste a complete official share link copied from Netflix's **剪輯／Moments → 儲存 → 分享** flow for the same episode/movie. Each watch ID needs its own link. The link is saved only on this device and is reused in reading, imported favorites and local review. The editor can replace or remove it.

With a matching link, scene and original subtitle-row times become **Netflix 片段** buttons. The app retains the official share metadata and duration, changes only the start time, saves reader position, stops speech and opens Netflix directly through a Universal Link. If Netflix does not accept it, it reports an error without falling back to a browser. These are clip-start links; cue end times do not shorten the original shared clip and automatic looping is not available.

Without a linked Moment, times stay selectable **參考時間** text. The separate **在 Netflix 開啟影片** source button remains available. Earlier plain `?t=` and UUID-free minimal Moment links failed on the physical iPad; the complete original link and its zero-time variant worked through normal UIKit opening. Other episodes/app versions still need physical acceptance. See [implementation and verification](../../docs/ios-netflix-links.md) and [source-backed research](../../docs/netflix-native-playback-research.md).

## SQLite persistence

`LibraryRepository` is an actor and owns one system SQLite connection in `Application Support/ContextualLearning/library.sqlite`. There is no external database service or database package. The database uses WAL, foreign keys, prepared parameter binding, a busy timeout and `PRAGMA user_version = 2`. Version 1 migrates by adding nullable source-platform metadata; existing material bytes, reading positions and review records are preserved. Platform labels are backfilled from the saved original payloads.

| Table             | Stored data                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `documents`       | Content-addressed import payloads, preserving the original JSON / Markdown bytes inside their envelope |
| `materials`       | Account-scoped identity, metadata, revision and scene index                                            |
| `positions`       | Current scene/group, visited scenes and recent reading time                                            |
| `review`          | Local review snapshots linked to the owning material                                                   |
| `cloud_inventory` | Last complete Drive listing for each account                                                           |
| `meta`            | Monotonic snapshot sequence to prevent stale UI updates                                                |

Import commits the payload, summary and compatible position changes in one transaction. Unreferenced payloads are pruned transactionally. Failed writes roll back. Deletion uses foreign-key cascades for positions and review. Account logout deletes that account's downloads, favorite snapshots and inventory together while retaining local imports. Shared payloads remain while referenced.

A nonempty manifest from the unreleased file-based prototype is preserved and rejected with a migration message. It is not silently migrated or reset. Future schema changes must add explicit versioned migrations; unknown database versions fail closed.

## Authoritative data contracts

The build bundles existing TypeScript core validation, Reader projection and favorite catalog logic into an offline JavaScriptCore resource. Only this bundled script executes. Imported text is a function argument, never executable code. Native SHA-256 checks canonical favorite bytes. The actor returns versioned, decoded Swift value models; every screen, navigation flow, database operation and speech control is native Swift / SwiftUI.

This boundary preserves the existing execution-version rules, source coverage, UTF-16/grapheme boundaries, teaching relationships and remove-wins favorite semantics. `build-contract.mjs --check` and the Xcode fingerprint phase detect stale generated resources. Unit fixtures include positive and negative contract cases, custom document pairs, canonical favorites and Unicode spans.

## Theme and appearance

Open the **主題與外觀** section on **設定** to select light, dark or system appearance and a color theme (暖陶, 海藍, 森綠 or 經典靛藍). The compact menu applies changes immediately and remembers your choices on this device. Defaults are 海藍 and system appearance.

**重設外觀** in the top toolbar restores only these appearance preferences. Material data, reading position, text size and speech settings remain intact.

## Configure Google Drive

Local reading works with the default unconfigured state. To enable native authentication later:

1. Create an **iOS** OAuth client for your chosen Bundle ID in the existing Google Cloud project. Ensure the Drive API and required consent configuration are ready.
2. Copy `Config/Local.example.xcconfig` to `Config/Local.xcconfig`, which is ignored by Git.
3. Set `IOS_BUNDLE_IDENTIFIER`, `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_REVERSED_CLIENT_ID` using that iOS client's values. The plist receives both the client ID and callback URL scheme from these settings.
4. Rebuild, open **設定 → Google Drive**, sign in, then open the Drive library and refresh.

The SDK manages tokens in its secure storage. Only last-known account identity metadata is stored in defaults for offline display. Drive requests use `drive.file`, remain read-only and reject redirects. Downloads verify identity, bounded UTF-8 content, recorded checksums and custom Markdown pairing. Favorites verify the complete catalog and snapshot hashes before entering the native reader. Incomplete inventory refreshes retain the previous complete listing. Refresh is foreground-only.

In the Drive library, choose **教材** or **雲端收藏**, tap **選取**, and check the rows to act on. **下載所選** downloads only checked, undownloaded items; conflicting backups are skipped. **移除本機副本** removes only checked items already downloaded to this app, after confirmation. The fixed bottom bar shows selection and action counts and provides **全選／取消全選**. Switching categories clears selection. The foreground download queue runs one item at a time and shows progress and failures. **取消下載** preserves completed downloads. Individual downloads and refresh are disabled during a batch; signing out stops it.

The local library also supports **選取 → 勾選 → 移除所選**. Selection is limited to the visible search/language results and current account. Removal confirms the count and deletes the selected local materials and their local review records in one SQLite transaction; any failure rolls back the entire removal. Original imported files and Google Drive originals are retained.

For an existing local copy, **重新下載** first retrieves the current remote file reference and checksum (or the current favorite catalog) before validating and replacing the copy. The row reports **已是最新版本**, a successful update, or the failure reason. Failed validation/downloads retain the existing local copy. Reading and downloading are separate tap targets.

Drive and local library rows display **YouTube** or **Netflix** source labels. For older Drive backups without source metadata, visible rows queue a bounded, authenticated read of the original JSON (or favorite operation), then cache the result with its remote file reference. Unchanged backups reuse the cached platform on refresh. Missing or unrecognized source information displays **來源未提供**; titles are never used to guess the platform. Source lookup does not import an offline copy, and lookup failures do not block reading or downloading.

Real login, consent and visibility of desktop-created files are outside the automated test coverage. A new iOS client must not be assumed to see every existing desktop backup. The app does not write cloud favorites or synchronize review state.

The read-only reader layout ignores only the bottom keyboard safe area at its geometry container. This prevents sidebar search with an iPad floating keyboard from clipping the reader to a full-width keyboard region. The sidebar background also continues behind the keyboard; search remains the native searchable list. The floating-keyboard UI regression checks rendered text outside the keyboard, since accessibility frames alone do not detect the clipping.

## Verification boundaries

See [implementation evidence](../../docs/ios-ipados-implementation.md) for current test results. Simulator tests cover SQLite transactions/relaunch, malformed contracts, Drive transport failures, configuration states and native reading/review. They do not prove real OAuth, physical-device audio or iOS 17 runtime behavior. App icon, production signing, release privacy review and TestFlight / App Store submission remain release work.
