# Side Panel player

Implemented from `Side Panel Player & Timing Spec.md` (2026-09-30).

The lesson has a fixed scene header and one shared player. Only the lesson body
scrolls. Scene navigation updates the content without autoplay. Clicking a dialogue
line plays that sentence and changes the player's previous/next buttons accordingly.
Scene playback is one continuous range, not a sequence of sentence clips.

The player has native play/pause, a seek bar, one loop toggle, shared speed and a
playback-options popover. Loop repeats the entire target range indefinitely;
resuming or seeking inside it does not change the next repeat's start boundary.

Timing is edited in the lesson body. Normal play is unbounded so the user can find
an ending beyond the saved range. Start/end adjustments use 0.1s and 0.5s steps;
each boundary preview plays from one second before to one second after it. Back
and forward move the video one second. Cancel discards the draft, and Done saves.
Reset in the editor remains a draft until Done; Reset in playback options removes
the saved override immediately.

Canonical cue and scene timestamps remain the originals. Effective playback uses
`playbackOverrides` and `scenePlaybackOverrides` first, then original timestamps.
Saving a sentence expands all containing scenes as needed, without shrinking them
or prohibiting overlapping sentences. The Host persists both changes in one locked
JSON update and synchronizes the existing Markdown/publishing/backup flow. Direct
scene edits and resets remain independent of sentence timing.

The existing 0.25s minimum / 10-minute maximum range validation remains in force.
The optional whole-scene shift tools in sections 23–24 are not part of this layout
revision.

Development preview: run `pnpm --filter @immersive/extension dev`, then open
`/dev/reader-preview.html`. It uses a simulated video adapter and never edits saved
lessons. This preview and DOM regression tests do not establish live YouTube,
Netflix, or Drive acceptance; rebuild/reload the extension and Host for that check.
