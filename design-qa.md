# Reader single-flow QA

Date: 2026-10-15. Checkout: `codex/core-redesign`, HEAD `21969bc` with existing local changes.

## Source of truth

- Approved Markdown content/interaction layout: `docs/reader-single-flow-layout.md` (records the user-approved structure in this conversation).
- Original user screenshots supply the existing visual language. The subsequent Markdown superseded the generated concepts; there is no selected raster mock requiring pixel-identical reproduction.
- Implementation: `apps/extension/src/components/sentence-dialogue.tsx`.

## Rendered evidence

In-app browser at `http://127.0.0.1:5196/dev/reader-preview.html` with synthetic lesson data and a simulated video adapter.

- `docs/quality/reader-single-flow/default-555.jpg`: normal Japanese reading, 555 x 964 CSS pixels.
- `docs/quality/reader-single-flow/selected-555.jpg`: Japanese source selection, lookup and whole-sentence meaning, 555 x 964 CSS pixels.
- `docs/quality/reader-single-flow/comparison-555.jpg`: chunk comparison expanded.
- `docs/quality/reader-single-flow/examples-555.jpg`: core explanation followed by expanded examples and example translation, 555 x 964 CSS pixels.

All accepted image files are browser screenshots. Images are inspected after saving. No source-image density normalization applies to the Markdown target. Screenshots use the browser's CSS-pixel rendering; no stretching or visual editing was applied.

## Checks and findings

- Typography: existing product font and ruby rendering retained; reading explanations use 14px body text and 12px subordinate headings. Japanese original remains 15px with existing ruby. Long source wraps at narrow widths.
- Layout: replaced enclosing source cards with horizontal separators. Lookup sits after complete source and before permanent whole-sentence content. Default and selected-state DOM measurements at widths 320, 390, 555 and 1280 found no viewport/source/lookup horizontal overflow. Persistent player remains available.
- Tokens: reused semantic background, muted surface, foreground, border and primary colors. No global palette or typography changes.
- Assets: existing Lucide Play/X icons and native text; no raster assets are required for this content interface.
- Content: whole meaning, context, core notes, extensions, complete chunk comparison, examples, translations and other occurrences retain their existing data sources. Empty entries remain omitted. Selecting a fragment does not filter full-sentence teaching content.
- Interaction: clicked original fragment, verified one lookup and unchanged complete reading, closed by keyboard and verified focus returns to original, expanded chunk comparison, opened examples and toggled an individual example's translation without closing the reading.
- Console: initial custom preview server had duplicate React instances. Restarting with a separate dependency cache and React/React DOM deduplication resolved the invalid-hook-call failure. No later application error was recorded in the inspected tab logs; the browser tooling itself reports an unrelated telemetry network error.

No actionable P0/P1/P2 issue was found within the checked light-theme preview states. Focused-region screenshot comparison against the old UI is not a fidelity requirement: the user explicitly approved restructuring. The selected screenshot shows source, lookup, whole meaning and comparison entry together; examples screenshot shows long teaching content and translation together.

## Comparison history

- Before implementation: collapsed whole/selected interpretation modes and global expand/collapse operations; full reading was replaced by fragment selection.
- First implementation: replaced mode state with an independent fragment lookup; permanent reading and optional sections retained. Source speech label was moved out of the shared source grid so it cannot widen the per-cue playback column.
- Preview repair: isolated React dependency cache and deduplication fixed an environment-only preview startup issue.
- Capture repair: an initial blank selected-state capture was rejected and replaced using the screenshot API after a fresh accessibility observation. Accepted screenshot inspected from disk.
- Follow-up: user requested icon-only read-aloud controls, with fragment read-aloud beside the source text. Source-group, fragment and complete-example read-aloud controls now use icons; the fragment icon moved into the original-text row. The focused system-speech regression, extension typecheck and build were rerun. Saved screenshots predate this small placement refinement and have no connected system-speech provider, so they do not validate the appearance of available speech controls.

## Validation boundary

Unit/integration checks use saved synthetic fixtures and mock adapters/Host streams. These do not prove installed-extension behavior, real YouTube/Netflix playback, actual Native Host audio output, dark-theme appearance, or screen-reader announcement quality. Older standalone acceptance scripts with retired disclosure assertions were not executed; the standardization script was updated and syntax-checked.

## Final result

passed

## Subsequent simplification

User requested removal of the separate chunk comparison section. Removed its accordion entry and localized label; fragment meanings and roles remain available by selecting each underlined original fragment. Updated the existing interaction regression and standardization script to reflect this contract. Earlier screenshots retain the historical comparison entry and are not evidence of this final removal. Close and speech icons now use the same 32px button width; the close hover background remains 24px.

## Remove redundant close action — 2026-10-16

User requested removing the fragment close button because selecting the same original fragment again already closes the lookup. Removed the button, its localized label and focus-return ref. Selecting another fragment still switches the lookup in place; selecting the current fragment again closes it with focus remaining on the original. Added this behavior to the existing localized hint. The fragment speech icon remains beside its original text.

All 19 focused reader checks passed, including selection switching, repeated-selection closing, unchanged complete reading, and mock native speech requests. Extension typecheck and build passed; the updated standardization acceptance script passed syntax checking. In-app browser verification at 390px confirmed opening and closing with Enter, with focus staying on the source fragment. Preview speech uses an opt-in mock provider and does not produce audio. Earlier close-button screenshots are historical.

## Restore source-group disclosure — 2026-10-18

Replaced the incorrectly added disclosure on the “Explanation notes” heading with disclosure owned by the complete source group. Groups start collapsed; clicking a source row or its range/arrow opens or closes the associated interpretation. Cross-cue sources share one control, and opening a group retains other open groups. The toolbar can expand or collapse all useful groups; a scene/document change resets disclosure. Fragment selection opens its group and toggles only the local lookup. Cue playback, source speech and interpretation content do not toggle disclosure. Core notes remain plain content inside the group.

Validation: 24 reader/presentation checks and 5 playback checks passed; the playback run used the test runner's force-exit option after its assertions. Project typecheck and extension build passed. Chrome preview acceptance passed at 320/480px, light/dark themes and same-cue/cross-cue fixtures (8 cases), covering Enter/Space, independent playback, fragment toggling, group/global disclosure and horizontal overflow. Artifacts are in `docs/quality/reader-group-disclosure/`. These use synthetic content and a simulated video adapter; the installed extension and real video were not reloaded or accepted here. This UI change does not recreate missing saved chunk data.

## Selection speech popup and fragment clicks — 2026-10-18

Reproduced a failed fragment close with the real shared selection popup: the fragment click handler canceled every mouse click while any selected text remained. It could not distinguish a retained explanation selection from text newly selected by dragging across the source. The reader now captures the selection range on pointer-down and compares it at click time. A normal click clears the retained selection and toggles interpretation; a new drag selection is preserved without toggling. The same distinction applies to source-row disclosure. Popup placement and speech controls are unchanged.

`reader-selection-interaction-acceptance.mjs` failed on the reported single-click symptom before the fix, then passed at 320/480px in light/dark themes (4 cases): one-click fragment closing/opening while the popup is visible, popup dismissal, and a real pointer drag across source text and its embedded fragment. Twenty existing reader checks, project typecheck and extension build passed. Browser checks use synthetic source and simulated speech/video, not an installed-extension or real audio acceptance.

## AI example grouping — 2026-10-16

Each expression now has a bordered section with a muted heading and 16px separation from adjacent expressions. Multiple saved dialogues within an expression use internal separators. Moved the complete-dialogue speech icon into each dialogue's situation row at the top right, keeping its scope on that dialogue. Per-line speech remains beside each line; translation stays at the bottom of its own dialogue.

The 19 focused reader tests, extension typecheck and build passed. In-app preview with the saved N3 draft confirmed grouped examples, per-dialogue translation, and activation of the relocated speech action using a mock provider. Screenshot: `docs/quality/reader-single-flow/ai-example-groups.jpg`. This verifies preview layout and mock interactions, not actual speech audio or the installed extension.

## Explanation typography — 2026-10-16

Normalized fragment original text and multiple-analysis source titles from 12px to 14px; extended explanation body from 13px to 14px. Whole meaning, fragment meaning/role and core explanations already use 14px. Section labels remain 12px. Browser computed styles confirmed 14px for the fragment original and meaning, with a 12px section label. Saved preview: `docs/quality/reader-single-flow/explanation-font-size.jpg`. All 19 focused checks, extension typecheck and build passed.
