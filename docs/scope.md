# MVP scope and limitations

## Supported

- User-triggered YouTube and experimental Netflix subtitle acquisition when the active session exposes a readable track; SRT/VTT/text import remains available.
- Bundled Pi SDK provider connections through OAuth or API keys, model selection and isolated generation sessions. Existing CLI login data is not read or changed.
- One contextual V5 lesson format with original selected subtitle cues, grounded scenes, translations, pronunciation, focused expressions and examples. Selection and each scene have durable checkpoints.
- A fixed Header and Create/Library navigation with four-category Settings and Activity. Create uses five steps, including timed analysis range selection. Library contains resumable jobs, video-grouped V5 lessons and independent custom Markdown content.
- Native Host installation and folder pickers on macOS, Windows and Linux. Local JSON/Markdown publication, duplicate checks and optional Google Drive backup with explicit retry.
- Independent `custom-v1` Prompt-to-Markdown generation, automatic segmentation/hierarchical integration, checkpoint recovery, a safe Viewer, Prompt reuse, new versions, rename, export and local deletion with retained backups.
- User-triggered YouTube playback controls and experimental Netflix controls, subject to the site's available player APIs.

## Data and compatibility

Canonical V5 documents and jobs live under `~/Documents/Contextual Language Learning/data-v5/`; custom documents/jobs use the separate `custom-v1/` namespace. Older V1/V2/V3/V4 development files stay at their original paths but are not loaded, resumed, migrated or automatically deleted. Older Drive lesson files remain untouched and are hidden from V5 library and duplicate checks. Pi credentials use the renamed configuration root; existing credentials are copied during the branding upgrade. Drive Keychain credentials are copied on first use. See the [upgrade guide](development.md#upgrade-an-older-installation). Interface settings use only `preferencesV2`; older keys remain untouched and are never read or migrated. Extension and Host require Native Messaging protocol version 6 plus matching package version.

## Limitations

- Google Drive OAuth/upload and Netflix's undocumented playback API need real-account browser acceptance. CI uses synthetic data and cannot prove live platform compatibility.
- The Host remains active while the background worker has an active Native Messaging connection; closing the browser stops it. There is no permanent daemon, two-way Drive sync, cross-device progress sync, automatic Agent sign-in, continuous subtitle capture or DRM decryption.
- SDK generation exposes no tools and loads no global Skills or project instructions. The selected provider receives submitted prompts and subtitles. Credentials remain in the product-owned Host directory and must not be included in transcripts.
- Playback support does not imply subtitle access. Any site can change its player or caption behavior. Unavailable tracks or controls must fail visibly without inventing content.
- File repositories assume one writer per job. Separate browser profiles or Host processes are not a transactional shared database.
