# Siri explicit deletion repair

The available list displayed a persisted completed task as current installation state. Actual macOS logs also showed Samer physically removed at 14:22:15 and downloaded again at 14:22:59 while our per-operation subscription remained.

The list now derives current availability from the catalog and hides a completed historical task in the available list. Activity retains the completed record. Explicit removal withdraws and durably fences only matching application requests whose private receipts identify the selected physical resource. Unknown matching application clients and unresolved start ordering block purge. Foreign clients remain untouched. Cancellation never purges resources.

The native boundary shares an outer resource-changes lock with both modern and legacy starts. Existing operation locks protect each receipt. Physical resource matching spans content versions and exact catalog aliases. Withdrawal uses the frozen receipt identity, including for retired aliases. A later explicit start serialized after removal is allowed. Success proves physical absence at the time of checking; other applications may legitimately cause macOS to download a shared resource later.

## Runtime verification

The installed helper SHA256 is `8cf5037d305341732f2a1eaf1e1409d26bccf4bcd66d621d2858554cafa47e6e`. Only the helper was atomically replaced; the existing Host bundle and user data were preserved. The user's selected Samer resource was removed through the installed helper at 14:53:12. Readback at 14:54:14, approximately 62 seconds after completion, confirmed installed=false and resourceAvailable=false. Its operation receipt was fenced and its subscription absent. Original Nora and Helena subscriptions were byte-for-byte unchanged and both voices remained installed. Evidence is in deletion-native-result.json, deletion-native-readback.json and deletion-subscriptions-before.json.

The local browser fixture exercised start, completion, deletion confirmation, available list, and Activity. The available Aaron row showed a download action and no completed status; the historical completion remained in Activity. Screenshots deleted-available.png and deleted-history.png and the accessibility readback capture this fixture validation. Actual Chrome navigation was interrupted by concurrent user activity, so native removal was validated through the installed helper rather than claiming a full real Chrome click-through.

## Status wording

Waiting-system means a download request was acknowledged and the application is waiting for the voice resource to become available. It does not prove bytes are currently transferring. The status now says 已交由 macOS 處理. Cancel uses 取消下載 and the pending state 正在取消…. Other locales were updated consistently. No numeric progress claim was added.

## Review and checks

Independent source review by gpt-6.1-sol resolved the physical-version and retired-alias findings. See deletion-review.md. The pure Swift journal suite passed 11 tests, including cross-version physical selection and strict operation identity negative controls. Native compilation, extension build and TypeScript typecheck passed. Full pnpm test passed 848 TypeScript, 34 Node, 5 package-manager and 1 configuration tests. The initial sandbox-only run could not bind OAuth localhost; the final full run used the required local port access and passed.

Principles applied: Fix Root Causes changed actual removal ownership rather than hiding the stale label alone. Model the Domain keeps present catalog state separate from historical task completion and physical identity separate from operation identity. Prove It Works required installed-helper readback and the browser fixture, with their different validation boundaries recorded above.
