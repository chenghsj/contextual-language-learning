# Siri removal feedback

Confirmed resource removal now publishes a Sonner success event through the existing global NoticeViewport. The selected voice name is the title and the existing localized explanation is the description. A per-voice ID replaces duplicate completion notices. The transient toast auto-dismisses and has the existing localized close button. Successful removal no longer occupies persistent space above the voice list.

Operation progress and actionable errors remain inline. If macOS does not confirm deletion, the resource and its error remain visible and no success toast is published. If resource deletion is confirmed but the subsequent catalog refresh fails, success remains true and a persistent refresh-failure alert is shown. Native resource deletion, download workers and cancellation behavior are unchanged.

Both preview hosts mount the same NoticeViewport as the app. The existing speech acceptance assertions now expect a Sonner toast and no persistent success banner. That full scripted browser acceptance was updated but not run; UI interaction used the approved CUA driver.

## Verification

The task preview exercised start, completion and explicit removal. Readback showed one Sonner toast and zero inline operation statuses; the toast later disappeared automatically. A simulated unconfirmed removal kept the voice row, showed one persistent alert and emitted zero success toasts. Retrying successfully replaced the error with a toast, which was dismissed with 關閉通知 and verified absent. Screenshots removal-toast.png and removal-toast-failure.png and their readbacks capture the fixture validation. No real system resources were changed during this presentation-only check.

TypeScript typecheck and extension production build passed. Fifteen existing shared notification and download-feedback interaction tests passed. Independent non-author source review found no material issues; see removal-toast-review.md. The test-only failure button was added after review to exercise the already-reviewed persistent-error behavior.

Experience First selected transient operation feedback rather than keeping a completed message in list layout. Prove It Works required both success dismissal and failure persistence to be observed in the browser fixture.
