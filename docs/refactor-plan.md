# Codebase refactor implementation

Implemented in the main checkout, based on `b171f106194a4883383bee04f376ab457a9d16c1`.

## Completed scope

1. **Host transport:** all panel requests use the worker-owned Native connection. The worker checks protocol 4, package version and Pi SDK mode before forwarding requests, tracks pending operations, validates panel senders and releases idle connections. Closing the panel retains running generation and backup work. No daemon is installed.
2. **Generation session:** immutable duplicate-check payloads, confirmation tickets, request identity, resume/cancel, worker state attachment, document chunks, recovery and delivery deduplication live behind one interface.
3. **Subtitle draft:** provenance, manual import protection, per-video/language caches, file limits and stale async result suppression are owned by one module with browser/file adapters.
4. **Preferences:** shared schema, defaults, hydration, subscriptions and ordered writes use only `preferencesV2`. Provider selection defaults to none; model preferences use provider keys. Reader pronunciation uses the same store.
5. **Document synchronization:** complete calibration, publication, backup, account changes, restore and history deletion operations serialize per lesson. Publication journals byte hashes before writes, repairs partial app-owned output and rejects independent edits. Backups record the canonical revision and account. Local calibration survives synchronization failure.
6. **Current contracts and cleanup:** lesson schema 5, job snapshot 3 and operational record 1 replace older formats. Canonical files use `data-v5`; Drive browsing and restore filter current metadata. CLI execution, profiles, custom Agent settings and imports are removed. Old local files, Drive files, credentials and browser keys remain untouched and are not migrated.

Prettier formats the entire supported source tree. Generated artifacts, dependency patches and the lockfile are excluded. `format` and `format:check` are available, and CI checks formatting before types and tests. UI style contracts compare parsed style strings so formatting does not invalidate them.

## Validation and acceptance

Automated validation includes formatting, type checks, the complete test command, production builds, extension asset checks, a framed Native Host smoke test with a temporary home, and local release archive verification. Public-interface regressions cover handshake incompatibility, panel closure, auth ownership, duplicate snapshots, stale generation recovery, subtitle races, ordered preferences, partial publication recovery, concurrent calibration/backup, restore conflicts and history deletion.

Live acceptance remains separate: register the rebuilt Host and reload the extension together, then exercise real Pi authentication/generation, panel closure and reopening, YouTube/Netflix acquisition, calibration, and Google Drive conflicts using a dedicated test account. Existing installed builds have not been changed by this implementation. Browser shutdown or a Host crash can still interrupt work; checkpoints provide resume. The document queue guarantees one Host process, not cross-process transactions.
