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
| loop / stopLoop | User-triggered repeat/stop for a cue, if available and permitted |

The reader never branches on "youtube", "netflix" or another platform ID. It renders available actions from the adapter capabilities. Without playback capabilities, a subtitle file still generates a document and its time cues can be copied.

Existing platform modules:

- apps/extension/src/video/youtube.ts — timestamp links, opt-in looping.
- apps/extension/src/video/netflix.ts — opt-in diagnose, seek and loop through its **undocumented** internal player API, which may stop working.
- apps/extension/src/video/tab.ts — shared tab resolution by video ID and messaging.
- apps/extension/src/content/* — platform-specific browser scripts, isolated from the reader.

**To add HBO Max, Apple TV+ or another service:** implement an adapter (even if its only capability is identification and opening the video), register it in video/index.ts, add its exact domains to the Chrome extension manifest and, **only when necessary**, add content scripts and build entries in Vite. Add tests for URL matching, capabilities and playback failure. Browser permissions and content-script injection require manifest/build registration; the Adapter registry does not grant arbitrary sites runtime access.

Do not assume every video site exposes a playback API or a permitted subtitle API. Subtitle ingestion stays separately pluggable: licensed/user-supplied SRT/VTT/text is the supported baseline. A new provider can support reading documents without any seek/loop or subtitle extraction.

## Agents: Adapter + trusted Registry

apps/local-host/src/agents.ts registers provider modules implementing AgentAdapter from agents/types.ts. Each adapter owns:

- CLI executable name and human-readable label
- Account-profile support and environment setup (never copy credentials to the browser)
- Noninteractive generation command, model handling and result parsing

apps/local-host/src/agents/process.ts owns executable resolution and process execution, always with spawn argument arrays (no shell). The generic generation pipeline calls generateWithAgent without provider-specific conditionals. A Host health request returns the actual adapter catalog and installed status, so the Side Panel presents providers discovered from the Host.

**To add another agent:** create agents/<id>.ts, register the adapter in agents.ts, add adapter/unit tests and validate the new CLI's model/account/permissions behavior. The Zod document/Agent schemas allow safe provider IDs, but the Host rejects IDs not in its trusted registry. Arbitrary CLI names are never executed.

No plugin code is loaded dynamically from web content or subtitle text. New adapters are packaged with the Host/extension, tested and installed through the normal release process.

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
