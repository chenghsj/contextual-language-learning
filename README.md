# AI-powered Contextual Language Learning

A local-first Chrome side-panel extension that uses your locally installed CLI agent to turn **video subtitles you have permission to use** into structured, level-appropriate language lessons. Learn vocabulary and expressions in dialogue context, then return to the original video for focused listening practice.

## Learning approach

This is **contextual, video-based language learning**, not a promise of full language immersion. AI organizes subtitle excerpts into lessons with grounded explanations, vocabulary and exercises for the learner's level. An interactive reader connects lessons to source timestamps, with optional sentence looping and playback speed controls on supported video platforms.

> MVP status: the working implementation covers subtitle import, three CLI adapters, lesson generation, an interactive reader, YouTube timestamp links/opt-in loop playback, and local JSON/Markdown export. Netflix one-click subtitle retrieval is **experimental** and works only when the currently playing session exposes a readable subtitle track; a durable background daemon is **not implemented**. Google Drive OAuth, multi-account selection and upload are experimental: a developer-configured Desktop OAuth client at build time and live account testing are required. Generated chapters and jobs now have durable local checkpoints; reopening Chrome can resume interrupted work **on user request**.

## Open source and project status

This repository remains **private** pending the public-release checklist and live platform testing. Adding a license and contributor files does not make it public. See the [MIT license](LICENSE), [contribution guide](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), [privacy and data handling](PRIVACY.md), [changelog](CHANGELOG.md), [roadmap](docs/ROADMAP.md) and [open-source readiness checklist](docs/OPEN_SOURCE_CHECKLIST.md).

**No production-ready Google Drive or Netflix compatibility guarantee:** Google OAuth and Netflix's undocumented playback API require manual platform testing before a public stable release. This project is not affiliated with the streaming platforms or model providers.

## Features

- On the currently selected YouTube watch tab, click **一鍵取得目前影片字幕** to read the video player's available English/Japanese/Korean caption track (including automatic captions when available). The extension reads the track only on request, preserves cue timestamps and never requires a file upload for a readable caption track. YouTube can change its page/player interfaces; if it offers no readable track, use manual import. Switching tabs updates the source of the next empty lesson form without replacing an existing transcript.
- On an open Netflix watch page, click **一鍵取得目前影片字幕** to read the selected learning language's available timed-text track into the lesson form, without uploading a file. Netflix's signed caption document is requested by the extension worker from allowlisted Netflix delivery domains, not by a cross-origin page fetch. Chrome may ask you to approve the extension's new Netflix delivery-domain permissions after updating; if denied, one-click retrieval cannot work. Manual SRT, VTT and pasted text remain a fallback; original cue times are preserved.
- Select target language (English/Japanese/Korean), level, **instruction language**, teaching mode, vocabulary cap, and exercises per section.
- Pick Claude Code, Codex, or AGY. The Native Host queries `agy models` or Codex's experimental `codex debug models` for available model options; Claude Code offers documented aliases rather than an account-specific machine-readable list. You can always use the CLI default or a custom model ID. Catalog entries do not guarantee entitlement.
- Save named Claude/Codex CLI account Profiles pointing to existing, separately authenticated directories inside your home folder. Selecting one changes `CLAUDE_CONFIG_DIR` or `CODEX_HOME` only for that Agent invocation; profile names/paths are stored locally, never credentials. AGY uses its current CLI login.
- Native Messaging bridge to macOS, Windows and Linux Hosts; no API keys or CLI credentials are stored in the extension.
- Run a checkpointed generation pipeline: chunk subtitles, validate AI sections with Zod, save each successful chapter, then export the JSON/Markdown document. Reopen the Side Panel and use **任務紀錄與恢復** to resume interrupted/failed jobs.
- Open YouTube timestamp links in a new tab; optionally control an already-open YouTube tab for sentence looping and user-triggered playback speed (0.5×–2×).
- Netflix has optional, user-initiated seek, per-sentence looping and playback speed (0.5×–2×) via an experimental internal player bridge adapted from [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). Subtitle retrieval is user-initiated and conditional on Netflix exposing a readable timed-text document in the active session. It does not bypass DRM, intercept keyboard shortcuts or open a second playback session.

## Install from GitHub Release (Chromium + macOS / Windows / Linux)

After a version tag is published, go to [GitHub Releases](https://github.com/chenghsj/immersive-language-learning/releases) and download these matching assets:

- immersive-language-learning-chromium-VERSION.zip — Chrome / Edge Chromium Manifest V3 extension.
- immersive-language-learning-macos-host-VERSION.zip — macOS Native Host.
- immersive-language-learning-windows-host-VERSION.zip — Windows Native Host.
- immersive-language-learning-linux-host-VERSION.zip — Linux Native Host.
- SHA256SUMS — SHA-256 checksums for all four ZIP files.

Extract the **Chromium** ZIP, open chrome://extensions, enable Developer mode, select **Load unpacked**, and choose the extracted folder with manifest.json at its root. The ZIP is not a signed CRX and is not installed by dragging it into Chrome.

Copy the extension's 32-character ID from `chrome://extensions` (or `edge://extensions`). Extract the **Host ZIP for your operating system** separately and run this from the extracted folder (Node.js 22+ required):

~~~sh
node scripts/install-host.mjs YOUR_EXTENSION_ID
~~~

For Edge append `--browser edge`; for Chromium append `--browser chromium`. The installer copies the Host to a permanent per-user location and registers the extension ID for that browser, without administrator privileges. Windows also requires Windows PowerShell 5.1 and .NET Framework to compile a tiny native `.exe` stdio launcher locally. Linux requires `zenity` or `kdialog` for graphical local-folder selection. You can remove the Host extraction afterward. Install and sign in to a supported CLI Agent separately; the release contains no API keys or account tokens. To update the unpacked extension, extract the new Chromium ZIP into the **same** extension folder and reload it; if Chrome assigns a different extension ID, run the Host installer again with the new ID.

### Publishing the Chromium release

The workflow at .github/workflows/release.yml follows the ZIP packaging used by the netflix-shortcut-override project, and also packages macOS, Windows and Linux Hosts. It runs the normal typecheck, tests, build, extension/host checks, ZIP integrity checks, and SHA-256 verification before creating or updating a GitHub Release.

First merge the tested PR into main. Make sure package.json and apps/extension/public/manifest.json have the same version, then create and push the matching version tag:

~~~sh
git switch main
git pull
git tag v0.1.0
git push origin v0.1.0
~~~

A tag push runs the Release workflow and uploads the Chromium ZIP, three OS Host ZIPs and SHA256SUMS. Alternatively, after this workflow exists on the default branch, use GitHub Actions > Release > Run workflow with an **existing** version tag. Tag/version mismatches fail instead of shipping mismatched files. Ordinary PR builds expose the same packages as a short-lived Actions artifact called release-preview-SHA; this is not a GitHub Release. Do not tag a development branch unless you explicitly intend to release that commit.

## Quick start (macOS / Windows / Linux)

Prerequisites: Node.js 22+, pnpm 9, Chrome / Edge / Chromium, and at least one **installed and signed-in** CLI (Claude Code / Codex / AGY). Windows additionally needs Windows PowerShell 5.1 and .NET Framework for the Host installer.

~~~sh
git clone https://github.com/chenghsj/immersive-language-learning.git
cd immersive-language-learning
corepack enable
pnpm install
pnpm build
~~~

1. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `apps/extension/dist`.
2. Copy the newly loaded extension ID (32 characters).
3. Register its Native Messaging Host for your OS (append `--browser edge` for Edge or `--browser chromium` for Chromium):

~~~sh
pnpm host:install YOUR_EXTENSION_ID
~~~

4. Click the extension icon to open the Side Panel. Under **Agent 設定**, select **檢查 Native Host / CLI**.
5. In **建立教材**, import an SRT/VTT or paste text, set the title and learning profile, then generate. Files are also saved to `~/Documents/Immersive Learning`.
6. In **閱讀文件**, use **另存新檔** to choose where to download the JSON or Markdown copy.

If your browser reports a missing Native Host, confirm you installed it for the same browser and its **current extension ID**. The macOS/Linux installer writes a browser-specific NativeMessagingHosts manifest; Windows writes its path to the browser's per-user HKCU NativeMessagingHosts registry key. Re-run `pnpm build` and `pnpm host:install YOUR_EXTENSION_ID` after changing the Node installation or extension ID.

### CLI model discovery and account Profiles

In **Settings → Local CLI Agent**, check the Native Host, choose an account Profile and refresh the available CLI models. Choosing a different Profile resets the model choice. Use CLI default or custom Model ID if discovery is unavailable. The Codex debug catalog and Claude aliases are not a guarantee that an account may use the listed model.

Create and authenticate any extra account directories in Terminal before registering them in Settings:

~~~sh
mkdir -p "$HOME/.claude-work" "$HOME/.codex-work"
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
CODEX_HOME="$HOME/.codex-work" codex login
~~~

Enter a name and its absolute folder path in Settings, save it, then switch accounts from the dropdown. Only Claude/Codex profiles are supported; AGY remains on its current CLI login. Switching never runs logout, copies credentials, or changes Terminal's selected account. Removing a Profile only removes its label/path entry; the CLI directory remains.

The Host invokes a fixed `agy models` or `codex debug models` command with no shell and a timeout. Claude Code exposes `/model` interactively, so this extension offers the `sonnet`, `opus` and `haiku` CLI aliases instead of pretending to fetch account-specific entitlements. All providers retain default and custom model choices.

If you see **Specified native messaging host not found**, copy the current extension ID from `chrome://extensions` and run these commands from the project root:

~~~sh
pnpm build
pnpm host:install YOUR_EXTENSION_ID
~~~

Reload the extension. For a Release installation, use `node scripts/install-host.mjs YOUR_EXTENSION_ID` from the extracted OS Host ZIP instead of pnpm. If the extension ID changes, reinstall the Host with the new ID. Extensions cannot silently install Native Messaging Hosts.

### Accounts and models

Sign in using each CLI itself first. Model/profile defaults are remembered separately for each Agent in the Side Panel. Switching Agent does not carry over the previous Agent's model ID. A model ID is passed explicitly only when filled in; the extension queries supported CLI model catalogs when available and does **not** silently fall back to another model. To use a separate Claude or Codex profile, create and authenticate that CLI profile first, then register its existing absolute directory and name in Agent settings. The profile must be inside your home folder. AGY profile switching remains unavailable pending a supported isolation mechanism.

### Interface language and appearance

The Side Panel automatically uses Chrome's browser UI language on first launch. Supported interface languages are English, Traditional Chinese, Simplified Chinese, Japanese and Korean; unsupported browser languages fall back to English. In **Settings**, choose **Interface language → Automatic (browser language)** or override it manually. This changes only the extension's interface: the language being learned, lesson explanation language, imported subtitle text and saved documents remain independent.

Appearance defaults to **Use system setting**, following your OS light or dark appearance. You can choose Light or Dark in Settings; both language and theme preferences are saved in Chrome extension-local storage. The release ZIP also includes Chrome `_locales` metadata so the extension's displayed name and description follow supported browser languages. Chrome's interface language may require restarting the browser before its extension metadata updates.

### Video playback speed and sentence loops

In the Reader's **影片伴讀** section, choose a speed from 0.5× to 2× and click **套用播放速度**. The selection is remembered as a preference, but does not automatically change a newly opened video. Speed controls appear only when the current Video Adapter supports them. Changing speed while a sentence is looping does not intentionally stop the loop. YouTube uses the active HTML video element; Netflix uses an experimental bridge and may reject or reset the requested speed. There is no speed control for imported subtitles without an attached supported video.

### YouTube loops

Open the source YouTube watch page in Chrome before clicking **循環此句** in the Reader. The extension uses a content script **only on YouTube**, and the loop ends on manual pause/seek or when the selected repetition count is reached. A loop cannot be guaranteed if YouTube changes its player DOM. Netflix playback controls are opt-in and do not intercept keyboard shortcuts. Subtitle retrieval may temporarily select the requested language and restores the original subtitle track when the player exposes a restorable selection.

## Extensible providers

Video playback and CLI generation use separate Adapter + Registry layers. The Side Panel renders actions based on the current video adapter's supported capabilities, and the Native Host reports registered Agent adapters and installation status. See [Architecture and adding providers](docs/architecture.md) for the exact extension points and per-platform Chrome permission requirements.

Adding HBO Max or Apple TV+ requires a purpose-built adapter and an explicit browser permission review; neither service is currently implemented. An unsupported video URL falls back to subtitle import without player control.

## Engineering

~~~sh
pnpm typecheck
pnpm test
pnpm build
~~~

Packages:
- `packages/core`: shared Zod schema, subtitle parsers/chunking, time links.
- `apps/local-host`: Native Messaging framing, restricted temporary workspace, CLI adapters, Job State Machine, resumable Generation Pipeline and file-backed repository ports.
- `apps/extension`: React side panel, settings, reader, and opt-in YouTube loop content script.

Read [Scope and limitations](docs/scope.md) before using an external-model CLI with sensitive or copyrighted transcripts.

### Experimental Netflix controls

The Reader's **開啟／切換到影片** button reuses an existing tab showing the exact saved video ID before opening a new one. When multiple matching Netflix watch tabs are open, the extension prefers the active matching tab in the current window, then a unique active matching tab in another window. If the intended player is ambiguous, it asks you to switch to the correct tab or close the extra copies instead of controlling an arbitrary player or opening a third tab. A generic Netflix homepage or a different title is not treated as the same video. The extension never closes tabs on your behalf.

If a watch tab was opened before installing/reloading the extension, reload **that same tab** to initialize its content scripts. Do not open a second tab to work around a missing bridge.


Open the Netflix /watch/<video-id> page, select the learning language in **建立教材**, and click **一鍵取得目前影片字幕**. The extension reads the current playback session's available timed-text document when Netflix exposes it; it does not read protected video/audio streams. If Netflix does not expose a usable track, the UI reports the limitation instead of silently generating from incomplete captions. You may also supply a subtitle file you are permitted to process. In the Reader, open the same Netflix /watch/<video-id> URL saved with the lesson. In **閱讀文件**, select **檢查 Netflix 播放器** before clicking **跳到 Netflix 指定時間** or **循環此句**. This uses a MAIN-world bridge with Netflix's **undocumented** player session API, following the pattern in your [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override) repository. Session seek times are in milliseconds.

This is not an official Netflix API. The extension retrieves subtitle text only when you click the button; it may briefly select and then restore the requested track. It does not bypass content protection, extract audio/video or intercept the Netflix keyboard. Playback controls remain idle except when explicitly requested. Stop the loop before using other playback controls; manual pause/seek, page navigation or an unavailable player automatically cancel it. If the API changes, copy the timestamp and seek manually.

A real-browser test with your Netflix account is required: confirm successful caption retrieval, language selection, track restoration, navigation cancellation and a clear failure when Netflix's undocumented internals change. Automated CI does not test a live Netflix playback session.

### Resumable job workflow

The local Host saves snapshots under ~/Documents/Immersive Learning/jobs/ after each **validated** chapter. The Side Panel's **任務紀錄與恢復** button lists saved jobs. If Chrome closes, the Host terminates and stops generating; reopening the Side Panel allows you to continue a waiting/failed job from its checkpoint. Explicitly cancelled jobs do not resume. A completed job's document can be reopened from history. Documents are chunked across Native Messaging responses when needed, respecting Chrome's Host-to-extension message limit.

A single Host instance executes one generation at a time. Current file-backed storage is designed for one writer per job, not simultaneous editing across several independent Chrome profiles/processes. Persistent background generation and cross-device synchronization require a separate managed daemon and transactional storage in a later phase. Progress and personal annotations have a separate repository contract; a full learning-progress UI is not yet implemented.

Existing version-1 learning documents retain their original format and remain readable; future schema versions must use an explicit migration. Local canonical JSON is saved before the Markdown convenience export.

## Local-first lessons, duplicate protection and optional Drive backup

Every completed lesson is saved locally first. The Create page lets you choose a local export folder and independently enable **automatic Google Drive backup**. The backup switch checks the selected account's authorization; if no account is connected, **Connect Google Drive** opens Google's consent flow. You can read completed material immediately while its backup runs. Turning the switch off does not remove local or cloud files.

Before generation, the Host searches saved local lessons and existing app-owned Drive lessons when an account is available. It compares source and transcript, and asks before generating another version. Regeneration creates a new document ID and never silently overwrites an older lesson or its progress.

The background backup checks document identity and content hashes before uploading JSON and Markdown. Identical files are skipped; a conflicting remote version is preserved and reported rather than overwritten. If only one file uploaded, retrying fills in the missing file without regenerating the lesson. Backup status is independent of generation status. Closing the Side Panel does not interrupt an active Host task; an interrupted pending upload can resume when the extension reconnects. Closing the browser does not make the Host a permanent background service.

Task History shows generation progress, recovery and backup retry separately. **My Lessons** combines local and cloud copies of the same lesson, supports local/cloud filtering and can restore a missing local copy from an app-owned Drive file with checksum and schema validation. Settings includes connected accounts and an explicit **Back up existing lessons** action; enabling automatic backup does not silently upload the old library. Cross-device learning-progress and note synchronization are not yet implemented.

### Google Drive one-click authorization on macOS

End users do not need an OAuth Client ID, Client Secret, Google Cloud project or `.env` file. Choose **Connect Google Drive**, select an account in Google's browser consent screen and return to the extension. The Host uses PKCE with a loopback callback and stores refresh tokens in macOS Keychain. You can change the backup account or disconnect it in Settings; disconnecting does not delete Drive files. If authorization expires or the bundled OAuth client changes, reconnect the account.

Developers building the Native Host should enable Google Drive API in a Google Cloud project, configure consent for `openid`, `email` and the limited `https://www.googleapis.com/auth/drive.file` scope and create a **Desktop** OAuth client. Set `GOOGLE_OAUTH_CLIENT_ID` in a root `.env` file (see `.env.example`) or the build environment **before** running `pnpm build`. If Google responds that a Desktop client secret is missing, also configure the optional `GOOGLE_OAUTH_CLIENT_SECRET` from that same Desktop OAuth client and rebuild/reinstall the Host. Both values are embedded in the installed Host when supplied; a desktop client secret is extractable and must not be treated like a confidential backend secret. For GitHub Releases, configure the repository Actions secret `GOOGLE_OAUTH_CLIENT_ID`, and optionally `GOOGLE_OAUTH_CLIENT_SECRET` if required; the release workflow refuses to publish without the Client ID. A CI preview built without that identifier has no Google Drive authorization until a configured Host is installed. An account previously authorized with a different client ID must reconnect.

Google Drive uses the limited `drive.file` scope and can search only app-created or app-shared files, not arbitrary files in the account. Live Google authorization and upload are not exercised in CI, and OAuth credential storage currently supports macOS only. For privacy, only generate or upload transcripts you are authorized to share with the configured Agent provider.
