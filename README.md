# AI-powered Contextual Language Learning

A local-first Chrome side-panel extension that turns **video subtitles you have permission to use** into learning content with AI. Create a structured language lesson, or use a custom prompt for summaries, vocabulary, grammar, shadowing, quizzes and other Markdown content. Return to the original video for focused practice.

The product name is **Contextual Language Learning (CLL)**. Packages, download filenames, local paths and Native Host registration use the `contextual` name. See the branding upgrade steps below when updating an older installation.

## Learning approach

Learning starts from the context of a video. Standard lessons select meaningful subtitle scenes and add explanations, translations, pronunciation notes and examples for the learner's level. Custom content uses your prompt and the selected source to produce Markdown. An interactive reader connects lessons to source timestamps, with optional sentence looping and playback speed controls on supported video platforms.

> MVP status: the working implementation covers subtitle import, Pi provider connections, standard lesson and custom Markdown generation, an interactive reader, YouTube timestamp links/opt-in loop playback, and local JSON/Markdown export. Netflix one-click subtitle retrieval is **experimental** and works only when the currently playing session exposes a readable subtitle track; a durable background daemon is **not implemented**. Google Drive OAuth, multi-account selection and upload are experimental: a developer-configured Desktop OAuth client at build time and live account testing are required. Generated scenes and jobs have durable local checkpoints; reopening Chrome can resume interrupted work **on user request**.

## Open source and project status

This repository remains **private** pending the public-release checklist and live platform testing. Adding a license and contributor files does not make it public. See the [MIT license](LICENSE), [contribution guide](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), [privacy and data handling](PRIVACY.md), [changelog](CHANGELOG.md), [roadmap](docs/ROADMAP.md) and [open-source readiness checklist](docs/OPEN_SOURCE_CHECKLIST.md).

**No production-ready Google Drive or Netflix compatibility guarantee:** Google OAuth and Netflix's undocumented playback API require manual platform testing before a public stable release. This project is not affiliated with the streaming platforms or model providers.

## Connect an AI service

The Native Host embeds Pi SDK 1.5.2. No separate Pi, Codex, Claude or other CLI
installation is required. Open Settings → AI services, choose a provider, then
use its supported OAuth or API-key flow. Select the connected provider and model.
The catalog includes providers bundled with Pi SDK, plus Antigravity and a local/custom connection.
For Ollama, LM Studio or another OpenAI-compatible server, choose **Add AI connection → Local / custom**.
See [Local model setup](docs/local-models.md) for addresses, token limits and connection testing.
Services are searchable and grouped by their supported sign-in methods. AWS and
Google Cloud credential flows use the SDK's setup prompts; some services also
require provider-specific environment configuration, such as Azure endpoints.
TypeSafe currently provides classifier models only, so it can be connected but
cannot generate lessons. Only text generation models appear in the model picker;
SDK support is not a guarantee of subscription entitlement or official approval.
These integrations still require real-account acceptance testing before release.

Model selection and generation use the SDK's authentication and provider filters,
with dynamic catalog refresh where supported. SDK candidates are not disabled by
separate catalog queries or locally installed CLI versions. A failed dynamic refresh
keeps existing SDK candidates usable and shows a warning; missing credentials or
an empty candidate list still prevent generation. Model lists cannot guarantee
subscription entitlement, remaining quota or successful generation: request failures
are reported by the provider when the selected model is used.

The Create screen estimates the initial input tokens using the SDK's text heuristic.
For API accounts with known model input pricing, it also shows an input reference
cost. Later generation, integration, output, reasoning and retries are excluded.
Subscription accounts show usage without converting it to an API charge; their
allowance and billing remain with the provider. Estimates never invoke inference.

Antigravity is provided by the pinned `pi-antigravity` package (an unofficial Google
integration). Use **Sign in with Google** in AI services with an eligible account.
Only its OAuth, chat models and transport are registered; image/search tools and
multi-account commands are not loaded. Credentials remain in this product's
`pi/auth.json`, and the transport's optional account lookup is isolated under
`pi/antigravity/`. Package updates ship with a rebuilt Native Host.

This product stores credentials only in its own local configuration directory,
under `pi/auth.json`. The Extension holds login form input temporarily and forwards
it to the Host; credentials are not saved in browser storage, jobs or lessons.
Disconnect deletes this product's stored credential without revoking it at the
provider. Login data from installed CLIs is never imported or removed.

Each generation stage has an isolated in-memory Session, no tools, and no global
Skills, extensions, settings or project instructions. Existing prompts, validation
and durable checkpoints remain authoritative. Old CLI jobs cannot be resumed using
a different SDK provider; their saved results and original files are preserved.
Create a new task with a connected provider. Completed lessons remain readable.

### Native Host / local connection service

Install and register the matching Native Host package once for your OS and current
browser extension ID. The Host includes the SDK and runs on Node.js 22+.
The Extension requires matching package versions, Pi SDK mode and Native Messaging
protocol version 8. Rebuild/reinstall the Host when upgrading from CLI mode.
Connecting or disconnecting an AI service does not change browser registration.

### V5/V6 data policy

New standard lessons use V6: complete source utterances, learning points and optional
reusable expressions or frames. Canonical lessons and checkpoint 4 jobs are saved in
`~/Documents/Contextual Language Learning/data-v6/`. Existing V5 lessons remain in
`data-v5/` and support reading, playback, calibration, export and backup without
rewriting or regeneration. The library combines both versions; checkpoint 3 history
and completed material remain available, but those tasks do not resume with V6 prompts.
An optional selected folder receives a JSON/Markdown copy. There is no automatic
migration between lesson schema versions.

Earlier development lesson schemas 1–4 remain at their original paths for manual
recovery and are outside the current library. Old Agent definitions, CLI login data
and interface keys remain untouched. Only `preferencesV2` is read. See the
[V6 implementation and acceptance record](docs/learning-points-v6-implementation.md)
for model-quality findings and external acceptance still pending.

### Upgrading the product name

Rebuild and reload the extension, then reinstall the matching local service for the current browser and extension ID. The new Native Host name is `dev.contextual.language_learning`; an older registration cannot satisfy that name. Reload open video tabs so both halves of the page bridge use the new event names.

On the new Host's first start, existing `Immersive Learning` configuration and document directories are copied to `Contextual Language Learning` (Linux configuration uses `contextual-language-learning`). Originals remain available for recovery. A completion marker prevents subsequent starts from copying old files again or restoring content you deleted. If both locations contain different files at the same relative path, startup stops with the conflict path and leaves both copies intact; resolve the conflict and reconnect. The old Native Host program is not copied; reinstall it through Setup.

Google Drive credentials are copied from the old Keychain service when first used. New credentials use `dev.contextual.language-learning.google-drive`; disconnect removes credentials under both service names. Drive reads recognize both old and new metadata; new writes use `contextual` properties. Old local copies may contain credentials, so retain them only as long as you need the recovery copy. This name migration does not convert older lesson schemas or resume legacy CLI jobs.

## Features

- Choose **Standard lesson** for structured language study or **Custom Markdown** to create content with your own prompt. Built-in templates cover summaries, vocabulary, grammar, shadowing and quizzes. Custom content has its own local repository, checkpoints and Markdown export.

- On the currently selected YouTube watch tab, click **一鍵取得目前影片字幕** to read the video player's available English/Japanese/Korean caption track (including automatic captions when available). The extension reads the track only on request, preserves cue timestamps and never requires a file upload for a readable caption track. YouTube can change its page/player interfaces; if it offers no readable track, use manual import. Switching tabs updates the source of the next empty lesson form without replacing an existing transcript.
- On an open Netflix watch page, click **一鍵取得目前影片字幕** to read the selected learning language's available timed-text track into the lesson form, without uploading a file. Netflix's signed caption document is requested by the extension worker from allowlisted Netflix delivery domains, not by a cross-origin page fetch. Chrome may ask you to approve the extension's new Netflix delivery-domain permissions after updating; if denied, one-click retrieval cannot work. Manual SRT, VTT and pasted text remain a fallback; original cue times are preserved.
- Select a target language, level, **instruction language**, scene count and number of contextual examples.
- Connect an AI service through the bundled Pi SDK and select a model; catalog membership does not prove account entitlement.
- Keep AI credentials in a product-owned Host directory, independent of installed CLIs.
- Native Messaging bridge to macOS, Windows and Linux Hosts; no API keys or CLI credentials are stored in the extension.
- Run a checkpointed V6 pipeline: discover grounded candidates, select scenes, teach every complete utterance, validate each batch and publish JSON/Markdown after complete coverage. Learning-point count follows useful content; examples belong to reusable expressions or frames. Library history supports resuming interrupted or failed V6 jobs.
- Open YouTube timestamp links in a new tab; optionally control an already-open YouTube tab for sentence looping and user-triggered playback speed (0.5×–2×).
- Netflix has optional, user-initiated seek, per-sentence looping and playback speed (0.5×–2×) via an experimental internal player bridge adapted from [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). Subtitle retrieval is user-initiated and conditional on Netflix exposing a readable timed-text document in the active session. It does not bypass DRM, intercept keyboard shortcuts or open a second playback session.

## Install the local service

Download the **setup ZIP for your operating system and processor** and extract it completely. Open **CLL 本機服務.app** on macOS, **Setup.exe** on Windows, or **CLL Setup.desktop** on Linux. In the setup page, choose your browser and click Install. Return to Extension Settings and check the connection.

The ZIP includes its Node runtime; users do not need Node.js, pnpm, the source repository, or terminal commands. Reopen Setup to update or uninstall. Uninstall removes only the selected browser's registration and preserves lessons, task history, credentials and settings.

Local test packages have a preconfigured test extension ID, with an optional collapsed test setting for other unpacked builds. Release packages use explicit store extension IDs and hide that setting. Local builds show local ZIP guidance rather than linking to old online script packages. See [local setup packaging and verification](docs/host-setup.md).

Linux currently requires a graphical desktop with `xdg-open`; its ZIP is not a distribution-specific `.deb`/`.rpm`. Local test packages are unsigned. Public distribution needs platform acceptance and signing/notarization. Browser-store publication is separate from the local ZIP build.

### Publishing the Chromium release

The workflow at .github/workflows/release.yml follows the ZIP packaging used by the netflix-shortcut-override project, and also packages macOS, Windows and Linux Hosts. It runs the normal typecheck, tests, build, extension/host checks, ZIP integrity checks, and SHA-256 verification before creating or updating a GitHub Release.

First merge the tested PR into main. Make sure package.json and apps/extension/public/manifest.json have the same version, then create and push the matching version tag:

```sh
git switch main
git pull
git tag v0.1.0
git push origin v0.1.0
```

A tag push runs the Release workflow and uploads the Chromium ZIP, three OS Host ZIPs and SHA256SUMS. Alternatively, after this workflow exists on the default branch, use GitHub Actions > Release > Run workflow with an **existing** version tag. Tag/version mismatches fail instead of shipping mismatched files. Ordinary PR builds expose the same packages as a short-lived Actions artifact called release-preview-SHA; this is not a GitHub Release. Do not tag a development branch unless you explicitly intend to release that commit.

## Quick start (macOS / Windows / Linux)

Prerequisites: Node.js 22+, pnpm 9, Chrome / Edge / Chromium, and an account or API key for a supported AI service. Windows additionally needs Windows PowerShell 5.1 and .NET Framework for the Host installer.

```sh
git clone https://github.com/chenghsj/contextual-language-learning.git
cd contextual-language-learning
corepack enable
pnpm install
pnpm build
```

1. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `apps/extension/dist`.
2. Copy the newly loaded extension ID (32 characters).
3. Register its Native Messaging Host for your OS (append `--browser edge` for Edge or `--browser chromium` for Chromium):

```sh
pnpm host:install YOUR_EXTENSION_ID
```

4. Open the Side Panel and check the **local connection service / Native Host** in Settings.
5. In **AI services**, sign in or enter an API key, then choose a provider and model.
6. In **建立內容**, fetch/import subtitles, set the lesson profile and generate. New canonical lessons are saved under `~/Documents/Contextual Language Learning/data-v6/videos/<video title>--<source ID>/`. Repeat generations of the same source share a folder even when its title changes.
7. In **內容庫**, recover an interrupted V6 task or search by video title and expand a video to open a lesson. The reader is a Library detail page.

If your browser reports a missing Native Host, confirm you installed it for the same browser and its **current extension ID**. The macOS/Linux installer writes a browser-specific NativeMessagingHosts manifest; Windows writes its path to the browser's per-user HKCU NativeMessagingHosts registry key. Re-run `pnpm build` and `pnpm host:install YOUR_EXTENSION_ID` after changing the Node installation or extension ID.

### Development with HMR

After installing dependencies with `pnpm install`, start development from the
repository root:

```sh
npm run dev
# Equivalent: pnpm dev
```

The dev server listens at `http://127.0.0.1:5174`. Once Vite is ready, open
`chrome://extensions`, enable Developer mode and load `apps/extension/dist-dev`
as an unpacked extension. Open its Side Panel and leave the terminal running.
React and CSS edits update through HMR. Background/service-worker edits reload
the extension and can interrupt an active Host operation; reopen the Side Panel
after that reload. Reload an already-open video tab after initially loading the
development extension so its content scripts are installed.
The early YouTube/Netflix page bridges rebuild automatically, but need a video
tab reload to run their updated code.

The development folder has its own extension ID and browser settings. To use the
real Native Host, copy this ID from `chrome://extensions`, build the Host if
needed, and register it for that ID:

```sh
pnpm --filter @contextual/local-host build
pnpm host:install YOUR_DEV_EXTENSION_ID
```

Host registration selects an extension ID for the chosen browser; register the
release extension ID again when returning to `apps/extension/dist`. HMR covers
extension code. Host source changes require rebuilding/reinstalling the Host and
reconnecting. Stop the dev server with Ctrl+C when finished; the development
extension needs this server to run. `pnpm build` continues to produce the release
build in `apps/extension/dist`.

For UI work in a regular browser tab, run `npm run dev:preview`. It opens
`http://127.0.0.1:5175/dev/redesign-preview.html` with HMR and simulated Chrome/Host data; this preview
does not connect to your real video tabs, AI providers or Drive account.
Dependency installation still uses pnpm; `npm run` only launches these scripts.

### Models and authentication

Model lists come from the bundled SDK. A blank model selection uses the first
available model for the selected provider. Login does not generate a test lesson.
Authorization failures preserve validated stage checkpoints for retry after
reconnecting. Only product-owned credentials are removed on disconnect.

## Extensible providers

Video playback uses capability-based Video Adapters, while generation uses the bundled Pi SDK. The Side Panel displays provider connection metadata and model choices returned by the Host. See [Architecture and adding providers](docs/architecture.md) for the exact extension points and per-platform Chrome permission requirements.

Adding HBO Max or Apple TV+ requires a purpose-built adapter and an explicit browser permission review; neither service is currently implemented. An unsupported video URL falls back to subtitle import without player control.

## Engineering

```sh
pnpm typecheck
pnpm test
pnpm build
```

Packages:

- `packages/core`: V5/V6 lesson schemas and versioned job checkpoints, Native Messaging validation, subtitle parsers/chunking and time links.
- `apps/local-host`: Native Messaging framing, isolated Pi SDK sessions and provider authentication, Job State Machine, resumable Generation Pipeline and file-backed repository ports.
- `apps/extension`: React side panel, settings, reader, and opt-in YouTube loop content script.

Read [Scope and limitations](docs/scope.md) before sending sensitive or copyrighted transcripts to an external AI provider.

### Experimental Netflix controls

The Reader's **開啟／切換到影片** button reuses an existing tab showing the exact saved video ID before opening a new one. When multiple matching Netflix watch tabs are open, the extension prefers the active matching tab in the current window, then a unique active matching tab in another window. If the intended player is ambiguous, it asks you to switch to the correct tab or close the extra copies instead of controlling an arbitrary player or opening a third tab. A generic Netflix homepage or a different title is not treated as the same video. The extension never closes tabs on your behalf.

If a watch tab was opened before installing/reloading the extension, reload **that same tab** to initialize its content scripts. Do not open a second tab to work around a missing bridge.

Open the Netflix /watch/<video-id> page, select the learning language in **建立教材**, and click **一鍵取得目前影片字幕**. The extension reads the current playback session's available timed-text document when Netflix exposes it; it does not read protected video/audio streams. If Netflix does not expose a usable track, the UI reports the limitation instead of silently generating from incomplete captions. You may also supply a subtitle file you are permitted to process. In the Reader, open the same Netflix /watch/<video-id> URL saved with the lesson. Use the reader controls for explicit scene or sentence playback when the matching Netflix player is available. This uses a MAIN-world bridge with Netflix's **undocumented** player session API, following the pattern in your [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override) repository. Session seek times are in milliseconds.

This is not an official Netflix API. The extension retrieves subtitle text only when you click the button; it may briefly select and then restore the requested track. It does not bypass content protection, extract audio/video or intercept the Netflix keyboard. Playback controls remain idle except when explicitly requested. Stop the loop before using other playback controls; manual pause/seek, page navigation or an unavailable player automatically cancel it. If the API changes, copy the timestamp and seek manually.

A real-browser test with your Netflix account is required: confirm successful caption retrieval, language selection, track restoration, navigation cancellation and a clear failure when Netflix's undocumented internals change. Automated CI does not test a live Netflix playback session.

### Resumable job workflow

The Host saves checkpoint 4 snapshots under
`~/Documents/Contextual Language Learning/data-v6/jobs/` after each validated
candidate window, selection and teaching batch. Input/output budgets may split a
batch into smaller complete utterance groups. One automatic repair allowance is
preserved per batch; manual resume can retry unfinished generation without renewing
that allowance. Only complete, validated coverage creates a finished lesson.

Closing the Side Panel leaves the background worker's active Host connection
running; closing the browser stops it. Reopen Library to resume an unfinished V6
task from its checkpoint. Completed V5/V6 lessons reopen without a model call;
V5 checkpoint 3 tasks retain history but require a new V6 generation to continue.
Large documents use bounded Native Messaging chunks with schema/reference validation
after reassembly.

The file repository is designed for one Host writer, not simultaneous edits from
independent browser profiles. A persistent daemon and cross-device sync are not
implemented. Legacy development lesson schemas 1–4 remain outside the current
library and are available only for manual recovery.

## Local-first lessons, duplicate protection and optional Drive backup

Every completed lesson is saved locally first. The Create page lets you choose a local export folder and independently enable **automatic Google Drive backup**. The backup switch checks the selected account's authorization; if no account is connected, **Connect Google Drive** opens Google's consent flow. You can read completed material immediately while its backup runs. Turning the switch off does not remove local or cloud files.

The V5/V6 local library and selected export folder group JSON and Markdown files by source video. Legacy flat files are not moved when the Host lists lessons. App-created Google Drive backups use a matching video subfolder under `AI-powered Contextual Language Learning`; library browsing never moves existing cloud files. Folder names keep their original readable title after a source title change, while **My Lessons** shows the newest title and searches prior titles.

Before generation, the Host searches saved local lessons and existing app-owned Drive lessons when an account is available. It compares source and transcript, and asks before generating another version. Regeneration creates a new document ID and never silently overwrites an older lesson or its progress.

The background backup checks document identity and content hashes before uploading JSON and Markdown. Identical files are skipped; a conflicting remote version is preserved and reported rather than overwritten. If only one file uploaded, retrying fills in the missing file without regenerating the lesson. Backup status is independent of generation status. Closing the Side Panel does not interrupt an active Host task; an interrupted pending upload can resume when the extension reconnects. Closing the browser does not make the Host a permanent background service.

Library shows generation progress, recovery and backup retry alongside lessons. **My Lessons** combines local and cloud copies of the same lesson, supports local/cloud filtering and can restore a missing local copy from an app-owned Drive file with checksum and schema validation. Settings includes connected accounts and an explicit **Back up existing lessons** action; enabling automatic backup does not silently upload the old library. Cross-device learning-progress and note synchronization are not yet implemented.

### Google Drive one-click authorization on macOS

End users do not need an OAuth Client ID, Client Secret, Google Cloud project or `.env` file. Choose **Connect Google Drive**, select an account in Google's browser consent screen and return to the extension. The Host uses PKCE with a loopback callback and stores refresh tokens in macOS Keychain. You can change the backup account or disconnect it in Settings; disconnecting does not delete Drive files. If authorization expires or the bundled OAuth client changes, reconnect the account.

Developers building the Native Host should enable Google Drive API in a Google Cloud project, configure consent for `openid`, `email` and the limited `https://www.googleapis.com/auth/drive.file` scope and create a **Desktop** OAuth client. Set `GOOGLE_OAUTH_CLIENT_ID` in a root `.env` file (see `.env.example`) or the build environment **before** running `pnpm build`. If Google responds that a Desktop client secret is missing, also configure the optional `GOOGLE_OAUTH_CLIENT_SECRET` from that same Desktop OAuth client and rebuild/reinstall the Host. Both values are embedded in the installed Host when supplied; a desktop client secret is extractable and must not be treated like a confidential backend secret. For GitHub Releases, configure the repository Actions secret `GOOGLE_OAUTH_CLIENT_ID`, and optionally `GOOGLE_OAUTH_CLIENT_SECRET` if required; the release workflow refuses to publish without the Client ID. A CI preview built without that identifier has no Google Drive authorization until a configured Host is installed. An account previously authorized with a different client ID must reconnect.

Google Drive uses the limited `drive.file` scope and can search only app-created or app-shared files, not arbitrary files in the account. Live Google authorization and upload are not exercised in CI, and OAuth credential storage currently supports macOS only. For privacy, only generate or upload transcripts you are authorized to share with the configured Agent provider.
