# Testing the V5 flow

Automated checks validate contracts and synthetic flows. Live YouTube, Netflix, Google Drive and Pi provider authentication and generation still requires manual browser testing.

## Automated checks

The standard test command includes DOM interaction checks for language search and keyboard selection, Popover dismissal and focus restoration, Tabs navigation, Accordion expansion, controlled Switch state, and Sonner replacement/dismissal. These checks use synthetic content and do not replace visual acceptance in the installed Side Panel. Shared shadcn wrapper checks protect the original component styles.

From the repository root, run:

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
node apps/local-host/scripts/smoke-host.mjs
pnpm package:release
```

`pnpm test` uses `node --import tsx --test`, so it runs in sandboxes that deny `tsx`'s IPC socket. Tests cover V5 schema read/write, grounded scene selection, checkpoints and resume, duplicate tickets, grouped library entries, playback calibration, Host response validation, legacy-data isolation, publication and backup retry behavior. The Host smoke test sends real framed Native Messaging requests to a built Host using a temporary home directory. It checks protocol version 4, the Pi provider catalog, V5 duplicates, and that old files are neither read nor deleted.

Inspect the four release ZIPs and `SHA256SUMS` after packaging: one Chromium extension and macOS, Windows, Linux Host packages. Cross-platform script and protocol tests run on the current host, but a package built here does not prove that another OS installer or GUI picker works there.

## Side Panel and V5 lifecycle

1. Load `apps/extension/dist` into a clean Chromium profile and register the matching Native Host for that extension ID. Check that Settings reports connected. Try an older Host or a health response without protocol version 4; the panel should show update guidance and disable generation. The old Host should be labeled as requiring an update, with localized instructions to reinstall and reload. Check both package and project installation methods: their command roots must differ, copied commands must use the current extension ID and selected browser, and project updates must not show a release-download button.
2. Use a synthetic timed SRT/VTT transcript with at least two contextual exchanges. Create a V5 lesson. Verify the duplicate check, progress, original cue text/times, translations, pronunciation, focus items, and examples.
3. Start a longer synthetic generation, close the Side Panel, reopen Library, and verify the task remains visible. Interrupt the Host or Agent, then resume from the saved scene checkpoint. Completed scene IDs and content must remain unchanged.
4. Inspect `~/Documents/Immersive Learning/data-v5/jobs/` and `videos/`. Put a V3 file in the old parent folder before running: it must remain untouched and invisible in V5 Library. Search and expand video groups, open the reader from Library, and return to Library. Verify Create, Library and Settings are the only top-level tabs.
5. Save sentence and scene timing corrections. Reopen the lesson and confirm overrides persist while original cue timestamps remain unchanged. Check loop stop, repeat, speed, and tab selection on a supported video.
6. Choose a publication folder. Force a local publish failure and retry from Library without running the Agent again. For a dedicated Drive test account, force upload failure after local completion, retry backup, and verify the canonical local document and existing Drive files were not overwritten. Disconnect or revoke Drive access and verify remote duplicate checks fail visibly.
7. Switch among the five interface locales and system/light/dark appearance. Check settings persistence and semantic theme colors after reopening the panel.

## Video site acceptance

- **YouTube:** Fetch a readable caption track from an active watch tab. Verify exact video identity, language, cue times, title and URL. Test no-track, wrong-language, blocked request, page navigation during fetch, duplicate tabs, timestamp navigation, pause/seek cancellation and playback speed while looping.
- **Netflix (experimental):** Use content and subtitles you may process. Test readable and missing tracks, temporary selection/restoration, expired signed URLs, denied permissions, episode navigation during fetch, duplicate watch tabs, loop and speed controls. If its undocumented player API is unavailable, show a useful failure without fabricating subtitles or controlling a different tab.

Record exact commit, Extension/Host build, browser/OS/Node versions and Agent configuration for manual acceptance. Do not put real account data, tokens or protected transcripts in logs or issues.
