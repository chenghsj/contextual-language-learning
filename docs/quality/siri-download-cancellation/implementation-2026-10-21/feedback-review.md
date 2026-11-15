# Independent compact download feedback review

Reviewed by gpt-6.1-sol under the existing capacity exception. Same repository and branch `codex/core-redesign`, HEAD `ece1cde59949017152b4255a689236c8b8dc4a4f`, shared dirty checkout. Scope is the new speech-download-feedback component/tests, its two call sites, five-locale copy and feedback todo. Unrelated favorites excluded. No source edits, UI operations or native download/cancel actions performed.

## Verdict

No material implementation flags in the latest source.

The shared component is presentation-only and takes task, locale and service. Active requesting/waiting/cancelling tasks receive a compact spinner. Terminal tasks return null. It introduces no timer, persistence, native request or progress ratio. The tooltip uses the actual fresh observation checkedAt; an unobserved/reconciling task receives status text rather than an invented timestamp.

Unavailable service, storage-error and task-level unavailable observation all remove animate-spin. Existing reduced-motion variants supply animate-none for the app preference and system fallback. The styles diff is empty; the temporary indeterminate-bar animation is not left behind.

Both call sites now wrap the shared icon with aria-hidden=true. This resolves the duplicate voice/status accessible name I flagged during this pass. Existing Activity badge text and Siri role=status text remain the accessible status. The icon remains visible while an Activity row is collapsed. Five locales define both tooltip and paused-update copy.

## Checks

Independently ran feedback, worker-controller and Activity read-model tests. All 15 tests passed. Log `/tmp/cll-siri-feedback-tests.log`. The four feedback tests cover every locale, real observation time, no progressbar/ratio, service loss, reconciling cancellation and terminal removal. Source review covers the two accessibility wrappers added after that run.

I did not drive the UI. Root reports a 320px light preview with spin, actual timestamp tooltip, no overflow, collapsed Activity feedback and frozen animation after disconnect. Dark Japanese 480px and reduced-motion browser checks were pending in the brief. Typecheck/build were rerunning. Preserve their actual results as separate evidence once complete; this review does not claim those browser checks passed.

## Attention

Reviewed by gpt-6.1-sol.

No material code flags. Update `.audit/siri-download-feedback.todo.md` before handoff because its implementation item still describes the abandoned indeterminate bar and additional background-completion copy. Record the final compact spinner/tooltip decision prompted by the user's density feedback.

Describe the percentage limitation precisely. The current native wire carries subscription/resource outcomes and cannot produce a defensible ratio. The newly observed UAF byte/percentage APIs have not been verified as scoped, reliable per-voice progress. Do not claim macOS has no progress data or that verified per-voice percentages are impossible. The saved Hiro logs already contain actual byte progress, while their cancellation behavior makes raw 100% especially unsafe as a completion signal.

No new comment or suppression defects found in this feedback unit. Reviewer source edits 0, reviewer comment deletions 0, restored comments 0, MUST KILL flags 0, rejected-report reruns 0, architect sketch none, fixes/encoding offers/encodings none, unenforced comment constraints none.
