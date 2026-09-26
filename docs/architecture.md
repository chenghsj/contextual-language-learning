# Extensible platform and agent architecture

The source transcript, learning profile, generated sections and document renderer are independent of the originating video provider or CLI. **Adding a provider is an engineering change, not a way to bypass a site's access controls.**

## Video providers: Adapter + Registry + capability-based UI

The reader uses apps/extension/src/video/index.ts to resolve the correct VideoAdapter by **validated video URL identity**, not by a generic hostname suffix. Adapter IDs persist with the document (source.platform). All timestamps and section cue references use milliseconds.

Each adapter may implement these optional capabilities:

| Capability | Reader behavior |
| --- | --- |
| getVideoId | Recognize video and match the already-open Chrome tab |
| timestampLink | Open a supported timed video URL |
| diagnose | Check whether playback control is currently available |
| seek | Position an existing video at a timestamp, if available and permitted |
| setPlaybackRate | Set playback speed for an existing player (0.5×–2×) on explicit user action |
| loop / stopLoop | User-triggered repeat/stop for a cue, if available and permitted |

The reader never branches on "youtube", "netflix" or another platform ID. It renders available actions from the adapter capabilities. Playback speed preferences belong to the local reader, not to the generated document, and changing the selected speed does not control the player until the user applies it. Without playback capabilities, a subtitle file still generates a document and its time cues can be copied.

Existing platform modules:

- apps/extension/src/video/youtube.ts — timestamp links, opt-in looping.
- apps/extension/src/video/netflix.ts — opt-in diagnose, seek and loop through its **undocumented** internal player API, which may stop working.
- apps/extension/src/video/tab.ts — shared tab resolution by exact video ID and messaging. A matching active tab in the current window takes precedence; ambiguous duplicate tabs fail rather than controlling an arbitrary player. The reader's open/switch action reuses an existing matching video before opening another tab.
- apps/extension/src/content/* — platform-specific browser scripts, isolated from the reader.

**To add HBO Max, Apple TV+ or another service:** implement an adapter (even if its only capability is identification and opening the video), register it in video/index.ts, add its exact domains to the Chrome extension manifest and, **only when necessary**, add content scripts and build entries in Vite. Add tests for URL matching, capabilities and playback failure. Browser permissions and content-script injection require manifest/build registration; the Adapter registry does not grant arbitrary sites runtime access.

Do not assume every video site exposes a playback API or a permitted subtitle API. Subtitle ingestion stays separately pluggable: licensed/user-supplied SRT/VTT/text is the supported baseline. A new provider can support reading documents without any seek/loop or subtitle extraction.

## Agents: strict bring-your-own CLI registry + legacy adapters

New users have **no preselected provider**. The Side Panel accepts one
user-supplied JSON object describing the executable, argv, stdin/argument
prompt transport, single JSON response/file transport, optional model flag
and optional isolated account-directory environment variable. A fixed prompt
helps users ask their own CLI for this JSON; the extension does not call a
provider to manufacture its own setup. The imported object must not contain
an ID, unknown keys or credentials. The Host generates a unique ID on import
and retains it for edits. Strict shared Zod validation enforces transport and
placeholder rules before the Host can persist the definition.

`apps/local-host/src/agents/custom.ts` resolves only validated executable
names/absolute paths, runs direct argv through `spawn(..., { shell: false })`,
uses bounded temporary workspace/output, and parses the single JSON result.
An explicit user-initiated test may contact a paid provider. A valid JSON
test does not establish complete V3 lesson-schema compatibility; the
generation pipeline continues to validate model content against the
existing document schemas.

Definitions and optional named account-environment directory references
are stored in separate local Host registries, **never** with credentials.
The default environment is the CLI's existing login. Model selection is
keyed by Agent and environment. Removing a custom Agent first checks **all**
persisted jobs; queued, running, waiting and failed/resumable jobs block
removal. Only Host-owned Agent/profile records and the extension's model
preferences are removed; the CLI executable, directory, login, lessons and
job history remain untouched.

The historical `apps/local-host/src/agents.ts` built-in adapter registry
is retained solely for backward compatibility with saved jobs/documents
and existing users. The new-user UI lists user-imported definitions rather
than offering hardcoded Claude/Codex/AGY choices. A Native Host health
request includes installed status, and independent Host setup/status UI
handles registration/version compatibility across macOS, Windows and Linux
and Chrome, Edge and Chromium. Adding Agents never changes Host
registration or requires reinstalling it.

No plugin code is loaded dynamically from a webpage, subtitle or model
response. Imported JSON is configuration data, not executable JavaScript.

## Native Host OS Strategy (no inheritance hierarchy)

apps/local-host/src/platform/paths.ts supplies per-OS user configuration directories. apps/local-host/src/platform/folder-picker.ts dispatches to one OS-specific native folder-picker strategy: macOS osascript, Windows PowerShell WinForms, or Linux zenity/kdialog. All results pass through the same directory realpath, writability and allowed-folder checks in storage/folders.ts.

apps/local-host/scripts/native-host-platform.mjs selects the per-OS installer strategy: POSIX executable shell launcher and browser-specific manifest on macOS/Linux; a locally compiled Windows .exe binary stdio proxy plus HKCU browser registry entry on Windows. The browser selector chooses Chrome, Edge or Chromium. Chrome Native Messaging requires an executable on Windows; an npm .cmd shim is not used as the Host. Windows Agent npm shims are resolved to adjacent JS entrypoints and invoked directly with Node rather than forwarding subtitle text through cmd.exe.

This is a small **Strategy + Factory** boundary: a single platform lookup at the Host/installer entry point and shared logic for the remainder of the system. There is no need for abstract classes or a separate code path in React or the learning pipeline. Add another OS/browser by extending this boundary and its cross-platform tests; do not duplicate document generation.

## Stable document contract

A document refers to source.platform as a provider identifier. The platform can be unknown to an older reader; the fallback still displays source text, metadata and times without attempting player control. All agents return the same SectionContentSchema. Existing learning documents do not need to be regenerated when adapters are added.

## Design constraints

- Do not hardcode platform comparisons in React App.tsx or the learning engine.
- Never let subtitle content dictate executable paths, shell commands, host permissions or player actions.
- One source video, one tab; navigation, manual controls and unsupported APIs must stop looping rather than forcibly resume playback.
- Permissions for a new service are reviewed per provider, not granted as a blanket <all_urls> host permission.
- Netflix control is experimental and user initiated, not an official API or a guarantee of future compatibility.

## Generation Pipeline + Job State Machine

The generation pipeline in apps/local-host/src/generation/pipeline.ts owns six explicit stages: plan (subtitle cue chunking), generate (injected SectionGenerator/Agent Adapter), validate (Zod and configured learning-load limits), checkpoint (persist each successful LearningSection), assemble (stable version-1 document), and persist (document repository + Markdown export). A failed chapter never overwrites earlier validated checkpoints. Resuming uses the original saved request snapshot and preserved section IDs, not whatever settings are currently selected in the Side Panel.

The JobManager in apps/local-host/src/jobs/manager.ts owns the state machine (queued → running → completed | failed | waiting | cancelled). Failed/waiting jobs may return to queued, but completed and cancelled jobs are terminal. The Host records the generating process PID so another live Host's running job is not misclassified as interrupted. Closing the Native Messaging port aborts active execution and leaves durable checkpoints; the next job-list/resume operation reconciles orphaned running jobs to waiting. A separate background daemon is **not** implemented.

## Storage Ports & Repositories

The storage/ports.ts module defines JobRepository, DocumentRepository and ProgressRepository contracts. The initial file adapters use atomic temporary-file writes and fixed UUID-derived paths. Canonical document JSON and optional Markdown are separate from checkpoint files (jobs/) and private study progress (progress/). All persisted data is Zod-validated when read; malformed checkpoints fail visibly instead of silently restarting.

The pipeline depends on these interfaces, not on fs, Chrome or Google Drive. Future SQLite adapters can implement the same ports. Google Drive is better introduced as a separate DocumentPublisher rather than replacing durable local storage, so upload failures cannot erase the generated document.

**Operational boundary:** storage has a per-process update lock, but it is not a fully transactional cross-process database. A future daemon must own single-writer scheduling/locking before multi-window or cross-device concurrent edits are supported.

## Document versioning and Native Messaging

Version-1 documents preserve the existing JSON structure. readLearningDocument() dispatches by explicit schemaVersion and rejects unsupported versions instead of dropping fields. Large Host responses are encoded as ordered, bounded base64 document chunks; the reader reassembles, UTF-8 decodes and validates the complete schema.

## Destination Publisher and duplicate preflight

The canonical local DocumentRepository is authoritative for job recovery. GenerationRequest includes an immutable Destination snapshot: a selected local directory or a Google account ID. DestinationPublisher writes JSON and Markdown copies after canonical material is saved; JobSummary records publication separately from generation. A publication failure does not invalidate the completed job. Publish Again retries the saved destination without invoking the Agent.

The Native Host selects the macOS, Windows or Linux folder picker and per-user allowlist via an OS-specific Strategy. Google Desktop OAuth with PKCE, Keychain-backed refresh tokens and the Drive API remain macOS-only and experimental. The Chrome extension does not receive refresh tokens. Drive uses the limited drive.file scope and appProperties on app-created documents for duplicate detection and repeat-safe publishing. An authentication or network failure aborts the preflight instead of reporting an empty Drive.

Duplicate matching combines canonical local documents, incomplete jobs and visible app-created Drive files. A short-lived preflight ticket binds the generation request. The Host rejects unconfirmed regeneration, altered requests, and matches that appeared after the preflight. Each regenerated version has a fresh document UUID. Existing content and learning progress remain unchanged.
