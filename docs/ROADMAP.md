# Roadmap and status

This is a planning aid, not a promise of release dates. Please verify a feature in the code and release notes before relying on it.

## MVP implemented in the development branch

- Vite/React Chrome Side Panel, local SRT/VTT/plain-text import and original-cue preservation.
- Level/instruction-language settings, Agent adapters, structured lesson generation and local JSON/Markdown export.
- Checkpointed generation with explicit resume; no daemon running after Chrome closes.
- YouTube video time links, sentence looping and user-triggered playback speed.
- Experimental Netflix diagnose, seek, loop and playback speed via an undocumented player interface, with manual timestamp fallback.
- Local folder publishing, experimental Google Drive publishing with independently selected accounts, duplicate preflight and confirmed new-version regeneration.
- CI, versioned Chromium/macOS Host ZIP packaging and preview artifacts.

## Needs validation before a stable public release

- Full macOS install from both ZIPs and actual CLI sign-in/model-generation tests.
- Netflix playback tests in a real browser and regression tests when Netflix changes its private player interface.
- Google Desktop OAuth, token refresh, multi-account switch and Drive upload tests using a real test account.
- Privacy/security review for folder permissions, accidental transcript disclosure and release dependencies.
- Branch protection, protected tags and contributor-facing private security reporting.

## Future work

- Persistent background daemon and transactional multi-process job storage.
- Learning progress UI, review scheduling and export/import of progress.
- Optional provider adapters for other video domains **only where playback access is permitted and feasible**.
- Additional CLI adapters with explicit capabilities and test coverage.
- Google Drive sync/conflict management and account-disconnect flow.
- Published browser store builds and wider platform support, subject to release readiness.

Please discuss changes that expand browser host permissions, use undocumented streaming internals or change credential handling before submitting code.
