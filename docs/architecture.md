# Architecture and data contracts

The project has three runtime parts: the Chromium Side Panel and background worker, a per-user Native Messaging Host, and shared `@immersive/core` contracts. Video adapters identify supported URLs and expose optional playback capabilities. The Host embeds Pi SDK and owns provider credentials; the Extension only forwards transient login input and displays non-secret connection metadata.

## V4 lesson and job data

`packages/core/src/schema.ts` defines the only current lesson format, `schemaVersion: 4`. Each document keeps the complete original subtitle cues, the source and learning profile, contextual scenes with original cue IDs and times, translations, pronunciation segments, focus expressions, explanations, examples, and optional playback overrides. Overrides change playback windows without rewriting original cue timestamps. `packages/core/src/jobs.ts` defines `schemaVersion: 2` job snapshots: the original V4 generation request, candidate selection plan, completed contextual scenes, and status. It validates progress against those checkpoints when read. `packages/core/src/protocol-schema.ts` defines Native Messaging requests and response types; `native-messaging.ts` validates incoming responses and declares protocol version 3.

V4 deliberately has no V1/V2/V3 migration. The Host's canonical V4 repository is `~/Documents/Immersive Learning/data-v4/`, with `jobs/` and grouped `videos/` below it. The Host does not scan, restore, or delete older development files in `~/Documents/Immersive Learning/`. Drive browsing, duplicate checks, and restore select only app-created files marked `immersiveSchemaVersion=4`; older Drive files remain in place. Existing CLI registry/login files remain untouched; old CLI jobs cannot execute under SDK provider semantics. A chosen publication folder receives a JSON/Markdown copy after the canonical V4 document is saved; publication or backup failure does not erase completed content.

## Extension flow

The Side Panel has three top-level destinations: Create, Library, and Settings. The V4 reader is a Library detail view. Create owns subtitle acquisition, profile and Agent selection, duplicate preflight, and generation status. Library shows resumable tasks plus lessons grouped by video, including local and Drive copies. Settings owns Host connection, Agent setup, interface language, and appearance. Theme styling uses shared semantic light/dark tokens.

The background worker (`apps/extension/src/native/generation-controller.ts`) owns the long-lived Native Messaging connection for duplicate checks and generation. Closing the Side Panel does not close an active Agent job. The worker validates Host responses and relays interruption errors; the next panel reads durable job summaries. Short operations use `native/host-client.ts`. The health handshake requires matching extension package version, Pi SDK mode, and protocol version 3. An older Host shows installation guidance and generation remains disabled.

The reader keeps presentation of focus items in `components/scene-focus-items.tsx`; cue tracking, loop windows, playback range calculation, and calibration validation are in `video/` modules. It requests player actions only through a capability-based `VideoAdapter`. YouTube and Netflix adapters have separate URL, subtitle, and playback code; unsupported sources remain readable without player control. Netflix's internal player bridge is experimental. Adapter registration alone does not grant browser permissions.

## Native Host flow

`apps/local-host/src/index.ts` owns binary framing, process lifetime, and the final response writer. `host/dispatcher.ts` validates and routes requests using injected storage, JobManager, reply function, and version. `host/agents.ts`, `host/drive.ts`, `host/lessons.ts`, `host/generation.ts`, and `host/publication.ts` own their respective operations. The generation handler keeps a short-lived duplicate-check ticket bound to the exact request. It checks again before starting so a new duplicate cannot be silently overwritten.

`generation/scene-pipeline.ts` chunks subtitles, selects grounded scene candidates, validates each generated scene, writes a checkpoint, then assembles and saves the V4 document. A failed scene leaves prior checkpoints intact. `jobs/manager.ts` controls queued, running, waiting, failed, completed, and cancelled transitions. Native Messaging interruption stops active execution and a later list/resume reconciles orphaned jobs. No daemon is installed.

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
