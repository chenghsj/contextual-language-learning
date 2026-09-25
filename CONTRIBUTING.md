# Contributing

Contributions to Immersive Language Learning are welcome. Start with a small, reproducible issue and read [the architecture](docs/architecture.md) and [the MVP limitations](docs/scope.md) before implementing a new platform or Agent.

## Development

Requirements: Node.js 22+, pnpm 9, Chromium-based browser. The Native Messaging installer is currently macOS-only. Install and authenticate a supported CLI yourself only when manually testing AI generation.

~~~sh
git clone https://github.com/chenghsj/immersive-language-learning.git
cd immersive-language-learning
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm package:release
~~~

Use the feature branch while the initial MVP pull request is open. The Extension is in apps/extension, Host in apps/local-host, and shared schemas and subtitle utilities in packages/core. Load apps/extension/dist with chrome://extensions > Developer mode > Load unpacked. See README for the macOS Host installer. Do not commit generated dist/, release-assets/, credentials, OAuth tokens, downloaded videos or imported subtitles.

## Before opening an issue

Search existing issues and [the roadmap](docs/ROADMAP.md). Use the bug or feature template. Provide platform/browser/OS versions, a minimal **synthetic** SRT/VTT reproduction, expected and actual behavior, and a sanitized error log. Never attach copyrighted streaming subtitles, access tokens, OAuth credentials, personal Drive files or private video URLs. Screenshots must not include account details.

## Pull requests

1. Open an issue before a substantial feature or security-sensitive change. Scope each pull request to one problem and state compatibility implications.
2. Add/adjust automated tests for parsing, schema changes, adapter capability/failure behavior, job transitions, checkpoints and Native Messaging where applicable.
3. Run pnpm typecheck, pnpm test, pnpm build and pnpm package:release. CI also verifies the Chromium ZIP root manifest and macOS Host package.
4. Describe user-visible changes, manual checks and limitations in the PR template. Update README, CHANGELOG and relevant docs. Do not mark Netflix or Google Drive integration as production-tested without a real-platform test.
5. Preserve source subtitle cue IDs, source text and document schema versions. Any incompatible schema change needs a version bump, migration and fixtures.

### Adding another video service

Implement the VideoAdapter contract in apps/extension/src/video/, register it and add URL/capability tests. Add exact Chrome host permissions and any content script/build entry only if truly needed. Source acquisition is **not** implied by player-control support. Do not bypass DRM, copy protected subtitles, inject blanket <all_urls> permissions or claim an undocumented player API is supported by the platform. A service may be reader-only.

### Adding another CLI Agent

Implement AgentAdapter under apps/local-host/src/agents/, register the executable in the trusted registry, explicitly document supported model and account/profile controls, and test invalid output, process failure and cancellation. Never accept executable paths from subtitle text or run a shell command constructed from user content.

### Privacy and responsible disclosure

Follow [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). Report vulnerabilities through a private route rather than posting exploitation details in a public issue. All contributions are submitted under the repository's MIT license unless agreed otherwise in advance. Please also follow our [Code of Conduct](CODE_OF_CONDUCT.md).
