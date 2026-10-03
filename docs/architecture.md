# Architecture and data contracts

The project has three runtime parts: the Chromium Side Panel and background worker, a per-user Native Messaging Host, and shared `@immersive/core` contracts. Video adapters identify supported URLs and expose optional playback capabilities. The Host embeds Pi SDK and owns provider credentials; the Extension only forwards transient login input and displays non-secret connection metadata.

## V5 lesson and job data

`packages/core/src/schema.ts` defines the only current lesson format, `schemaVersion: 5`. Each document keeps the original selected subtitle cues, the source and learning profile, contextual scenes with original cue IDs and times, translations, pronunciation segments, focus expressions, explanations, examples, and optional playback overrides. Overrides change playback windows without rewriting original cue timestamps. `packages/core/src/jobs.ts` defines `schemaVersion: 3` job snapshots: the original V5 generation request, candidate selection plan, completed contextual scenes, and status. It validates progress against those checkpoints when read. `packages/core/src/protocol-schema.ts` defines Native Messaging requests and response types; `native-messaging.ts` validates incoming responses and declares protocol version 6.

V5 deliberately has no V1/V2/V3/V4 migration. The Host's canonical V5 repository is `~/Documents/Immersive Learning/data-v5/`, with `jobs/` and grouped `videos/` below it. The Host does not scan, restore, or delete older development files in `~/Documents/Immersive Learning/`. Drive browsing, duplicate checks, and restore select only app-created files marked `immersiveSchemaVersion=5`; older Drive files remain in place. Existing CLI registry/login files remain untouched; old CLI jobs cannot execute under SDK provider semantics. A chosen publication folder receives a JSON/Markdown copy after the canonical V5 document is saved; publication or backup failure does not erase completed content.

## Analysis range and custom documents

Timed input supports full, first-half, second-half and custom ranges. Requests store the selected milliseconds and duration provenance, and retain the original overlapping cue IDs/text/times. Untimed input permits full content only. Existing checkpoints retain their original meaning.

`packages/core/src/custom.ts` defines independent `custom-v1` requests, documents and job checkpoints; `storage/custom.ts` saves them under `~/Documents/Immersive Learning/custom-v1/`. Custom output is Markdown, with separate Pi system prompts and validation from standard V5 JSON. `generation/custom-pipeline.ts` freezes a conservative byte-based segment/merge plan, executes isolated short sessions, checkpoints each result, and recursively integrates long input. New jobs pin workflow/prompt/schema, input fingerprint, actual provider/model and per-call available usage. Resume refuses changed versions/models. Final output survives save failure and can be saved again without re-running the model.

`storage/custom-backup.ts` serializes backup scheduling with uploads, records actual backup state/revision and retries transient upload failures. Drive custom files are marked `custom-v1`, with Markdown uploaded before checksum-linked metadata. Partial upload retries reuse matching bytes; conflicting files are preserved. Restore verifies both checksums and document identity. Local deletion removes the canonical document and keeps Drive backups/job history; history clearing keeps documents. Explicitly published/exported copies are separate files.

The custom Viewer blocks raw HTML, executable links and remote images. Prompt reuse returns to Create; regeneration pins the saved input/model and creates a new document ID with a previous-version reference. Library and Activity distinguish standard/custom content. Usage omitted by a provider stays unknown; catalog cost estimates are not subscription quota or actual bills.

## Extension flow

The Side Panel fixes Header actions and the Create/Library navigation above one main scrolling area. Settings and Activity open from Header actions. The V5 reader is a Library detail view. Create has three steps: source/subtitles including analysis range, content settings with standard/custom Tabs, and confirmation with request-specific provider/model/reasoning and storage overrides. The Footer stays fixed while the form scrolls. Settings and Activity share one modal Sheet capped at 640px; internal detail navigation preserves the underlying view and focus. Subtitle working copies, originals and per-video drafts persist in IndexedDB. Duplicate preflight and generation share a frozen request, and submission remains locked until the Host acknowledges durable admission. Library shows resumable tasks plus lessons grouped by video, including local and Drive copies. Settings owns Host connection, Agent setup, interface language, and appearance. Theme styling uses shared semantic light/dark tokens.

The background worker (`apps/extension/src/native/generation-controller.ts`) owns the long-lived Native Messaging connection for every Host operation, including authentication, library reads, generation, publication, backups, and calibration. Closing the Side Panel does not close an active Agent job. The worker validates Host responses and relays interruption errors; the next panel reads durable job summaries. Unexpected disconnection permits three reconnect attempts after 1/2/4 seconds, sending only health and status queries; generation and other side effects are never replayed. Incompatible Hosts stop reconnecting. Short operations use `native/host-client.ts`. The health handshake requires matching extension package version, Pi SDK mode, and protocol version 6. An older Host shows installation guidance and generation remains disabled.

The reader keeps presentation of focus items in `components/scene-focus-items.tsx`; cue tracking, loop windows, playback range calculation, and calibration validation are in `video/` modules. It requests player actions only through a capability-based `VideoAdapter`. YouTube and Netflix adapters have separate URL, subtitle, and playback code; unsupported sources remain readable without player control. Netflix's internal player bridge is experimental. Adapter registration alone does not grant browser permissions.

## Native Host flow

`apps/local-host/src/index.ts` owns binary framing, process lifetime, and the final response writer. `host/dispatcher.ts` validates and routes requests using injected storage, JobManager, reply function, and version. `host/agents.ts`, `host/drive.ts`, `host/lessons.ts`, `host/generation.ts`, and `host/publication.ts` own their respective operations. The generation handler keeps a short-lived duplicate-check ticket bound to the exact request. It checks again before starting so a new duplicate cannot be silently overwritten.

`generation/scene-pipeline.ts` chunks subtitles, selects grounded scene candidates, validates each generated scene, writes a checkpoint, then assembles and saves the V5 document. A failed scene leaves prior checkpoints intact. `jobs/manager.ts` controls queued, running, waiting, failed, completed, and cancelled transitions. Native Messaging interruption stops active execution and a later list/resume reconciles orphaned jobs. The dispatcher shares one FIFO `jobs/queue.ts` across standard and custom generation. Admission is serialized separately from execution, preserving new snapshots while earlier work runs. Failed or cancelled work releases the worker to the next job. The Pi boundary retries only explicit safe rejections at most twice with backoff; credentials, quota and unknown-result failures require manual recovery. No daemon is installed.

`storage/ports.ts` has job and document repositories. File adapters use UUID-derived paths and atomic writes. A complete canonical document is saved before publication and optional Drive backup. Publication and backup have separate status and retry actions. Calibrated playback updates sync only a matching app-published copy; independently edited exports are left untouched. The Host is a single-writer process boundary, not a cross-process transactional database.

## Platform and security boundaries

The Host embeds Pi SDK with an explicit resource loader, no tools and an in-memory Session per stage. Credentials live in the product-owned pi/auth.json; CLI jobs are retained but cannot execute with SDK semantics. Folder pickers and Host installers retain their platform implementations.

A new video service needs an exact URL adapter, capability/failure tests, and a separate permission review for any manifest or content-script changes. Source acquisition and playback control are independent capabilities. Do not add blanket `<all_urls>` access or infer that a site's undocumented API will remain available.

### Antigravity provider

`packages/core/src/pi-providers.ts` is the provider registry shared by the Host
and Extension. It declares provider IDs, adapter selection and catalog policy.
`agents/provider-registry.ts` configures adapters on each ModelRuntime and
checks that every declared provider is available.

`agents/antigravity.ts` adapts the third-party provider to Pi SDK.
The pinned pi-antigravity 0.8.1 package supplies OAuth, chat model discovery and
streaming; its extension factory, tools and account manager are never loaded.
The reproducible pnpm patch in `patches/pi-antigravity@0.8.1.patch` narrows the
upstream model definitions to Pi 0.99's chat kind, so direct TypeScript imports
retain SDK type checking. Registration also validates model properties at runtime.
The standalone bundle test exercises the actual provider stream with a synthetic
SSE response and account-directory isolation without installed node_modules.

The patch adds AsyncLocalStorage-based account-directory scoping. Each adapter
wraps streaming with its own `pi/antigravity` directory, including asynchronous
quota-error account lookup. Creating a runtime never changes process environment
variables, and concurrent runtimes keep their account directories isolated. Login and
logout use SDK credentials at `pi/auth.json`; this integration does not maintain
an upstream linked-account store. Model listing refreshes only Antigravity's
catalog and reports forced refresh errors; health checks remain offline.
Package upgrades require reviewing and regenerating this compatibility patch,
then running type checks and standalone bundle tests before rebuilding the Host.

### Provider authentication UI

`lib/pi-auth-state.ts` defines idle, login and logout as a discriminated state
machine. Its reducer clears prompts, transient secrets and progress atomically
on completion, cancellation or failure. Operation IDs reject stale callbacks;
prompt IDs prevent a late close event from clearing a newer prompt.
`hooks/use-pi-auth.ts` owns the Native Messaging transport and cleanup. Cancel
releases the UI immediately even when local disconnect emits no callback, and
losing Host availability or unmounting the component closes the active transport.
`components/pi-settings.tsx` renders this state and owns provider catalog display.

## Operation boundaries

`native/host-client.ts` validates requests/replies and assembles large saved documents. Every panel request goes through the worker's single Native port, which completes a protocol 4 / package-version / SDK-mode handshake before sending business requests. Health checks use the handshake response itself and preserve validated installed-version metadata when compatibility fails, so the panel can show update guidance without allowing business requests. The worker holds that port while any panel, pending request, or generation/backup operation remains active. Closing a panel only removes its subscription. Browser shutdown or a Host crash still stops execution; no daemon is installed.

`native/generation-session.ts` owns immutable duplicate-check inputs, tickets, regeneration confirmation, request IDs, chunk recovery, and document delivery deduplication. `lib/subtitle-draft.ts` owns provenance, per-video/language caches, file limits, selection changes, and version guards for successful and failed asynchronous results. Browser/tab/file capabilities are injected adapters; `hooks/use-subtitle-draft.ts` projects the draft into React.

`lib/preferences-store.ts` reads only `preferencesV2`, validates against the shared schema, publishes subscriptions, and orders writes after hydration. No provider is selected by default; generation settings require a supported Pi provider. Model preferences use provider keys only. Reader pronunciation settings share this store, while per-lesson study records use the `contextualStudyV5:` namespace.

`storage/document-sync.ts` serializes full operations per lesson through a repository-scoped queue: calibration, publication, backup, backup-account changes, restore, and history deletion. Different lessons can proceed concurrently. It reads canonical data only inside the queue and saves calibration locally before attempting remote synchronization. Network failures return warnings without rolling back canonical content.

Publication records journal planned JSON/Markdown hashes before writing. Both files must contain the latest revision before status becomes published; retries may replace only app-recorded bytes. Independent edits are conflicts. A backed-up status includes the canonical revision hash and account. An upload of an older revision completes before a queued calibration and its newer upload; it cannot be reused as evidence that the newer document is synced. The guarantee covers one shared Host process, not transactions between separate browser processes.

`LessonJobRecordSchema` version 1 retains only operational metadata when ended task history is deleted. The full job checkpoint is version 3 and lessons are version 5. Old local folders, Drive files, CLI registries, and interface keys are never migrated or deleted by this refactor.

## Formatting

Prettier is pinned in the workspace lockfile. Run `pnpm format` to format the source tree or `pnpm format:check` for verification. Generated builds, release archives, package-manager output, and dependency patches are excluded. CI runs the check before types and tests.
