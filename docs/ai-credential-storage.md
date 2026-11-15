# AI credential storage

AI API keys and OAuth credentials are supplied to Pi through a product-owned
`CredentialStore`; the SDK's plaintext `AuthStorage` is no longer used by the Host.

| Platform | Storage                                                  | Requirements                                                                                                                                              |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Login Keychain, generic password item                    | Bundled `macos-credentials` helper; unlocked login Keychain and allowed access                                                                            |
| Windows  | DPAPI `CurrentUser` ciphertext in `pi/credentials.dpapi` | Built-in Windows PowerShell and the Windows user profile that saved the credentials                                                                       |
| Linux    | Secret Service item                                      | `/usr/bin/secret-tool` (`libsecret-tools` on Debian/Ubuntu), a running compatible service such as GNOME Keyring, and an unlocked collection/session D-Bus |

No platform falls back to plaintext or an application-managed encryption key.
The Keychain/Secret Service service ID is `dev.contextual.language-learning.ai.v1`;
the account is the SHA-256 of the absolute Pi configuration directory, isolating
development roots. Secrets travel to helpers only on stdin, never in command-line
arguments or environment variables. Helper failures expose fixed diagnostics.
Keychain entries are explicitly non-synchronizing. Windows ciphertext is not a
portable credential backup. Linux headless environments require their own unlocked
Secret Service session; installing the CLI alone is insufficient.

All reads and read/modify/write operations use a process-local queue plus a
cross-process file lock with a heartbeat. OAuth refresh runs inside that lock and
is persisted before release. Concurrent read-only SDK lookups share one in-flight
locked snapshot, avoiding a separate system-store call for every provider. The
snapshot is discarded as soon as the read finishes; subsequent reads consult
system storage again. Mutations invalidate pending batches so later reads queue
behind the change. Cancellation affects only that reader, and returned credentials
are copied per caller. Logout removes the provider from the secure payload;
it does not revoke the provider-side credential. Only non-secret markers/locks
(and DPAPI ciphertext on Windows) are written to the configuration directory.

On first access, `pi/auth.json` and the retained `Immersive Learning` branding copy
are merged into the secure store. The current branding wins over the old copy;
already secured credentials win on interrupted migration. Full credential objects,
including provider-specific OAuth fields and API-key configuration values, survive.
The store verifies a secure readback before removing plaintext originals. Invalid
data, denied access, write/readback failure or concurrent source changes preserve
the affected source for recovery. Credential commands (`!…`) are rejected, never
executed. After migration completes, a reappearing `auth.json` is rejected to
prevent an old Host from restoring a logged-out credential. Stop older Host
versions before upgrading. Historical backups outside these known paths are not
searched or deleted, and file deletion cannot erase historical disk snapshots.

If the system item disappears after initialization, the store fails closed rather
than silently creating an empty replacement. Restore/unlock the system store.
If credentials were intentionally deleted and cannot be restored, stop the Host,
remove only the non-secret `pi/credentials-v1` marker, restart, and reconnect.
Keep `credential-migration-v1` to prevent old plaintext credentials being reimported.

macOS helper builds are universal (arm64/x86_64, macOS 13+) and included in setup
archives, install/update copies and bundle revision hashes. An updated ad-hoc-signed
helper may require Keychain access approval again. OS credential storage protects
data at rest; it does not make an already compromised user session trustworthy.

Validation uses injected fake vaults for migration, failure and concurrency tests,
contract tests for each backend, and a Windows-only native DPAPI round-trip. The
macOS helper is compiled locally; an isolated disposable Keychain item passed
native write/read/update acceptance and was removed afterward. Windows and Linux require native acceptance on
their respective systems; contract tests do not establish that desktop services
are installed or unlocked.

References: [Apple Keychain Services](<https://developer.apple.com/documentation/security/secitemadd(_:_:)>),
[Windows ProtectedData / DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata),
[secret-tool](https://manpages.debian.org/trixie/libsecret-tools/secret-tool.1.en.html).
