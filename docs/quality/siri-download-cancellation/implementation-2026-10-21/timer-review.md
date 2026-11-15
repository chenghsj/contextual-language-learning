# Independent timer receiver review

Reviewed by gpt-6.1-sol, reused independent reviewer under the runtime capacity exception. I did not write this fix.

Repository `/Users/cheng/Desktop/immersive-language-learning`, branch `codex/core-redesign`, HEAD `ece1cde59949017152b4255a689236c8b8dc4a4f`. Read-only follow-up. No source edits, UI operations, native downloads, cancellation calls or installation performed. Concurrent favorites work was outside scope.

## Verdict

No material flags. The constructor change at `apps/extension/src/native/speech-download-controller.ts:80-82` is the narrow root-cause fix for the reported browser timer receiver error.

The old default stored native timer functions directly on a plain object. `maintainPolling` invokes `this.timers.set` and `this.timers.clear`, which supplies that plain object as the receiver. Chromium's Worker timer binding rejects that receiver. The new arrow callbacks call global `setTimeout` and `clearTimeout` normally and do not forward the timer wrapper object's receiver. Both scheduling and cleanup are corrected, including the cleanup path at line 578.

The root's reported real service-worker probe reproduced Illegal invocation with the former object and passed with callback wrappers. This is the relevant platform verification. I did not repeat browser actions or observe the probe independently in this follow-up.

## Why the saved state looked stuck

`commit` writes storage at line 227, assigns `this.records` at line 234 and publishes at line 235 before returning its result. Publication schedules polling. Therefore a timer exception rejects the start command after durable intent already exists, before `start` reaches native dispatch. The same sequence can durably record cancelling and then throw before the immediate native cancellation dispatch. The observed requesting/cancelling records are consistent with this code path; they are not evidence of a successfully started physical download.

On worker restart, durable cancellation requests are withdrawn/reconciled rather than replaying starts. The root-reported records for Samer, Martin and Carmen now have progress cancelled, dispatch intent, cancelRequested true and withdrawalSettled true. That combination is semantically consistent with the interrupted unsent starts and subsequently confirmed cancellation fences. It does not mean a voice downloaded or that its resources were deleted. No new auto-install replay is introduced by this fix.

## Sibling scan and checks

Searched production extension/core TypeScript sources for plain object timer aliases of setTimeout, clearTimeout, setInterval and clearInterval. No remaining direct timer alias was found. The existing generation-controller injected timer defaults already use callback wrappers. Other timer uses found in the extension call globals directly.

Reran the controller suite. All 10 tests passed. Log `/tmp/cll-siri-timer-tests.log`. These tests use injected Node/mock timers and cannot validate Chromium's native Worker receiver restriction. Root separately reports typecheck, formatting and diff checks passed. I did not rerun them or add a weak imitation of the WebIDL behavior.

No new comments or suppressions were added. Reviewer source edits 0. Reviewer comment deletions 0. Restored comments 0. MUST KILL flags 0. Rejected-report reruns 0. Architect sketch none. Reviewer fixes, encoding offers and encodings none. Unenforced comment constraints none.

## Attention

Reviewed by gpt-6.1-sol.

No material flags in this fix. A fresh actual sidebar start/cancel/remount interaction remains a separate acceptance step unless root completes and records it. Timer probe success plus recovery of old persisted records should not be presented as that fresh interaction passing.
