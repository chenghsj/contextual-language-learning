# Development and installation

[Back to README](../README.md)

The current development version is on [`codex/core-redesign`](https://github.com/chenghsj/contextual-language-learning/tree/codex/core-redesign). The instructions below install that version. Ready-to-use installation packages have not been published yet.

## Install from source

### Requirements

- Node.js 22+ and pnpm 9.15.4.
- Chrome, Edge or Chromium on macOS, Windows or Linux.
- macOS: Xcode Command Line Tools to build the native helpers.
- Windows: Windows PowerShell 5.1 and .NET Framework for the Host installer.
- Linux: an unlocked Secret Service session and `secret-tool` for AI credentials. Folder selection also needs `zenity` or `kdialog`.

### Build

```sh
git clone --branch codex/core-redesign https://github.com/chenghsj/contextual-language-learning.git
cd contextual-language-learning
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm build
```

### Load the extension and connect the local service

1. Open `chrome://extensions` in Chrome, or the extensions page in your browser.
2. Enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.
3. Copy the extension's 32-character ID.
4. Register the local service for that ID and browser:

```sh
# Chrome
pnpm host:install YOUR_EXTENSION_ID

# Edge
pnpm host:install YOUR_EXTENSION_ID --browser edge

# Chromium
pnpm host:install YOUR_EXTENSION_ID --browser chromium
```

5. Open the side panel and check the local service connection in **Settings**.
6. In **AI services**, connect a supported account or API key and select a model. A separate Pi, Codex or Claude CLI is not required. See [local model setup](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/local-models.md) for Ollama, LM Studio and compatible servers.
7. Reload an already-open YouTube or Netflix video tab, then retrieve or import subtitles and create content.

If the local service is missing, confirm that its registration uses the same browser and current extension ID. Rebuild and reinstall after changing the Node installation, extension ID or Host source. Keep the extension and local service from the same build.

## Development workflow

```sh
pnpm dev
```

Load `apps/extension/dist-dev` as an unpacked extension and keep the terminal running. This folder has its own extension ID; register that ID if you need the real local service. React and CSS changes update automatically. After changing background code or video-page bridges, reopen the side panel and reload the video tab as needed.

For a standalone UI preview with simulated browser and Host data:

```sh
pnpm dev:preview
```

The preview opens at `http://127.0.0.1:5175/dev/redesign-preview.html`. It does not connect to real video tabs, AI accounts or Drive files. Host changes require a rebuild and reinstall.

### Checks

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
node apps/extension/scripts/check-build.mjs
node apps/local-host/scripts/smoke-host.mjs
```

Automated checks do not establish compatibility with a real AI account, Google OAuth, an installed browser extension or every supported operating system.

## Optional Google Drive backup

Local lessons work without Drive. To enable Drive authorization in a source build:

1. Enable the Google Drive API in a Google Cloud project and configure consent for `openid`, `email` and `drive.file`.
2. Create a **Desktop** OAuth client. Copy `.env.example` to `.env` and set `GOOGLE_OAUTH_CLIENT_ID` before building. Set the optional `GOOGLE_OAUTH_CLIENT_SECRET` only if the Desktop token flow requires it. Desktop client values are embedded in the build and are extractable.
3. Rebuild and reinstall the local service. In the extension's Drive settings, connect an account and explicitly enable backup.

Keep `.env` out of Git. Changing the client ID requires reconnecting accounts. The `drive.file` scope covers app-created or app-shared files rather than arbitrary Drive files. AI credentials use the operating system's credential storage; see [credential storage and migration](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/ai-credential-storage.md).

## Upgrade an older installation

Rebuild and reload the extension, then reinstall the matching local service for the current browser and extension ID. Reload open video tabs as well.

On first launch, the renamed Host copies existing `Immersive Learning` settings and document directories to `Contextual Language Learning`, keeping the originals. Conflicting files stop startup for manual resolution. The name change does not convert lesson schemas or resume legacy CLI jobs.

AI credentials migrate to operating-system storage as described in the [credential migration guide](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/ai-credential-storage.md). Stop older Host versions before migrating. Existing Google Drive credentials and backups retain compatibility with the old product name.

## Build local setup packages

After building the Host, create a setup ZIP for the current OS and processor:

```sh
pnpm package:host-setup --extension-id YOUR_EXTENSION_ID
```

Output is written to `release-assets/`. Extract the ZIP completely and open `CLL 本機服務.app` on macOS, `Setup.exe` on Windows or `CLL Setup.desktop` on Linux. Linux setup requires a graphical desktop and `xdg-open`.

The ZIP includes Node.js. Choose the browser in the setup window and install. Use the same setup program to update or uninstall; uninstalling preserves lessons and settings. Local packages are unsigned. See [packaging and verification details](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/host-setup.md).

## Publish a release

Merge and validate the intended version on `main` first. The tag, root `package.json` version and extension manifest version must match.

Configure the supported store extension IDs through repository variables `CLL_CHROME_EXTENSION_ID`, `CLL_EDGE_EXTENSION_ID` and/or `CLL_CHROMIUM_EXTENSION_ID`. The release workflow also requires the `GOOGLE_OAUTH_CLIENT_ID` Actions secret; `GOOGLE_OAUTH_CLIENT_SECRET` is optional when required by the Desktop client.

```sh
git switch main
git pull --ff-only
# Replace VERSION with the matching package version.
git tag vVERSION
git push origin vVERSION
```

The [Release workflow](../.github/workflows/release.yml) builds and checks the extension and platform packages before publishing GitHub Release assets and `SHA256SUMS`. A manual run must use an existing matching tag. Ordinary CI preview artifacts are temporary downloads, not a public release. Complete platform acceptance and signing/notarization before distributing a stable build. GitHub Releases, browser stores and TestFlight/App Store publication are separate steps.

## Project layout and further reading

Paths below refer to the development version cloned above.

| Path                                | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `apps/extension`                    | Browser side panel, content creation, settings and reading              |
| `apps/local-host`                   | AI connections, generation, local storage and operating-system services |
| `apps/web`                          | Web reader preview                                                      |
| `apps/ios`                          | iPhone/iPad reader preview                                              |
| `packages/core`                     | Shared schemas, subtitle parsing and data contracts                     |
| `packages/reader-ui`, `packages/ui` | Shared reader and interface components                                  |

- [Architecture and data policies](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/architecture.md)
- [Web reader](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/docs/favorites-web-implementation.md)
- [iPhone/iPad setup and verification limits](https://github.com/chenghsj/contextual-language-learning/blob/codex/core-redesign/apps/ios/README.md)
- [Product UI standards](../DESIGN.md)
- [Contribution guide](../CONTRIBUTING.md)
- [Privacy](../PRIVACY.md) and [security](../SECURITY.md)
