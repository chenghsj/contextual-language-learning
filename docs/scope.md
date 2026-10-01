# MVP scope and limitations

## Supported

- User-triggered YouTube and experimental Netflix subtitle acquisition when the active session exposes a readable track; SRT/VTT/text import remains available.
- Bundled Pi SDK provider connections through OAuth or API keys, model selection and isolated generation sessions. Existing CLI login data is not read or changed.
- One contextual V5 lesson format with complete original subtitle cues, grounded scenes, translations, pronunciation, focused expressions and examples. Selection and each scene have durable checkpoints.
- A three-destination Side Panel: Create, Library and Settings. Library contains resumable V5 jobs, video-grouped lessons and the reader detail view.
- Native Host installation and folder pickers on macOS, Windows and Linux. Local JSON/Markdown publication, duplicate checks and optional Google Drive backup with explicit retry.
- User-triggered YouTube playback controls and experimental Netflix controls, subject to the site's available player APIs.

## Data and compatibility

Canonical V5 documents and jobs live under `~/Documents/Immersive Learning/data-v5/`. Older V1/V2/V3/V4 development files stay at their original paths but are not loaded, resumed, migrated or automatically deleted. Older Drive lesson files remain untouched and are hidden from V5 library and duplicate checks. Pi and Drive credentials remain in their existing locations. Interface settings use only `preferencesV2`; older keys remain untouched and are never read or migrated. Extension and Host require Native Messaging protocol version 4 plus matching package version.

## Limitations

- Google Drive OAuth/upload and Netflix's undocumented playback API need real-account browser acceptance. CI uses synthetic data and cannot prove live platform compatibility.
- The Host remains active while the background worker has an active Native Messaging connection; closing the browser stops it. There is no permanent daemon, two-way Drive sync, cross-device progress sync, automatic Agent sign-in, continuous subtitle capture or DRM decryption.
- SDK generation exposes no tools and loads no global Skills or project instructions. The selected provider receives submitted prompts and subtitles. Credentials remain in the product-owned Host directory and must not be included in transcripts.
- Playback support does not imply subtitle access. Any site can change its player or caption behavior. Unavailable tracks or controls must fail visibly without inventing content.
- File repositories assume one writer per job. Separate browser profiles or Host processes are not a transactional shared database.
