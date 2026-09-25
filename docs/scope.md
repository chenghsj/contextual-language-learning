# MVP scope, security and limitations

## Supported now

- User-initiated one-click Netflix subtitle acquisition when the active player exposes a readable timed-text track; local SRT/VTT/text import remains available. Input is size-limited and the generated sections have durable checkpoints and job recovery.
- Claude Code, Codex and AGY noninteractive CLI adapters. No password or token handling.
- Level + target language + instruction language + per-section learning load.
- Zod-validated structured sections; saved JSON and Markdown documents.
- Vite + React + Tailwind CSS and local shadcn-style UI components. Side Panel document reading, YouTube time links, and opt-in per-cue looping on an already open YouTube watch tab.
- YouTube playback speed and experimental Netflix user-initiated diagnostics, seeking, looping and playback speed on a matching open watch tab, subject to availability of Netflix's undocumented player session API.
- Native Host installation on macOS.

## Not implemented yet

- Google Drive two-way synchronization/conflict handling, remote edits, multi-device sync, a persistent *background daemon*, continuous subtitle capture or DRM decryption, automatic Agent sign-in, and learning-progress/spaced-repetition UI.
- Guaranteed full-subtitle access on every Netflix title or Netflix-version compatibility. Automatic acquisition is limited to a user click and readable tracks in the current session; it fails visibly if subtitles are inaccessible.
- Hosted AI API integration. Local CLI means the **CLI is local**; model inference may still run on the provider's remote servers.
- Cross-platform native folder selection: the current local folder picker supports macOS only; canonical checkpoints remain in ~/Documents/Immersive Learning.

## Security notes

The subtitle file is untrusted input. The CLI prompt explicitly marks it as source data; the host executes a fixed command with an argument array (never a shell string), in a temporary workspace. Claude is invoked with an empty tools allowlist, Codex with a read-only sandbox, and AGY with its sandbox flag. These are **defense in depth**, not a guarantee against all tool execution or disclosure on every version/configuration; review your CLI permission configuration and don't submit secrets. No "dangerously skip permissions" flags are used.

The host validates all messages and all generated section JSON. Its Native Messaging manifest permits only the specific installed Extension ID. Messages from host to Chrome are bounded below Chrome's 1 MB maximum.

The Host lives only while the Side Panel holds its native messaging port. Closing the panel interrupts active CLI work, but every successfully validated chapter is checkpointed to local disk and may be resumed on user request after reopening Chrome. Native Messaging splits large document responses into bounded chunks. True background generation while the browser is closed requires a future daemon. Generation of very large documents may still require shorter transcript ranges.

Only import transcripts/media you have rights to process. Do not bypass DRM, player protection, or site terms. For YouTube, timestamp links work independently of transcript extraction; the public YouTube captions API does not guarantee access to arbitrary videos.

## Experimental Netflix playback

The bridge is adapted from the session-oriented design in [netflix-shortcut-override](https://github.com/chenghsj/netflix-shortcut-override). A MAIN-world listener uses playerApp.getAPI().videoPlayer and chooses the session closest to the active video timestamp. It exposes only diagnostics, read-only position, play, pause, and absolute seek for explicit learning controls. A separate isolated content script handles Side Panel requests and opt-in loops. An explicit **Get subtitles** action may read a session-exposed timed-text document for the chosen learning language and temporarily select that subtitle track, restoring the original selection when possible. It never accesses protected video/audio streams or decrypts DRM.

This is an **undocumented** Netflix interface, not a stable official API. It may fail after a player update. Stop or clear a loop on manual pause/seek, tab navigation or player failure. Playback should remain usable without the extension.

## Storage and duplicate safety

A user-initiated macOS folder picker, per-job destinations, limited Google Drive OAuth account selection, local/remote duplicate checks and explicit regeneration confirmation are implemented. Google Drive is an experimental user-configured integration and has not been tested against a live account. Local canonical documents and checkpoints survive cloud upload failures; publication can be retried without generating again. The extension does not scan arbitrary third-party Drive files, pick arbitrary existing Drive folders, provide full two-way sync, or continue generating after Chrome is closed.
