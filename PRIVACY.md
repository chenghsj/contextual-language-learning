# Privacy and Data Handling

This policy describes the current open-source application's behavior, not the privacy practices of Google, Netflix, YouTube or your chosen AI model provider. It is not a promise about future versions. See [the source](apps/) and [scope and limitations](docs/scope.md).

## What the extension and local Host handle

- **Subtitles and learning documents:** You import or paste SRT/VTT/text, or explicitly request readable Netflix captions from the currently playing video. The local Host stores the original transcript, generation settings, section checkpoints, generated lessons and export files under your selected folders and/or the local document library. It may include timestamps, source URLs, expressions and personal notes or progress if you add them.
- **Preferences:** The Extension stores learning settings, chosen Agent/model/profile and playback preferences using chrome.storage.local. The Side Panel sends job requests to the local Native Messaging Host.
- **Local account settings:** The Host stores connected Google account metadata and Desktop OAuth client configuration in your macOS user application-support directory. Google refresh tokens are stored in macOS Keychain; Chrome storage does not receive them. Pi provider API keys and OAuth tokens are stored in the product-owned pi/auth.json file with restrictive filesystem permissions. Login fields are forwarded transiently to the Host and are never saved in Chrome storage or job checkpoints. Existing CLI credential stores are not read or changed.
- **Playback:** The Extension operates on selected YouTube/Netflix tabs for user-triggered navigation, speed changes and optional looping. A separate, user-triggered Netflix caption request may use the active playback session to obtain a readable timed-text subtitle document, temporarily select the requested subtitle track, and restore the previous track when the player permits it. No continuous transcript harvesting, video/audio extraction or playback-protection bypass is implemented.

## When information leaves your computer

When you start generation, the bundled Pi SDK sends subtitle text, surrounding context and generation instructions to your selected provider under its privacy and retention terms. Review those terms before submitting confidential material.

If you authorize Google Drive, the Host connects to Google for account authorization and API operations and uploads the selected document's JSON and Markdown, which may contain the complete imported transcript. It uses the limited drive.file scope for files created/opened through this app. Switching Google accounts only changes where a new job is published; checkpoints remain local.

Using Netflix or YouTube also involves those sites' normal first-party network activity and policies. The application does not implement its own analytics, advertising or telemetry service in the current source. It does not control the selected provider's collection or logging.

## Permissions

The Manifest V3 Extension uses sidePanel for the reader, nativeMessaging for the local Host, storage for preferences, tabs for matching an open video and downloads for user-requested exports. Host permissions/content scripts are limited to declared YouTube and Netflix domains for playback and optional caption integration. After your click, the extension's background worker may request a signed timed-text document from Netflix-owned delivery domains (`nflxvideo.net`, `nflximg.net`, `nflxext.com` or `netflix.com`), using the browser's existing session where applicable. Host permissions are restricted to those domains and do not permit unrelated sites; the worker rejects other URLs, redirects and oversized responses. Chrome may require you to approve the added Netflix CDN permissions after an update. No subtitle text is sent to the Native Host until you start a generation job. Adding a future service requires an explicit permission review.

## Retention and deletion

Local documents and checkpoints remain until you delete them from the local library or chosen folder. Chrome preferences can be cleared in browser extension storage. Removing the Extension does not automatically delete copied learning files, Native Host files, CLI credentials or Google tokens. Removing Google authorization in your Google account prevents further API access; deleting a Keychain token and local account metadata may require manual action. AI service disconnect deletes this product's saved provider credential; it does not revoke provider authorization or erase remote data. There is no guaranteed cross-service erasure workflow.

Before publishing a bug report or contributing a test, replace real transcripts, account emails, tokens and private source URLs with synthetic data. Contact external model/Drive providers directly for requests governed by their own privacy policies.
