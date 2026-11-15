# Side Panel player

Implemented from `Side Panel Player & Timing Spec.md` (2026-09-30).

The lesson has a fixed scene header and one shared player. Only the lesson body
scrolls. Scene navigation updates the content without autoplay. Clicking a dialogue
line plays that sentence and changes the player's previous/next buttons accordingly.
Scene playback is one continuous range, not a sequence of sentence clips.

The player has native play/pause, a seek bar, one loop toggle, shared speed and a
playback-options popover. Loop repeats the entire target range indefinitely;
resuming or seeking inside it does not change the next repeat's start boundary.

Timing is an optional action in playback options. The editor pauses the video and
replaces the regular player so only one set of transport controls is shown. Normal
play in the editor is unbounded so the user can find an ending beyond the saved
range. Set start/end pauses the video, reads the stopped position, and marks that
boundary at 0.1s precision. Each boundary also has two 0.1s fine-tuning buttons and
a short preview from one second before to one second after it; 0.5s controls are
omitted. Preview range plays the entire draft once. Back and forward move the video one second. Scene navigation
is disabled while editing to preserve the draft. Cancel discards it, and Done saves.
Reset in the editor remains a draft until Done; Reset in playback options removes
the saved override immediately.

Canonical cue and scene timestamps remain the originals. Effective playback uses
`playbackOverrides` and `scenePlaybackOverrides` first, then original timestamps.
Saving a sentence expands all containing scenes as needed, without shrinking them
or prohibiting overlapping sentences. The Host persists both changes in one locked
JSON update and synchronizes the existing Markdown/publishing/backup flow. Direct
scene edits and resets remain independent of sentence timing.

YouTube's default cue end is the next strictly later source start with distinct,
nonempty text. Blank/control-only and repeated overlay cues do not end playback.
Without a usable next start, the original end remains the fallback. The derived
times apply when reading existing lessons; source timestamps are never rewritten.
Explicit sentence analyses and V6 utterances spanning multiple cues play through
their last cue to the next effective source start, including across scene boundaries.
The timeline, highlighting, expression playback and scene defaults share these
derived cue ranges. Saved calibration takes priority; resetting it restores the
derived default. Netflix continues to use its original default cue timestamps.

The existing 0.25s minimum / 10-minute maximum range validation remains in force.
The optional whole-scene shift tools in sections 23–24 are not part of this layout
revision.

Development preview: run `pnpm --filter @contextual/extension dev`, then open
`/dev/reader-preview.html`. It uses a simulated video adapter and never edits saved
lessons. This preview and DOM regression tests do not establish live YouTube,
Netflix, or Drive acceptance; rebuild/reload the extension and Host for that check.
