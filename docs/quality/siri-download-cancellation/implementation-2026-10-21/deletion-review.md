# Final independent Siri explicit-deletion review

Reviewed by gpt-6.1-sol, reused independent reviewer under the runtime capacity exception, counted once. I authored no changes.

Repository `/Users/cheng/Desktop/immersive-language-learning`, branch `codex/core-redesign`, HEAD `ece1cde59949017152b4255a689236c8b8dc4a4f`, shared dirty tree. Reviewed the latest removal boundary, receipt enumeration, physical identity predicate, receipt-bound withdrawal primitive, start/legacy serialization and UI label/copy changes. Unrelated favorites preserved. No source edits, UI operations, native downloads/cancellations/purge or installation performed.

## Verdict

No material findings remain in the reviewed source. Both findings from the prior passes are resolved.

The physical-resource predicate is now separate from exact subscription authorization. `siriResourceMatches` ignores gender and content version because they are absent from the purge resourceSpecifier. Language, technology, voice name and expected premium/canonical footprint still match. It is used for removal receipt selection and owned-client orphan/recheck detection. This closes the gap where an explicit older/newer content version could survive the orphan guard and trigger redownload.

Strict `siriSubscriptionMatches` remains in the receipt-bound withdrawal path. The private withdrawal primitive checks the exact isolated client, stored asset identity and nil accessory before replacing only that client's list. It verifies the client's subscriptions are absent afterward. The established canonical daemon omission exception remains constrained as previously reviewed.

Removal now locks each selected operation, reloads its private receipt, persists its cancellation fence and passes the receipt's frozen assetKey directly to that primitive. It no longer requires a retired historical voice ID to resolve in the current catalog before withdrawing the receipt-bound request. This closes the old-alias deletion availability gap. A receipt without an assetKey is allowed only when no start entered and the client has no subscription. Entered receipts without identity fail closed. Unacknowledged starts remain unconfirmed and block purge despite a current absence observation.

Unknown matching app-prefixed subscribers without validated selected receipts block purge. The post-withdrawal check covers the same physical scope. Foreign Apple/legacy/general clients are never cleared. Their retained demand may cause future redownload, as the existing UI warning states.

Global resource-changes locking is outside operation locks on start and removal. Cancel/inspect do not acquire the global lock. Removal calls the non-locking private withdrawal primitive while holding its operation lock, so it does not recursively reopen the same flock. Legacy install also takes the global lock and refreshes its selected catalog row within it. A new explicit user start serialized after completed removal remains allowed by the stated contract.

Receipt enumeration retains private/no-follow file checks, lowercase UUID filenames, filename/receipt UUID agreement and immutable voice binding. Exact catalog physical aliases select the target resource, including the established fmvoice-to-natural mapping. The native purge target and physical-absence confirmation remain unchanged.

The available list omits only historical completed-task status. Activity history is preserved. Active/cancelled/failed task display remains. Updated five-locale waiting/cancellation copy stays concise and introduces no ratio or completion claim.

## Checks and limits

Independently reran the journal suite against the latest source. All 11 tests passed. Log `/tmp/cll-siri-deletion-journal-final.log`. The physical matrix accepts canonical and older/newer version/gender variants of the same physical resource, while rejecting different technology, voice name and footprint. Removal receipt selection includes a frozen old-version alias, preserves unrelated receipts and rejects filename/receipt identity mismatch.

These tests use temporary journal fixtures and simulated events. They do not invoke the real daemon withdrawal primitive or purge. The latest primitive is source-reviewed; actual Samer removal, continued absence and retention of Nora/Helena remain root's pending runtime acceptance. Native build success is root-reported. I did not rebuild or perform native effects in this pass.

No scoped comment or suppression defect found. Reviewer source edits 0, reviewer comment deletions 0, restored comments 0, MUST KILL flags 0, rejected-report reruns 0, architect sketch none, reviewer fixes/encoding offers/encodings none, unenforced comment constraints none.

## Attention

Reviewed by gpt-6.1-sol.

No material source flags. Preserve the distinction between this independent review and the pending actual deletion acceptance. Do not claim permanent absence if another client's retained subscription can legitimately reinstall the resource.
