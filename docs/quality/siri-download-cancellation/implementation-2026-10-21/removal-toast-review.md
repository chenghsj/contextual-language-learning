# Independent Siri removal toast review

Reviewed by gpt-6.1-sol under the existing capacity exception. Repository `/Users/cheng/Desktop/immersive-language-learning`, branch `codex/core-redesign`, HEAD `ece1cde59949017152b4255a689236c8b8dc4a4f`, shared dirty checkout. Scope is removal success presentation in SiriVoiceManager, the two preview viewport integrations, the speech acceptance assertions and the existing global NoticeViewport/Sonner host. Unrelated changes excluded. No source edits, UI actions, native calls or resource mutations performed.

## Verdict

No material findings.

The success toast is emitted only after `controller.removeVoice` resolves with a validated speechVoiceRemoved response. It uses the selected voice name and existing localized removal explanation, including the possibility of another client's macOS redownload. The per-voice toast ID replaces duplicate success notices for that voice. No native deletion behavior changed.

Inline success state is cleared before refreshing voices/catalog. A confirmed removal followed by a refresh failure still produces the persistent removedRefreshFailed alert. An unconfirmed removal retains the persistent removeFailed alert and never emits success. The success event can still reach the app's existing global viewport if the manager unmounts while removal finishes; component state updates are guarded by mounted.current.

App already mounts the shared NoticeViewport and ignores outside interactions originating in the Sonner toaster when handling its Sheet. Both affected previews now mount that same viewport with existing locale/close-label/theme props. The acceptance script checks one removal toast, no persistent success row, and dismissal through the localized close button.

Voice names and localized descriptions are passed as React/Sonner text rather than HTML. Existing shared viewport accessibility and dismissal behavior apply. The change adds no competing timer or persistent success banner.

## Verification limits

This is source review only. I did not run the browser acceptance script because this task excludes UI actions. Root is running typecheck/build/focused tests and fixture verification for visible success, automatic dismissal and persistent failures. Record those actual outcomes separately. No new native download or deletion verification is necessary for this presentation-only delta.

No new scoped comment or suppression defect found. Reviewer source edits 0, comment deletions 0, restored comments 0, MUST KILL flags 0, rejected-report reruns 0, architect sketch none, reviewer fixes/encoding offers/encodings none, unenforced comment constraints none.

## Attention

Reviewed by gpt-6.1-sol.

No material flags. Preserve the distinction between confirmed removal success and a subsequent catalog refresh failure, as the current implementation does.
