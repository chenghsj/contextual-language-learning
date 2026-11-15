# AI analysis latency implementation, 2026-11-02

Latest live acceptance (2026-11-03): the renewed and amended 20-task round is complete. All 18 known regressions were automatically corrected, but the full cold run took 7m43s with first read at 2m04s. A matched low-teaching sample took 30s versus 107s medium, but failed source/grammar/reading review. No production activation or installation. Final quality prompts are frozen as v2 with byte-identical live-request proof and v1 recovery support; 345 regressions pass. See [the latest acceptance report](ai-analysis-latency-live-acceptance-20261103.md).

Latest implementation (2026-11-03): automatic source review now shares the experimental reconciliation call, with protected repairs, one semantic recheck, durable evidence and a final commit gate. New selection input is about 20.8% smaller on the saved candidate pool, preserving all source/ruby. 340 regressions and four package typechecks pass. No new live calls or installation; measured first-scene latency is still unverified after these changes. See [the automatic-quality implementation](ai-analysis-latency-automatic-quality-implementation.md).

Current status (2026-11-03): the renewed 15-task experiment completed all four scenes in 4m20s with the first scene at 1m51s. The generated document required a separate 48-second, 16-string semantic repair. Final review passed after that repair; automatic end-to-end quality and the 60–90 second first-scene target remain unaccepted. Production remains legacy, with no install or reload. See [the latest live validation](ai-analysis-latency-live-validation-20261103.md) for evidence and limits; the [offline results](ai-analysis-latency-offline-results.md) retain the earlier failed run.

The sections below retain the earlier P0/P1 history and approval chronology; pending steps mentioned there are historical, not permission to send more model requests.

## Implemented

- One effective-thinking resolver matches Pi 1.4 automatic medium with model capability clamping. Explicit unsupported strengths still fail; explicit supported strengths are retained.
- Model resolution, input estimation, generation sessions and output budgeting use this effective value. Model resolution also exposes modelId so the existing Gemini-medium budget rule applies to estimates.
- New execution metadata freezes effectiveThinkingLevel and budgetStrategyVersion. effectiveSettingsFromCall identifies the prospective call boundary for resumed old jobs; historical calls are not retroactively attributed to the new setting. The original request and fingerprint are unchanged. Resumes reuse a saved effective value and only resolve one for old unfinished jobs.
- Execution-call metadata records effective thinking. The actual SDK provider-options seam is tested, including its model-output capacity clamp.
- Existing high/xhigh headroom also applies to the supported max setting.
- Experimental compact discovery omits lexical offset tables and unselected utterance segmentation; selection uses compact candidates with a shared source table. Complete-scene teaching returns sourceUnits and all required teaching in one response.
- The experiment parser restores full cue intervals, rejects invalid primary/context references, remaps local utterance references before first persistence, and reuses the existing source, teaching, example and pronunciation validators. It is not wired into production job generation yet.
- A bounded opt-in benchmark prepares prompts without network access and can, once authorized, execute at most two candidate-window calls, one selection and one scene-teaching call. Valid raw outputs and paid-call metadata are saved before validation. It does not resume or modify the original task and does not publish or install results.

## Verification

- Before the fix, both new automatic-reasoning tests failed because the resolved agent strength was undefined. They now pass.
- 124 targeted Core/Host generation, job, model-resolution and recovery tests passed, including the new compact and pinned-budget tests.
- Two targeted SDK transport/session tests passed. They check actual provider reasoning/maxTokens, not just the budgeting helper.
- Core, Local Host and Extension TypeScript checks passed.
- Native Host production build, macOS system/Siri helper build, bundle test and stdio smoke passed. Smoke reports protocol 16. The built Host remains in workspace dist, not installed.
- A broader pi.test.ts run initially had two OAuth callback tests fail on sandbox localhost-listen permissions. The generation/session tests above were then selected explicitly; the OAuth tests are not claimed as passed. No OAuth login or real credential exchange was started for this task.
- pnpm's corepack entrypoint could not write its external cache; the same repository TypeScript/build/test entrypoints were run directly with Node.

Representative preparation, using the same two previously truncated primary windows and a 32768 output allowance:

| Window | Previous prompt characters | Compact prompt characters |
| ------ | -------------------------: | ------------------------: |
| 0      |                     34,953 |                    12,852 |
| 1      |                     41,549 |                    15,106 |

These are character counts, not token measurements or demonstrated latency improvements. No generated teaching-quality conclusion can be drawn from preparation alone.

## Live sample and remaining gate

The user explicitly approved the described data/destinations and four model tasks. Those four tasks have now run, using existing responses rather than paying again for the candidate windows:

| Task                 | Seconds | Length stop |
| -------------------- | ------: | ----------- |
| Candidate window 0   |   18.25 | no          |
| Candidate window 1   |    5.98 | no          |
| Selection            |   15.36 | no          |
| Whole-scene teaching |   38.32 | no          |

Concurrent candidate time plus the selection/teaching phase was approximately 72 seconds, excluding the manual code-correction interruption and initial model discovery. This is a two-window/one-scene sample, not full 462-cue/four-scene latency. All four calls used medium with a 32768 output allowance.

The first phase encountered an unused `splitAfterCueId: null` on a complete result. A regression first reproduced rejection, then the parser was updated to accept only null for this unused field, while rejecting a real split instruction mixed into a complete response. Saved responses were bound to the same source hash, settings and exact prompts before reuse; neither candidate request was paid again.

The teaching response contained 14 source units, 4 points and 4 reusable items, but one point used category `expression`, outside the enabled category enum. It was correctly rejected. The scene prompt now enumerates the actual enabled categories in the output contract, and offline regression rejects this observed invalid value. The modified prompt has not been sent to the model again: all four authorized tasks have been spent. No invalid scene was published or marked accepted, and semantic quality remains unaccepted.

Raw paid outputs and call records: `work/compact-scenes-live-20261102/` and `work/compact-scenes-live-remaining-20261102/`. The latter reuses the former's candidate calls, so their call histories must not be summed as six unique calls. Latest code includes a prospective newModelCalls counter for later runs.

Source: the local job `22403764-25a8-4311-a69c-a17dec650b69`, the same 462-cue/4-scene task used for diagnosis. The sample sends primary windows 0 and 1 with necessary neighboring source context and the title, then the compact candidates/source needed for selection, and one selected complete scene with necessary context for teaching. Instruction/profile settings accompany each request. The original task, library and backups stay untouched.

Provider/model: the existing product-owned Antigravity login and gemini-3.8-flash, with effective medium. The provider's configured Google API origins are:

- https://daily-cloudcode-pa.googleapis.com
- https://daily-cloudcode-pa.sandbox.googleapis.com
- https://cloudcode-pa.googleapis.com

The benchmark rejects a custom endpoint override outside that list and a different provider/model. External processing exposes the selected subtitle content to that service and consumes the account's model allowance. No account tokens or credential files are included in the prompt artifacts or displayed outputs.

Automatic approval review initially rejected the live command before execution because the specific payload/destination had not been explicitly confirmed; the user's later explicit approval resolved that block. The benchmark is `apps/local-host/scripts/benchmark-compact-scenes.ts`; dry-run artifacts are in `work/compact-scenes-ready-20261102/`. A new output directory is required for each run. Explicitly rejected/unbilled requests may use the provider's existing bounded safe retries; unknown paid failures are not replayed automatically.

Remaining work: obtain authorization before additional model tasks, rerun only the corrected scene teaching against the already selected saved scene, inspect source fidelity and teaching/example quality, then proceed with the planned versioned checkpoint, cross-scene reconciliation, bounded parallel generation, partial-reader transport/UI and real browser acceptance if the gate passes. Reuse selection as well as candidates; do not spend another full four-call sample merely to test this correction. The 60-90 second / 3-5 minute targets have not been established.
