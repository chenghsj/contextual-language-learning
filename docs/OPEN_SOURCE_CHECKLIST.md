# Open-source release checklist

This project is still private. Complete this checklist **before** changing GitHub repository visibility or creating the first public release. This checklist is not evidence that an item has been completed.

## Project ownership and permissions

- [ ] Confirm that MIT is the intended license for *all* project-owned source and that you may publish every included dependency, asset and borrowed implementation. Review the Netflix shortcut reference and any third-party UI/icons for attribution requirements.
- [ ] Review git history, issues, workflow logs and release archives for credentials, private subtitles, internal URLs and personal files. Deleting a secret from the latest commit does not remove it from history; rotate exposed credentials.
- [ ] Check that screenshots, samples, tests and example transcripts are synthetic or licensed for redistribution.
- [ ] Decide what project title, author credit, logo and screenshots should be public. The repo is currently not made public by these files.

## Safe operation and transparency

- [ ] Confirm that PRIVACY.md matches network requests, CLI provider behavior, local retention and browser permissions in the actual release build.
- [ ] Enable GitHub private vulnerability reporting in Settings > Code security and analysis, and verify SECURITY.md gives maintainers a working private route.
- [ ] Validate Chrome Extension Manifest V3 host permissions; avoid adding broad permissions to support hypothetical future video services.
- [ ] Test Netflix playback controls and adjustable speed in a real browser, including manual seek/pause interactions and graceful fallback when private APIs are absent. Do not promise future Netflix compatibility.
- [ ] Test the matching macOS Native Host ZIP with a clean Chrome profile and a signed-in CLI Agent. Verify correct extension ID registration and no credentials inside release archives.
- [ ] Test Google Desktop OAuth with a dedicated test account: consent, PKCE, refresh, account switching, duplicate detection, failed upload and retry. Document any remaining limitations.

## Development workflow

- [ ] Merge the reviewed PR and require CI before merging future PRs.
- [ ] Commit a pnpm lockfile and change CI/Release installation to --frozen-lockfile when ready, for reproducible dependency resolution.
- [ ] Enable Dependabot and review your GitHub Actions supply-chain settings (least-privilege token, allowed actions, tag protection).
- [ ] Confirm issue/PR templates, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, PRIVACY, LICENSE, CHANGELOG and roadmap render correctly in the public repository.
- [ ] Create a release tag only after the tested source and package/manifest versions match. Download both release ZIPs, extract and check their contents, and verify SHA256SUMS.

## Publish

- [ ] Decide whether the initial release should be clearly labeled **pre-release**. Stable public release should wait for real Google Drive and Netflix integration validation.
- [ ] Make the repository public **manually** only when you intend to expose its entire current history, issues, discussions and artifacts.
- [ ] Create the matching version tag from the reviewed branch/default branch and verify GitHub Release contains Chromium ZIP, macOS Host ZIP and checksums.
- [ ] Announce the supported browsers/OS and the fact that a local CLI Agent may send transcript text to a third-party model provider.

Do not publish sample Netflix subtitles, user Google Drive data, exported lessons containing private data or credentials in examples and screenshots.
