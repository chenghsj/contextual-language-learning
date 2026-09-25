# Privacy and Data Handling

This policy describes the current open-source application's behavior, not the privacy practices of Google, Netflix, YouTube or your chosen AI model provider. It is not a promise about future versions. See [the source](apps/) and [scope and limitations](docs/scope.md).

## What the extension and local Host handle

- **Subtitles and learning documents:** You import or paste SRT/VTT/text. The local Host stores the original transcript, generation settings, section checkpoints, generated lessons and export files under your selected folders and/or the local document library. It may include timestamps, source URLs, expressions and personal notes or progress if you add them.
- **Preferences:** The Extension stores learning settings, chosen Agent/model/profile and playback preferences using chrome.storage.local. The Side Panel sends job requests to the local Native Messaging Host.
- **Local account settings:** The Host stores connected Google account metadata and Desktop OAuth client configuration in your macOS user application-support directory. Google refresh tokens are stored in macOS Keychain; Chrome storage does not receive them. CLI authentication remains managed by each CLI's own credential store.
- **Playback:** The Extension operates on the selected YouTube/Netflix tabs for user-triggered navigation, speed changes and optional looping. It does not automatically download Netflix subtitles or bypass playback protection.

## When information leaves your computer

**A locally installed CLI does not imply local model inference.** When you start generation, the selected CLI may send subtitle text, its surrounding context and generation instructions to its own model provider under that provider's privacy and retention terms. Review the CLI's configuration before submitting confidential or copyrighted material.

If you authorize Google Drive, the Host connects to Google for account authorization and API operations and uploads the selected document's JSON and Markdown, which may contain the complete imported transcript. It uses the limited drive.file scope for files created/opened through this app. Switching Google accounts only changes where a new job is published; checkpoints remain local.

Using Netflix or YouTube also involves those sites' normal first-party network activity and policies. The application does not implement its own analytics, advertising or telemetry service in the current source. It does not control any external CLI/provider's collection or logging.

## Permissions

The Manifest V3 Extension uses sidePanel for the reader, nativeMessaging for the local Host, storage for preferences, tabs for matching an open video and downloads for user-requested exports. Host permissions/content scripts are limited to declared YouTube and Netflix domains for video playback integration. Adding a future service requires an explicit permission review.

## Retention and deletion

Local documents and checkpoints remain until you delete them from the local library or chosen folder. Chrome preferences can be cleared in browser extension storage. Removing the Extension does not automatically delete copied learning files, Native Host files, CLI credentials or Google tokens. Removing Google authorization in your Google account prevents further API access; deleting a Keychain token and local account metadata may require manual action. The current application has no one-click account-disconnect or guaranteed cross-service erasure workflow.

Before publishing a bug report or contributing a test, replace real transcripts, account emails, tokens and private source URLs with synthetic data. Contact external model/Drive providers directly for requests governed by their own privacy policies.
