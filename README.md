# Immersive Language Learning

A local-first Chrome side-panel extension that turns **subtitles you have permission to use** into structured, level-appropriate language lessons using your locally installed CLI agent.

> MVP status: the working implementation covers subtitle import, three CLI adapters, lesson generation, an interactive reader, YouTube timestamp links/opt-in loop playback, and local JSON/Markdown export. Automatic Netflix subtitle retrieval and a durable background daemon are **not implemented**. Google Drive OAuth, multi-account selection and upload are experimental: a user-configured Desktop OAuth client and live account testing are required. Generated chapters and jobs now have durable local checkpoints; reopening Chrome can resume interrupted work **on user request**.

## Open source and project status

This repository is currently **private** while the initial MVP is reviewed. Adding a license and contributor files does not make it public. See the [MIT license](LICENSE), [contribution guide](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), [privacy and data handling](PRIVACY.md), [changelog](CHANGELOG.md), [roadmap](docs/ROADMAP.md) and [open-source readiness checklist](docs/OPEN_SOURCE_CHECKLIST.md).

**No production-ready Google Drive or Netflix compatibility guarantee:** Google OAuth and Netflix's undocumented playback API require manual platform testing before a public stable release. This project is not affiliated with the streaming platforms or model providers.

## Features

- Import SRT, VTT, or pasted text. Original subtitles and timestamps remain unchanged.
- Select target language (English/Japanese/Korean), level, **instruction language**, teaching mode, vocabulary cap, and exercises per section.
- Pick Claude Code, Codex, or AGY. Leave model blank to use the selected CLI's default model, or enter an explicit model ID.
- Optionally isolate Claude/Codex accounts using an existing config directory under your home directory. AGY uses its current CLI login.
- Native Messaging bridge to a macOS host; no API keys or CLI credentials are stored in the extension.
- Run a checkpointed generation pipeline: chunk subtitles, validate AI sections with Zod, save each successful chapter, then export the JSON/Markdown document. Reopen the Side Panel and use **任務紀錄與恢復** to resume interrupted/failed jobs.
- Open YouTube timestamp links in a new tab; optionally control an already-open YouTube tab for sentence looping and user-triggered playback speed (0.5×–2×).
- Netflix has optional, user-initiated seek, per-sentence looping and playback speed (0.5×–2×) via an experimental internal player bridge adapted from [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). It never extracts Netflix subtitles, bypasses DRM, intercepts keyboard shortcuts or opens a second playback session.

## Install from GitHub Release (Chromium + macOS)

After a version tag is published, go to [GitHub Releases](https://github.com/chenghsj/immersive-language-learning/releases) and download these matching assets:

- immersive-language-learning-chromium-VERSION.zip — Chrome / Edge Chromium Manifest V3 extension.
- immersive-language-learning-macos-host-VERSION.zip — bundled local CLI Native Host and installer for macOS.
- SHA256SUMS — SHA-256 checksums for the two ZIP files.

Extract the **Chromium** ZIP, open chrome://extensions, enable Developer mode, select **Load unpacked**, and choose the extracted folder with manifest.json at its root. The ZIP is not a signed CRX and is not installed by dragging it into Chrome.

Copy the new extension's 32-character ID from Chrome's extension details. Extract the **macOS Host** ZIP separately and run this from inside its extracted folder (Node.js 22+ required):

~~~sh
node scripts/install-host.mjs YOUR_EXTENSION_ID
~~~

The installer copies the Host to a permanent location under your user Library and registers the extension ID with Chrome Native Messaging. You can remove the Host extraction afterward. Install and sign in to a supported CLI Agent separately; the release contains no API keys or account tokens. To update the unpacked extension, extract the new Chromium ZIP into the **same** extension folder and reload it; if Chrome assigns a different extension ID, run the Host installer again with the new ID.

### Publishing the Chromium release

The workflow at .github/workflows/release.yml follows the ZIP packaging used by the netflix-shortcut-override project, but also includes our required macOS Host. It runs the normal typecheck, tests, build, extension/host checks, ZIP integrity checks, and SHA-256 verification before creating or updating a GitHub Release.

First merge the tested PR into main. Make sure package.json and apps/extension/public/manifest.json have the same version, then create and push the matching version tag:

~~~sh
git switch main
git pull
git tag v0.1.0
git push origin v0.1.0
~~~

A tag push runs the Release workflow and uploads both ZIPs and SHA256SUMS. Alternatively, after this workflow exists on the default branch, use GitHub Actions > Release > Run workflow with an **existing** version tag. Tag/version mismatches fail instead of shipping mismatched files. Ordinary PR builds expose the same packages as a short-lived Actions artifact called release-preview-SHA; this is not a GitHub Release. Do not tag a development branch unless you explicitly intend to release that commit.

## Quick start (macOS)

Prerequisites: Node.js 22+, pnpm 9, Chrome, and at least one **installed and signed-in** CLI (Claude Code / Codex / AGY).

~~~sh
git clone https://github.com/chenghsj/immersive-language-learning.git
cd immersive-language-learning
git switch feat/immersive-learning-mvp  # until the pull request is merged
corepack enable
pnpm install
pnpm build
~~~

1. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `apps/extension/dist`.
2. Copy the newly loaded extension ID (32 characters).
3. Register its macOS native messaging host:

~~~sh
pnpm host:install YOUR_EXTENSION_ID
~~~

4. Click the extension icon to open the Side Panel. Under **Agent 設定**, select **檢查 Native Host / CLI**.
5. In **建立教材**, import an SRT/VTT or paste text, set the title and learning profile, then generate. Files are also saved to `~/Documents/Immersive Learning`.
6. In **閱讀文件**, use **另存新檔** to choose where to download the JSON or Markdown copy.

If Chrome reports a missing native host, verify that `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.immersive.language_learning.json` includes your current extension ID and points to the generated executable launcher. Rerun `pnpm build` and `pnpm host:install YOUR_EXTENSION_ID` after relocating the repository or changing Node installations.

### Accounts and models

Sign in using each CLI itself first. Model/profile defaults are remembered separately for each Agent in the Side Panel. Switching Agent does not carry over the previous Agent's model ID. A model ID is passed explicitly only when filled in; the extension does **not** fabricate a live model list or silently fall back to another model. To use a separate Claude or Codex profile, create and authenticate that CLI profile first, then enter the existing absolute directory in Agent settings. The profile must be inside your home folder. AGY profile switching remains unavailable pending a supported isolation mechanism.

### Video playback speed and sentence loops

In the Reader's **影片伴讀** section, choose a speed from 0.5× to 2× and click **套用播放速度**. The selection is remembered as a preference, but does not automatically change a newly opened video. Speed controls appear only when the current Video Adapter supports them. Changing speed while a sentence is looping does not intentionally stop the loop. YouTube uses the active HTML video element; Netflix uses an experimental bridge and may reject or reset the requested speed. There is no speed control for imported subtitles without an attached supported video.

### YouTube loops

Open the source YouTube watch page in Chrome before clicking **循環此句** in the Reader. The extension uses a content script **only on YouTube**, and the loop ends on manual pause/seek or when the selected repetition count is reached. A loop cannot be guaranteed if YouTube changes its player DOM. Netflix controls are opt-in and do not modify subtitles or intercept keyboard shortcuts.

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

Open the same Netflix /watch/<video-id> URL saved with your authorized subtitle file. In **閱讀文件**, select **檢查 Netflix 播放器** before clicking **跳到 Netflix 指定時間** or **循環此句**. This uses a MAIN-world bridge with Netflix's **undocumented** player session API, following the pattern in your [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override) repository. Session seek times are in milliseconds.

This is not an official Netflix API. The extension does **not** download Netflix subtitles, modify subtitle tracks, bypass content protection, or intercept the Netflix keyboard. The bridge remains idle except when you explicitly diagnose, seek or start a loop. Stop the loop before using other playback controls; manual pause/seek, page navigation or an unavailable player automatically cancel it. If the API changes, copy the timestamp and seek manually.

A real-browser smoke test with your Netflix account is required; automated CI does not test a live Netflix playback session.

### Resumable job workflow

The local Host saves snapshots under ~/Documents/Immersive Learning/jobs/ after each **validated** chapter. The Side Panel's **任務紀錄與恢復** button lists saved jobs. If Chrome closes, the Host terminates and stops generating; reopening the Side Panel allows you to continue a waiting/failed job from its checkpoint. Explicitly cancelled jobs do not resume. A completed job's document can be reopened from history. Documents are chunked across Native Messaging responses when needed, respecting Chrome's Host-to-extension message limit.

A single Host instance executes one generation at a time. Current file-backed storage is designed for one writer per job, not simultaneous editing across several independent Chrome profiles/processes. Persistent background generation and cross-device synchronization require a separate managed daemon and transactional storage in a later phase. Progress and personal annotations have a separate repository contract; a full learning-progress UI is not yet implemented.

Existing version-1 learning documents retain their original format and remain readable; future schema versions must use an explicit migration. Local canonical JSON is saved before the Markdown convenience export.

## Choose destination and prevent duplicate generation

The Create page offers an explicit macOS folder picker or a Google Drive account. The Host stores the selected destination with each generation job. It retains the canonical JSON document and validated chapter checkpoints in the local document library, even when publishing to another folder or Drive. A selected local folder receives JSON and Markdown copies; an authorized Google account receives JSON and Markdown in an app-created Immersive Learning folder. Google Drive for desktop folders may also be selected through the local picker, but this is local synchronization rather than Drive API account authorization.

Before generating, the Host checks saved documents and jobs, and checks app-created files in the selected Google Drive account when applicable. It uses source identity and subtitle content, not merely the filename. The Side Panel displays matches and requires an explicit regeneration confirmation. The preflight ticket is tied to the original request and Native Messaging connection; a changed request or newly found duplicate requires another check. Regeneration creates a new document ID and never overwrites earlier material or learning progress.

If publication fails, the local document remains complete. Use the job-history Publish Again action to retry the original destination without calling the Agent again.

### Google Drive account setup on macOS

1. Enable Google Drive API in a Google Cloud project. Configure the OAuth consent screen with openid, email, and the limited https://www.googleapis.com/auth/drive.file scope. Create a Desktop OAuth client. Add test users when the consent screen is in Testing mode.
2. In the extension Settings page, enter that Desktop OAuth Client ID. If Google requires its generated Desktop Client Secret for token exchange, enter it there as well. These values are sent to the local Host and are not stored in Chrome Storage.
3. Choose Connect Google Account. Your browser opens a PKCE flow with a local loopback callback. Connect each account separately, then select its email in the destination dropdown.
4. The Host stores refresh tokens in macOS Keychain and keeps the account metadata in the user-only application-support directory. Changing the default account does not move old jobs to another account.

Google Drive integration uses the limited drive.file scope and can only search app-created or app-shared files, not every file in the account. Authorization and upload have not been tested against a live Google account in CI. For privacy, choose only transcripts you are authorized to send to your configured Agent provider.
