# Manual integration test plan

Automated CI covers TypeScript, unit tests, extension packaging and Native Messaging smoke checks. It cannot prove compatibility with a live Netflix player, Google account or signed-in CLI Agent. Use *synthetic* subtitles and a dedicated test account.

## Extension / Chromium

1. Run pnpm install, pnpm test, pnpm build and pnpm package:release.
2. Extract the Chromium ZIP and confirm manifest.json is at its root. Load that folder through chrome://extensions.
3. Open the Side Panel and import a synthetic SRT/VTT with two timed cues; verify original text and timestamps are unchanged.
4. Test English/Japanese/Korean profiles, instruction-language preferences, document exports and reopening a saved document.
   - In Settings, switch the interface among English, Traditional Chinese, Simplified Chinese, Japanese and Korean. Check the full Create/Reader/Settings UI, duplicate-confirmation dialogs, Google Drive account labels, job history and playback controls for untranslated text.
   - Switch interface language without changing the learning target, source subtitles or the explanation language of an existing lesson. Reopen Side Panel and confirm the override persists.
   - Select browser-language Automatic and test with a supported/unsupported Chrome UI locale (restart Chrome when changing its UI locale). Confirm unsupported languages fall back to English.
   - Test system, light and dark appearance, change the OS theme while Side Panel is open, and confirm explicit light/dark overrides persist when reopening. Verify no dark-mode flash on first display.
   - Check the Chromium ZIP contains all five `_locales/*/messages.json` files and the localized extension name/description in Chrome.
5. Open a YouTube watch video with English subtitles and the Side Panel. Click **一鍵取得目前影片字幕** without uploading a file; confirm it selects the current tab and produces readable timestamps and the YouTube source title/URL. Switch between Netflix and YouTube watch tabs while the panel remains open; verify the empty form follows the active tab, and existing imported subtitles are not silently overwritten. Check missing language tracks, no captions, page navigation during fetching and blocked YouTube caption requests. Verify that none of these cases fabricates a transcript.
6. With a sample YouTube video already open, test timestamp navigation5. With a sample YouTube video already open, test timestamp navigation, two repetitions, manual pause/seek cancellation and switching playback speed from 1× to 0.75× and 1.5× **while playing**. Confirm the speed does not reset the current loop.

## Netflix (experimental; not part of CI)

1. Use content and subtitles you have permission to process. Open the Netflix watch page, start playback, choose the target language in **建立教材**, then click **一鍵取得目前影片字幕**. Verify the returned cue count, source video ID, target language, cue times and title before running the local Agent. No file upload should be required when Netflix exposes a readable track.
2. Test English/Japanese/Korean subtitles where available, temporary subtitle-track selection/restoration, a player with no track, a track whose document is not readable, and navigation to another episode during fetching. Check that Chrome grants Netflix delivery-domain permissions after extension updates. Test blocked network/expired signed URL and denied permission: show an actionable error instead of raw `Failed to fetch` or a partial transcript. Confirm no incomplete or wrong-video transcript enters generation.
3. Open the matching Netflix /watch/ video and diagnose the player. Confirm failure is reported when the undocumented API is unavailable.
   - Click **開啟／切換到影片** while that video is already open: the existing tab should be selected and no new tab created.
   - Open two tabs with the same watch ID. Select one in the current window and confirm diagnose/seek/rate/loop target **that** tab, not the first result from Chrome's tab list.
   - With duplicate tabs active in different windows and neither selected in the current window, the extension should refuse ambiguous commands and ask you to select the intended tab; it must not close or open additional tabs.
   - If the extension is installed after the tab is already open, reload the existing tab before checking the player.
4. Test explicit seek, loop and playback speeds 0.75×, 1× and 1.5×. Confirm the UI never claims an unsupported speed succeeded.
5. During a loop, manually pause/seek and confirm it stops. Navigate away and confirm the loop timer stops. Test with netflix-shortcut-override enabled if both extensions may be installed.
6. If Netflix overrides playbackRate or changes its player internals, document and handle the error; do not scrape protected streams or force compatibility by bypassing playback protections.

## Native Host / Agent / publishing

1. On macOS, Windows and Linux, extract each matching OS Host ZIP; verify `dist/native-host.mjs`, `scripts/install-host.mjs` and its platform helpers. Load the extension into Chrome and Edge, install the Host for the **current extension ID**, then check Host/CLI diagnostics.
   - Confirm Chrome and Edge have separate manifest/registry locations. Changing extension ID must require registration of the new ID. A same-version older Host lacking `agentMode: "imported-only"` must show an update prompt and block generation/import; replacing the Host clears this gate.
   - On Windows, confirm per-user HKCU registration, PowerShell/.NET compilation of the native `.exe`, and raw Native Messaging health/duplicate protocol through that executable. Test a path containing spaces and non-ASCII characters, and an npm-installed Agent CLI shim. No user text should be passed through `cmd.exe`.
   - On Linux, verify XDG_CONFIG_HOME/XDG_DATA_HOME paths, `launch.sh` executable permissions, and zenity/kdialog folder selection. Try both GNOME and KDE where available; missing GUI pickers must fail with a useful message.
   - On macOS, confirm existing Host storage and Chrome manifest paths remain compatible.
   - Verify a missing Host shows the matching extension-ID installation command; a Release install uses `node scripts/install-host.mjs`, while source developers use `pnpm host:install`.
   - Confirm a fresh Host reports **zero** Agents. Copy the fixed Agent-configuration prompt, ask a trusted installed CLI for JSON, import it, and verify Host-generated ID and executable/argv preview. Model discovery must run only when the imported config provides real model-list arguments; do not imply account entitlement. Use one imported CLI with a verified optional profile environment variable to switch between two already authenticated account directories. No provider presets or built-in aliases may appear.
   - Reject nonexistent or outside-home profile folders, remove a Profile without deleting the CLI directory, and test unavailable model discovery and the custom model ID fallback. A prior built-in selection must clear on upgrade, and queued/waiting/failed historical built-in jobs must remain visible but show an explicit cannot-resume message. Completed historical documents must still open.
2. Test one short generation with a separately authenticated CLI, then interrupt a longer synthetic task and resume from its saved chapter checkpoint.
3. Generate an identical transcript with changed title/URL tracking parameters. Confirm duplicate preflight shows the original and requires explicit new-version confirmation without overwriting previous data.
4. Select a local folder via each OS picker and verify JSON/Markdown are written there while checkpoints remain in the canonical library; cancel the picker and confirm no arbitrary directory is added.
5. On macOS only, use a dedicated Google test account to authorize, switch accounts, upload and reopen the file. Revoke credentials or disconnect the network; verify duplicate checks fail closed and publication failure leaves the local lesson intact. Retry publication without rerunning the model.

Record browser/OS/Node/CLI versions, exact commit/tag and any experimental-platform limitations in the release notes. Never put the real account, token or protected transcript into CI logs or a public issue.
