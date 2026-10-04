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

`pnpm test` uses `node --import tsx --test`, so it runs in sandboxes that deny `tsx`'s IPC socket. Tests cover V5 schema read/write, grounded scene selection, checkpoints and resume, duplicate tickets, grouped library entries, playback calibration, Host response validation, legacy-data isolation, publication and backup retry behavior. The Host smoke test sends real framed Native Messaging requests to a built Host using a temporary home directory. It checks protocol version 6, the Pi provider catalog, V5 duplicates, and that old files are neither read nor deleted.

Inspect the four release ZIPs and `SHA256SUMS` after packaging: one Chromium extension and macOS, Windows, Linux Host packages. Cross-platform script and protocol tests run on the current host, but a package built here does not prove that another OS installer or GUI picker works there.

## Custom content UI acceptance

Run `pnpm --filter @immersive/extension test:redesign-ui` with Google Chrome installed. The script starts a temporary Vite server and an isolated headless Chrome profile, operates the actual App and background controller at 320/360/480px in Light/Dark, and writes screenshots plus evidence JSON to a temporary directory. Browser APIs and Host responses are development fixtures. This verifies UI interactions, not live Pi, video-platform or Drive acceptance.

Run `pnpm --filter @immersive/extension test:ux-layout-ui` for the three-step workflow, virtual subtitle editing, conflict recovery, IndexedDB drafts, Prompt templates, Sheet width and focus, and fixed Footer bounds. It covers 320/417/640/900px in Light/Dark at 560px height, plus 320/900px at 320px height with reduced-motion.

See [the current CLL UX Layout implementation record](cll-ux-layout-implementation.md) for phased commits, the spec comparison and live acceptance boundaries. The [earlier five-stage record](core-redesign-implementation.md) is historical.

## Host installer entry points and OS coverage

Run `node --test scripts/host-entrypoints.test.mjs apps/local-host/scripts/native-host-platform.test.mjs` to verify the displayed root command, missing-build guidance, browser selection, preserved data, and the macOS/Linux/Windows registration strategies. These use isolated homes; Windows compiler and registry calls are injected fixtures. Unix launcher tests execute Node through paths containing spaces and apostrophes. They do not replace execution on Windows or Linux.

CI installs via `node scripts/install-host.mjs` on Linux, Windows and macOS runners, then exercises the production Native Messaging launcher. Windows uses its real compiled `.exe`, while macOS/Linux use the shell launcher. A local macOS pass does not mean these remote jobs have run; inspect their results after pushing.

Run `pnpm --filter @immersive/extension test:host-uninstall-ui` after building the Host to verify the compact uninstall UI at 320/400/900px in Light/Dark. It clicks Copy, executes the copied Chrome/Edge/Chromium commands against production Hosts in temporary macOS/Linux homes, and checks removal, preserved lesson/sign-in fixtures and repeat execution. Windows registration cannot be isolated by HOME, so command execution there is left to the Windows CI job. Browser APIs use the development fixture.

The source UI defaults to project instructions and labels the command directory explicitly. Test Chrome/Edge/Chromium command flags, Windows PowerShell/.NET guidance and Linux folder-picker requirements. Package commands run from the extracted Host ZIP; the same root install/uninstall entry points are also available in the project after building.

## Side Panel and V5 lifecycle

1. Load `apps/extension/dist` into a clean Chromium profile and register the matching Native Host for that extension ID. Check that Settings reports connected. Try an older Host or a health response without protocol version 6; the panel should show update guidance and disable generation. The old Host should be labeled as requiring an update, with localized instructions to reinstall and reload. Check both package and project installation methods: their command roots must differ, copied commands must use the current extension ID and selected browser, and project updates must not show a release-download button.
2. Use a synthetic timed SRT/VTT transcript with at least two contextual exchanges. Create a V5 lesson. Verify the duplicate check, progress, original cue text/times, translations, pronunciation, focus items, and examples.
3. Start a longer synthetic generation, close the Side Panel, reopen Library, and verify the task remains visible. Interrupt the Host or Agent, then resume from the saved scene checkpoint. Completed scene IDs and content must remain unchanged.
4. Inspect `~/Documents/Immersive Learning/data-v5/jobs/` and `videos/`. Put a V3 file in the old parent folder before running: it must remain untouched and invisible in V5 Library. Search and expand video groups, open the reader from Library, and return to Library. Verify Create and Library share the fixed main navigation; Settings and Activity open from the fixed Header.
5. Save sentence and scene timing corrections. Reopen the lesson and confirm overrides persist while original cue timestamps remain unchanged. Check loop stop, repeat, speed, and tab selection on a supported video.
6. Choose a publication folder. Force a local publish failure and retry from Library without running the Agent again. For a dedicated Drive test account, force upload failure after local completion, retry backup, and verify the canonical local document and existing Drive files were not overwritten. Disconnect or revoke Drive access and verify remote duplicate checks fail visibly.
7. Switch among the five interface locales and system/light/dark appearance. Check settings persistence and semantic theme colors after reopening the panel.

## Video site acceptance

- **YouTube:** Fetch a readable caption track from an active watch tab. Verify exact video identity, language, cue times, title and URL. Test no-track, wrong-language, blocked request, page navigation during fetch, duplicate tabs, timestamp navigation, pause/seek cancellation and playback speed while looping.
- **Netflix (experimental):** Use content and subtitles you may process. Test readable and missing tracks, temporary selection/restoration, expired signed URLs, denied permissions, episode navigation during fetch, duplicate watch tabs, loop and speed controls. If its undocumented player API is unavailable, show a useful failure without fabricating subtitles or controlling a different tab.

Record exact commit, Extension/Host build, browser/OS/Node versions and Agent configuration for manual acceptance. Do not put real account data, tokens or protected transcripts in logs or issues.
