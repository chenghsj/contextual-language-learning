# Manual YouTube subtitle timing correction

Open **Create → Preview subtitles → Subtitle actions → Correct subtitle timing** on a
YouTube video. The dialog provides two manual methods:

- **Shift all subtitles**: enter a shift in seconds. A negative value moves subtitles earlier;
  a positive value moves them later.
- **Correct gradual drift**: enter two matching subtitle/actual positions, one near the
  beginning and one near the end. Subtitle times are adjusted proportionally between them.

Run **Preview changes**, compare the original and proposed ranges, then apply them together.
The first five changes each offer **Before** and **After** playback. Switching or stopping
playback, closing the dialog, or applying changes stops the current preview. Displayed ranges
use one decimal place; playback and saved values retain exact milliseconds.

Completed proposals and their mode/input settings are saved with the subtitle draft, separately
for each video and language. Losing focus, switching macOS desktops, closing/reopening the
modal, or reloading the side panel does not intentionally discard a completed proposal.
Changing subtitle text/times or the correction inputs invalidates the preview. Applying it
clears the pending proposal. Video/source changes cannot apply another video's pending edits.

## Scope

Automatic audio-based refinement has been removed at the user's request. It did not meet
real phrase-level onset accuracy expectations. The audio downloader, page media observer,
energy detector and their dependency are no longer part of the extension. No speech model
is installed or used for timing correction. Reload the extension and existing YouTube pages
after updating to stop old content scripts that are already running.

Old audio-generated pending previews are invalidated by the preview version change. Previously
applied timing/text edits remain in the draft. Single-cue editing and listening remain available.
**Restore original subtitles** resets the draft to source text/times, including earlier edits.

## Validation

All transforms retain cue IDs/text/ruby and use one validated atomic draft update. Negative,
reversed, non-integer or out-of-video results reject the entire operation. Invalid anchors and
stale previews cannot partially overwrite a newer draft.

```sh
node --import tsx --test apps/extension/src/lib/subtitle-timing.test.ts apps/extension/src/lib/subtitle-draft.test.ts apps/extension/src/video/playback-transport.test.ts apps/extension/src/video/youtube-captions.test.ts
pnpm --filter @contextual/extension typecheck
pnpm --filter @contextual/extension test:subtitle-timing-ui
pnpm --filter @contextual/extension build
```

Browser acceptance uses isolated video-service fixtures. It verifies that only the two manual
modes are offered, no audio analysis is requested, exact before/after playback, compact ranges,
invalid/unchanged previews, settings invalidation, focus/modal remount, IndexedDB/full-page
reload, saved mode/input restoration, atomic apply/restore and narrow/short layouts.

Automated focus/reload simulation does not establish physical macOS desktop-switch acceptance.
Manual timing inputs remain user judgments; the feature makes no automatic speech-alignment
accuracy claim.
