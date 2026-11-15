# Contributing

Contributions to AI-powered Contextual Language Learning are welcome. Start with a small, reproducible issue and read [the architecture](docs/architecture.md) and [the MVP limitations](docs/scope.md) before implementing a new platform or Agent.

## Development

Requirements: Node.js 22+, pnpm 9, Chromium-based browser. The Native Messaging installer supports macOS, Windows and Linux; Windows additionally requires Windows PowerShell 5.1 and .NET Framework, while Linux folder selection needs zenity or kdialog. Connect a supported Pi provider only when manually testing AI generation.

```sh
git clone https://github.com/chenghsj/contextual-language-learning.git
cd contextual-language-learning
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm package:release
```

Use a branch based on current `main` for each contribution. npm/yarn installs are blocked by `preinstall` because this is a pnpm workspace. The Extension is in apps/extension, Host in apps/local-host, and V4 lesson, job and Native Messaging contracts plus subtitle utilities are in packages/core. Load apps/extension/dist with chrome://extensions > Developer mode > Load unpacked. See the [development guide](docs/development.md#install-from-source) for the current development checkout, OS requirements and browser-specific Host setup. Do not commit generated dist/, release-assets/, npm/yarn lockfiles, credentials, OAuth tokens, downloaded videos or imported subtitles.

## Interface components

Read [the product-wide UI standards](DESIGN.md) before changing any screen. They cover typography roles, spacing, page layouts, control sizes and the migration status across Create, Library, readers, Settings, Activity, editors and overlays. Reuse typography tokens in `apps/extension/src/styles.css`; document justified exceptions instead of inventing page-specific sizes.

Use the project's shadcn `new-york` components for shared controls. Keep their default styles and variants intact; usage-level sizing and layout may adapt to the Side Panel. Use Popover + Command for searchable choices, Alert for persistent field feedback, and Sonner for transient notifications. Do not add custom modal pickers, hover colors, popup positioning, or toast appearance. Preserve the existing semantic light/dark theme tokens.

## Before opening an issue

Search existing issues and [the roadmap](docs/ROADMAP.md). Use the bug or feature template. Provide platform/browser/OS versions, a minimal **synthetic** SRT/VTT reproduction, expected and actual behavior, and a sanitized error log. Never attach copyrighted streaming subtitles, access tokens, OAuth credentials, personal Drive files or private video URLs. Screenshots must not include account details.

## Pull requests

1. Open an issue before a substantial feature or security-sensitive change. Scope each pull request to one problem and state compatibility implications.
2. Add/adjust automated tests for parsing, schema changes, adapter capability/failure behavior, job transitions, checkpoints and Native Messaging where applicable.
3. Run pnpm typecheck, pnpm test, pnpm build, the framed Host smoke test, and pnpm package:release. CI also verifies the Chromium ZIP, all three OS Host ZIPs and the Windows executable launcher's binary stdio protocol.
4. Describe user-visible changes, manual checks and limitations in the PR template. Update README, CHANGELOG and relevant docs. Do not mark Netflix or Google Drive integration as production-tested without a real-platform test.
5. Preserve source subtitle cue IDs, source text and timestamps. V4 is the only current document format; an incompatible future format needs a deliberate version and data policy, plus fixtures. Do not silently read, rewrite or delete V1/V2/V3 development data. Keep Host protocol compatibility explicit.

### Adding another video service

Implement the VideoAdapter contract in apps/extension/src/video/, register it and add URL/capability tests. Add exact Chrome host permissions and any content script/build entry only if truly needed. Source acquisition is **not** implied by player-control support. Do not bypass DRM, copy protected subtitles, inject blanket <all_urls> permissions or claim an undocumented player API is supported by the platform. A service may be reader-only.

### Adding another Pi provider

Use the bundled SDK provider contract in apps/local-host/src/agents/pi.ts and the
shared provider allowlist. Test cancellation, malformed/truncated output, login
cleanup and isolated bundling. Do not introduce CLI fallback, shell execution,
global resource discovery or credential fields in saved jobs. Real-account
acceptance is required before advertising a provider as verified.

### Privacy and responsible disclosure

Follow [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). Report vulnerabilities through a private route rather than posting exploitation details in a public issue. All contributions are submitted under the repository's MIT license unless agreed otherwise in advance. Please also follow our [Code of Conduct](CODE_OF_CONDUCT.md).
