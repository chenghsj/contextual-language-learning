# Security Policy

## Supported versions

This project is in pre-release development. Security fixes target the latest development branch and, once published, the most recent GitHub Release. Older ZIPs and undocumented Netflix APIs are not guaranteed to remain supported.

## Reporting a vulnerability

**Do not publish a vulnerability or exploit in a public issue, pull request, discussion or screenshot.** If this repository exposes GitHub's **Security > Advisories > Report a vulnerability**, use that private reporting channel and include a concise reproduction and impact. If private reporting is not enabled, request a private contact method from the maintainer without including exploit details. Enable private vulnerability reporting before changing this repository from private to public.

Useful report details: affected version/commit, OS, Chrome version, reproduction with synthetic captions, expected and actual behavior, potential credential/file exposure and suggested mitigation. Never include usable OAuth tokens, personal Google Drive documents, CLI account credentials or licensed streaming subtitles.

## Security boundaries

- Imported subtitles and model outputs are untrusted. Do not obey instructions embedded in media or permit arbitrary tool/executable selection.
- The Native Host is installed for an explicit extension ID. Treat its manifest and executable path as security-sensitive.
- CLI execution must use fixed trusted adapters and argument arrays with no shell interpolation; model CLI permissions must be reviewed separately.
- Local canonical learning documents, job checkpoints and selected output folders may contain complete transcripts. Protect and delete those files according to your own retention needs.
- Google account refresh tokens are stored through macOS Keychain; Drive publishing is opt-in and uses the limited drive.file scope. Never paste real credentials into an issue or PR.
- Netflix player controls use an undocumented internal API and may change without notice. Do not attempt DRM bypass or protected subtitle extraction.
- Revoke a Google OAuth grant using your Google Account's third-party access controls when necessary. In-app account disconnect and full data erasure are not yet implemented.

If you discover unexpected network transmission or credential exposure, stop the affected workflow and use the private disclosure channel.
