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

Inspect the seven release ZIPs and `SHA256SUMS` after packaging: one Chromium extension plus macOS, Windows and Linux setup packages for arm64/x64. Set explicit `CLL_*_EXTENSION_ID` values before packaging; use `CLL_SETUP_MODE=local` for preview packages. Cross-platform script and protocol tests run on the current host, but a package built here does not prove that another OS installer or GUI picker works there.

## Custom content UI acceptance

Run `pnpm --filter @contextual/extension test:redesign-ui` with Google Chrome installed. The script starts a temporary Vite server and an isolated headless Chrome profile, operates the actual App and background controller at 320/360/480px in Light/Dark, and writes screenshots plus evidence JSON to a temporary directory. Browser APIs and Host responses are development fixtures. This verifies UI interactions, not live Pi, video-platform or Drive acceptance.

Run `pnpm --filter @contextual/extension test:ux-layout-ui` for the three-step workflow, virtual subtitle editing, conflict recovery, IndexedDB drafts, Prompt templates, Sheet width and focus, and fixed Footer bounds. It covers 320/417/640/900px in Light/Dark at 560px height, plus 320/900px at 320px height with reduced-motion.

Run `pnpm --filter @contextual/extension test:dialog-ui` for fixed Sheet headers across Settings subpages and Activity details, subtitle editor focus restoration after Done, Close and Escape, fallback focus when an edited cue leaves the search results, long template titles, and Dialog content/overlay animations. It covers 320/640px in Light/Dark with both normal and reduced motion, including scrolling at 320px height, using the development video/Host fixture. Screenshots are written to a temporary directory.

See [the current CLL UX Layout implementation record](cll-ux-layout-implementation.md) for phased commits, the spec comparison and live acceptance boundaries. The [earlier five-stage record](core-redesign-implementation.md) is historical.

## Host installer entry points and OS coverage

Run `node --test scripts/host-entrypoints.test.mjs apps/local-host/scripts/native-host-platform.test.mjs` to verify the displayed root command, missing-build guidance, browser selection, preserved data, and the macOS/Linux/Windows registration strategies. These use isolated homes; Windows compiler and registry calls are injected fixtures. Unix launcher tests execute Node through paths containing spaces and apostrophes. They do not replace execution on Windows or Linux.

CI installs via `node scripts/install-host.mjs` on Linux, Windows and macOS runners, then exercises the production Native Messaging launcher. Windows uses its real compiled `.exe`, while macOS/Linux use the shell launcher. A local macOS pass does not mean these remote jobs have run; inspect their results after pushing.

Run `pnpm --filter @contextual/extension test:host-uninstall-ui` for the compact Settings guidance at 320/400/900px in Light/Dark. It verifies that developer commands are absent and fresh connection checks detect uninstall/reinstall and clear recovered errors. Browser APIs use the development fixture.

Run `node --test scripts/host-setup.test.mjs` for authenticated loopback setup requests, bundled runtime paths, fixed release identities, Windows precompiled launchers and per-browser manifests, and preserved data. Run `node apps/extension/scripts/host-setup-acceptance.mjs PATH_TO_SETUP_ZIP` on the matching OS to extract the actual package and drive its real setup UI, install/update Chrome and Edge, run production framed Host smoke checks through the installed launcher, delete the extracted runtime, uninstall and verify preserved data. Windows requires a disposable CI runner because HOME does not isolate HKCU. Native OS launcher double-click and OS signing prompts require platform acceptance separately.

## Side Panel and V5 lifecycle

1. Load `apps/extension/dist` into a clean Chromium profile and register the matching Native Host for that extension ID. Check that Settings reports connected. Try an older Host or a health response without protocol version 6; the panel should show update guidance and disable generation. The old Host should be labeled as requiring an update, with localized instructions to reinstall and reload. Check that local builds explain the local test ZIP without an online download link, and release builds link to the matching installer download. No repo, Node.js, ID or shell-command fields belong in ordinary extension Settings.
2. Use a synthetic timed SRT/VTT transcript with at least two contextual exchanges. Create a V5 lesson. Verify the duplicate check, progress, original cue text/times, translations, pronunciation, focus items, and examples.
3. Start a longer synthetic generation, close the Side Panel, reopen Library, and verify the task remains visible. Interrupt the Host or Agent, then resume from the saved scene checkpoint. Completed scene IDs and content must remain unchanged.
4. Inspect `~/Documents/Contextual Language Learning/data-v5/jobs/` and `videos/`. Put a V3 file in the old parent folder before running: it must remain untouched and invisible in V5 Library. Search and expand video groups, open the reader from Library, and return to Library. Verify Create and Library share the fixed main navigation; Settings and Activity open from the fixed Header.
5. Save sentence and scene timing corrections. Reopen the lesson and confirm overrides persist while original cue timestamps remain unchanged. Check loop stop, repeat, speed, and tab selection on a supported video.
6. Choose a publication folder. Force a local publish failure and retry from Library without running the Agent again. For a dedicated Drive test account, force upload failure after local completion, retry backup, and verify the canonical local document and existing Drive files were not overwritten. Disconnect or revoke Drive access and verify remote duplicate checks fail visibly.
7. Switch among the five interface locales and system/light/dark appearance. Check settings persistence and semantic theme colors after reopening the panel.

## Video site acceptance

Run `pnpm --filter @contextual/extension test:subtitle-timing-ui` for manual YouTube subtitle timing correction: offset/drift previews, exact before/after listening, saved settings/results across focus and reload, atomic application, restore and keyboard focus. The test asserts that automatic audio analysis is absent. Video/Host services use fixtures. See [subtitle timing correction](subtitle-timing-correction.md) for usage and validation boundaries.

- **YouTube:** Fetch a readable caption track from an active watch tab. Verify exact video identity, language, cue times, title and URL. Test no-track, wrong-language, blocked request, page navigation during fetch, duplicate tabs, timestamp navigation, pause/seek cancellation and playback speed while looping.
- **Netflix (experimental):** Use content and subtitles you may process. Test readable and missing tracks, temporary selection/restoration, expired signed URLs, denied permissions, episode navigation during fetch, duplicate watch tabs, loop and speed controls. If its undocumented player API is unavailable, show a useful failure without fabricating subtitles or controlling a different tab.

Record exact commit, Extension/Host build, browser/OS/Node versions and Agent configuration for manual acceptance. Do not put real account data, tokens or protected transcripts in logs or issues.
