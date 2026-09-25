# MVP scope, security and limitations

## Supported now

- Local subtitle import (SRT/VTT/text), unchanged source cue IDs, capped input size and per-section generation.
- Claude Code, Codex and AGY noninteractive CLI adapters. No password or token handling.
- Level + target language + instruction language + per-section learning load.
- Zod-validated structured sections; saved JSON and Markdown documents.
- Vite + React + Tailwind CSS and local shadcn-style UI components. Side Panel document reading, YouTube time links, and opt-in per-cue looping on an already open YouTube watch tab.
- Experimental user-initiated Netflix diagnostics, seeking and looping on a matching open watch tab, subject to availability of its undocumented internal player session API.
- Native Host installation on macOS.

## Not implemented yet

- Google Drive OAuth/sync, remote edits, multi-device sync, browser-level persistent Job Manager/daemon, live subtitle capture from third-party players, automatic account sign-in, live model enumeration, learning progress and spaced repetition.
- Automated Netflix subtitle extraction, DRM bypass, or guaranteed Netflix seek/loop compatibility after player updates. When the unsupported playback bridge is unavailable, only manual timestamp navigation is available.
- Hosted AI API integration. Local CLI means the **CLI is local**; model inference may still run on the provider's remote servers.
- Per-user GUI selection of a persistent local directory: files are saved in ~/Documents/Immersive Learning and can be individually saved elsewhere via the browser's Save As dialog.

## Security notes

The subtitle file is untrusted input. The CLI prompt explicitly marks it as source data; the host executes a fixed command with an argument array (never a shell string), in a temporary workspace. Claude is invoked with an empty tools allowlist, Codex with a read-only sandbox, and AGY with its sandbox flag. These are **defense in depth**, not a guarantee against all tool execution or disclosure on every version/configuration; review your CLI permission configuration and don't submit secrets. No "dangerously skip permissions" flags are used.

The host validates all messages and all generated section JSON. Its Native Messaging manifest permits only the specific installed Extension ID. Messages from host to Chrome are bounded below Chrome's 1 MB maximum.

The current Host lives only while the Side Panel holds its native messaging port. Closing the panel stops the host and aborts ongoing jobs; checkpoints and true background processing are future work. Generation of very large documents may require shorter transcript ranges.

Only import transcripts/media you have rights to process. Do not bypass DRM, player protection, or site terms. For YouTube, timestamp links work independently of transcript extraction; the public YouTube captions API does not guarantee access to arbitrary videos.

## Experimental Netflix playback

The bridge is adapted from the session-oriented design in [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). A MAIN-world listener uses playerApp.getAPI().videoPlayer and chooses the session closest to the active video timestamp. It exposes only diagnostics, read-only position, play, pause, and absolute seek for explicit learning controls. A separate isolated content script handles Side Panel requests and opt-in loops. The bridge does not retrieve Netflix subtitles, inspect protected streams, or change subtitle tracks.

This is an **undocumented** Netflix interface, not a stable official API. It may fail after a player update. Stop or clear a loop on manual pause/seek, tab navigation or player failure. Playback should remain usable without the extension.
