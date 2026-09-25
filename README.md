# Immersive Language Learning

A local-first Chrome side-panel extension that turns **subtitles you have permission to use** into structured, level-appropriate language lessons using your locally installed CLI agent.

> MVP status: the working implementation covers subtitle import, three CLI adapters, lesson generation, an interactive reader, YouTube timestamp links/opt-in loop playback, and local JSON/Markdown export. Google Drive, automatic Netflix subtitle retrieval, graphical multi-account login, and a durable background daemon are **not implemented**.

## Features

- Import SRT, VTT, or pasted text. Original subtitles and timestamps remain unchanged.
- Select target language (English/Japanese/Korean), level, **instruction language**, teaching mode, vocabulary cap, and exercises per section.
- Pick Claude Code, Codex, or AGY. Leave model blank to use the selected CLI's default model, or enter an explicit model ID.
- Optionally isolate Claude/Codex accounts using an existing config directory under your home directory. AGY uses its current CLI login.
- Native Messaging bridge to a macOS host; no API keys or CLI credentials are stored in the extension.
- Chunk transcripts and validate every AI-generated section with Zod. Export the full structured document as JSON or Markdown.
- Open YouTube timestamp links in a new tab; optionally control an already-open YouTube tab for sentence looping.
- Netflix has optional, user-initiated seek and per-sentence looping via an experimental internal player bridge adapted from [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). It never extracts Netflix subtitles, bypasses DRM, intercepts keyboard shortcuts or opens a second playback session.

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

1. Open \`chrome://extensions\`, enable Developer mode, click **Load unpacked**, and select \`apps/extension/dist\`.
2. Copy the newly loaded extension ID (32 characters).
3. Register its macOS native messaging host:

~~~sh
pnpm host:install YOUR_EXTENSION_ID
~~~

4. Click the extension icon to open the Side Panel. Under **Agent 設定**, select **檢查 Native Host / CLI**.
5. In **建立教材**, import an SRT/VTT or paste text, set the title and learning profile, then generate. Files are also saved to \`~/Documents/Immersive Learning\`.
6. In **閱讀文件**, use **另存新檔** to choose where to download the JSON or Markdown copy.

If Chrome reports a missing native host, verify that \`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.immersive.language_learning.json\` includes your current extension ID and points to the generated executable launcher. Rerun \`pnpm build\` and \`pnpm host:install YOUR_EXTENSION_ID\` after relocating the repository or changing Node installations.

### Accounts and models

Sign in using each CLI itself first. A model ID is passed explicitly only when filled in; the extension does **not** fabricate a live model list or silently fall back to another model. To use a separate Claude or Codex profile, create and authenticate that CLI profile first, then enter the existing absolute directory in Agent settings. The profile must be inside your home folder. AGY profile switching remains unavailable pending a supported isolation mechanism.

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
- \`packages/core\`: shared Zod schema, subtitle parsers/chunking, time links.
- \`apps/local-host\`: Native Messaging framing, restricted temporary workspace, CLI adapters and document generation.
- \`apps/extension\`: React side panel, settings, reader, and opt-in YouTube loop content script.

Read [Scope and limitations](docs/scope.md) before using an external-model CLI with sensitive or copyrighted transcripts.

### Experimental Netflix controls

Open the same Netflix /watch/<video-id> URL saved with your authorized subtitle file. In **閱讀文件**, select **檢查 Netflix 播放器** before clicking **跳到 Netflix 指定時間** or **循環此句**. This uses a MAIN-world bridge with Netflix's **undocumented** player session API, following the pattern in your [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override) repository. Session seek times are in milliseconds.

This is not an official Netflix API. The extension does **not** download Netflix subtitles, modify subtitle tracks, bypass content protection, or intercept the Netflix keyboard. The bridge remains idle except when you explicitly diagnose, seek or start a loop. Stop the loop before using other playback controls; manual pause/seek, page navigation or an unavailable player automatically cancel it. If the API changes, copy the timestamp and seek manually.

A real-browser smoke test with your Netflix account is required; automated CI does not test a live Netflix playback session.
