# Manual integration test plan

Automated CI covers TypeScript, unit tests, extension packaging and Native Messaging smoke checks. It cannot prove compatibility with a live Netflix player, Google account or signed-in CLI Agent. Use *synthetic* subtitles and a dedicated test account.

## Extension / Chromium

1. Run pnpm install, pnpm test, pnpm build and pnpm package:release.
2. Extract the Chromium ZIP and confirm manifest.json is at its root. Load that folder through chrome://extensions.
3. Open the Side Panel and import a synthetic SRT/VTT with two timed cues; verify original text and timestamps are unchanged.
4. Test English/Japanese/Korean profiles, instruction-language preferences, document exports and reopening a saved document.
5. With a sample YouTube video already open, test timestamp navigation, two repetitions, manual pause/seek cancellation and switching playback speed from 1× to 0.75× and 1.5× **while playing**. Confirm the speed does not reset the current loop.

## Netflix (experimental; not part of CI)

1. Use content you are licensed to watch, and separately supply subtitles you are authorized to process.
2. Open the matching Netflix /watch/ video and diagnose the player. Confirm failure is reported when the undocumented API is unavailable.
3. Test explicit seek, loop and playback speeds 0.75×, 1× and 1.5×. Confirm the UI never claims an unsupported speed succeeded.
4. During a loop, manually pause/seek and confirm it stops. Navigate away and confirm the loop timer stops. Test with netflix-shortcut-override enabled if both extensions may be installed.
5. If Netflix overrides playbackRate or changes its player internals, document and handle the error; do not scrape protected streams or force compatibility by bypassing playback protections.

## Native Host / Agent / publishing

1. Extract the macOS Host ZIP, run its installer with the **currently loaded extension ID**, and verify Host/CLI diagnostics in the Side Panel.
2. Test one short generation with a separately authenticated CLI, then interrupt a longer synthetic task and resume from its saved chapter checkpoint.
3. Generate an identical transcript with changed title/URL tracking parameters. Confirm duplicate preflight shows the original and requires explicit new-version confirmation without overwriting previous data.
4. Select a local folder via the macOS picker and verify JSON/Markdown are written there while checkpoints remain in the canonical library.
5. Use a dedicated Google test account to authorize, switch accounts, upload and reopen the file. Revoke credentials or disconnect the network; verify duplicate checks fail closed and publication failure leaves the local lesson intact. Retry publication without rerunning the model.

Record browser/OS/Node/CLI versions, exact commit/tag and any experimental-platform limitations in the release notes. Never put the real account, token or protected transcript into CI logs or a public issue.
