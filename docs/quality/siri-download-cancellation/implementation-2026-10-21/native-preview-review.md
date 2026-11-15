# Independent native canonical readback and preview sample review

Reviewed by gpt-6.1-sol. Reused independent reviewer under the runtime capacity exception, counted once. I authored neither change.

Repository `/Users/cheng/Desktop/immersive-language-learning`, branch `codex/core-redesign`, HEAD `ece1cde59949017152b4255a689236c8b8dc4a4f`, shared dirty checkout. Scope covers the canonical-version matcher, regression tests, native ownership call sites, twelve preview samples, their test and saved runtime evidence. No source edits, UI operations, voice rendering, downloads, cancellation calls, purge or installation performed.

## Verdict

No material flags in either change.

The native matcher accepts the newly observed lossy daemon readback only when the actual gender and footprint fields are both `undefined` and actual version is `0`. Language, technology and voice name still must match. A nonzero explicit version mismatch is rejected. Version0 with defined identity fields is rejected when the expected concrete version differs. This handles the observed en-US-G form without ignoring arbitrary version differences.

The exception cannot recover a concrete resource version that the daemon omitted. Safety instead continues to depend on the surrounding immutable operation receipt and isolated per-operation client. Those checks remain intact. Receipts bind operation UUID and voice ID; their stored assetKey is preferred over a changing catalog key; own subscriptions are selected by the exact derived operation client; nil accessory and target identity are checked before withdrawing that client's list. The helper persists the cancellation fence first and does not purge or delete voice resources. Shared-resource matching may recognize canonical subscriptions as the same voice family, but this does not authorize changing another client.

The root-cause fix is appropriately at the daemon readback comparison boundary. No worker, protocol or request replay change is needed to interpret the lossy canonical form. The stored request can become observable again and its previously saved cancellation can finish.

The preview repair adds native-language text for ar, da, fi, he, kk, lt, nb, nl, ru, sv, tr and zh-HK. These are reasonable short equivalents of learning something new together. Cantonese text is appropriate for zh-HK. Else's Danish and Tilde's Swedish sentences are natural. The existing manager still selects the exact playable voice ID for the voice's language and requires that voice to be installed and the service ready. No fallback to a different voice or new behavioral guard is introduced.

## Independent checks

Swift journal tests passed 9/9 in this review. Log `/tmp/cll-siri-native-preview-journal.log`. Tests use temporary journal fixtures and simulated events, not the Siri daemon. They cover the new version case, prior explicit identity changes, immutable operation identity, locks, fences, crashed starts and storage failures.

The new preview sample test passed 1/1. Log `/tmp/cll-siri-native-preview-samples.log`. It checks coverage for the twelve repaired locale identifiers using the same exact-language/base-language lookup as the manager. It does not itself prove synthesis or playback quality.

Read the saved before/after regression logs. Before the fix the version test returned `[true,false,false,false,false,false]`; after the fix the nine-test suite passed. The changed acceptance is the observed canonical omission. Explicit mismatches remain negative controls.

Read saved `version-readback-after.json` and `version-readback-cancelled.json`. They identify the same en-US-G operation `6eac35fa-a83d-4aa7-acca-82eb9904aa56`. The first successfully observes a present subscription with a cancellation fence; the later observation reports absent subscription, absent resource, fenced=true and settled ordering. This is consistent with the worker subsequently completing the user's stored cancellation. It is not evidence of replaying a new download.

Read saved preview language artifacts. `preview-language-audio.json` records the installed helper rendering exact Else and Tilde IDs into non-silent WAV files. `preview-language-coverage.json` records 98 catalog voices across 34 locale variants with no missing sample. This is current snapshot coverage rather than a promise about future catalogs. The actual Chrome AX artifact `else-preview-playing.txt` records the preview surface, and root reports enabled preview controls, an active stop-reading state and a normal state afterward. I did not independently interact with that UI or listen to generated audio.

## Attention

Reviewed by gpt-6.1-sol.

No material flags. Supersede the pending usage-limit/BLOCKED independent-review statements in `.audit/siri-download-version.todo.md` and `feedback-and-version.md` with this completed verdict. Record the Else/Tilde sample fix and its distinct source-test, non-silent synthesis and actual Chrome interaction evidence. Preserve the distinction between the earlier full suite, these narrow reruns and actual runtime observations.

No scoped comment or suppression defect found. Reviewer source edits 0, reviewer comment deletions 0, restored comments 0, MUST KILL flags 0, rejected-report reruns 0, architect sketch none, reviewer fixes/encoding offers/encodings none, unenforced comment constraints none.
