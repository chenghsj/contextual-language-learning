# Changelog

Notable user-facing changes to Immersive Language Learning are recorded here. Version tags and the matching GitHub Release assets are the source of truth for published versions.

## [Unreleased]

- Fix AGY 1.2.11 model discovery when its model table is emitted on stderr or uses nonbreaking-space columns; keep the CLI model IDs for generation.

- Add OS-specific Native Messaging installers, native folder pickers and Windows binary launcher; distribute macOS, Windows and Linux Host ZIPs with checksums.
- Add fixed-command CLI model discovery and named Claude/Codex account Profiles; keep CLI default and custom model fallbacks without copying credentials.
- Show actionable Native Host registration instructions using the current extension ID.

- Prepared MIT licensing, contribution and security/privacy documentation, issue and pull-request templates.
- Completed five-language Side Panel localization and localized Chrome extension metadata; added working system/light/dark appearance selection and regression tests.
- Added capability-based playback-speed controls for existing YouTube and experimental Netflix video adapters.
- Added validated Chromium/Host release packaging with SHA-256 checksums.
- Added opt-in local folder / experimental Google Drive destination selection, duplicate preflight and explicit regeneration confirmation.
- Added checkpointed generation, saved job recovery and independent document-publishing retry.

## [0.1.0] — planned

Initial pre-release. Do not treat this version as published until its Git tag and matching GitHub Release exist.

The project is not affiliated with Google, YouTube, Netflix, Apple, Max/HBO or the CLI Agent providers.
