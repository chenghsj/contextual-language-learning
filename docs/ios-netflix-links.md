# iPad Netflix reference times and external opening

## Physical-device finding

The initial implementation generated `/watch/<id>?t=<seconds>` links and treated URL-open success as a possible seek. The user tested it on an iPad and reported that Netflix resumed its previously saved position, ignored the requested timestamp, and returned through the introduction/details page before opening the player on every tap. This invalidates arbitrary timestamp deep linking for that tested setup.

Netflix's [official Moments documentation](https://help.netflix.com/zh-tw/node/210664027435620) describes creating, saving and sharing clips inside Netflix. It does not specify a public API for generating arbitrary clip links from a video ID and timestamp. Apple's [Universal Link opening option](https://developer.apple.com/documentation/uikit/uiapplication/openexternalurloptionskey/universallinksonly) establishes whether an installed app handles a URL, not whether that app seeks or starts playback. No verified replacement for native timestamp seeking was found in these primary sources.

## Current official Moments integration

The physical-iPad follow-up found a narrower working path: the complete official Moments share link played the shared clip through the reader's normal `UIApplication.open` Universal Link path, and changing only `t` to zero played an opening clip. A UUID-free minimal link failed when tested through that same UIKit path, including a user-requested repeat. Direct `devicectl --payload-url` tests addressed to Netflix had inconsistent warm/cold results and are not treated as equivalent to normal UIKit handoff. See the detailed [research and test chronology](netflix-native-playback-research.md).

Use **連結 Moments 片段** to paste the complete export for the same watch ID. Exact HTTPS Netflix hosts, watch paths, unique query fields, identity consistency and bounded start/duration are validated. An imported template is saved locally by episode/movie ID in preferences, and can be replaced or removed. Real share UUIDs are never generated or bundled into the app.

With a matching template, scene/row timestamps open a Netflix clip at the calibrated start, rounded down to a whole second. Only the original `t` field is replaced; every other encoded field and the shared duration are preserved. In particular, a two-second cue does not turn the shared 39-second clip into a two-second clip. There is no automatic loop or guaranteed cue-end pause.

Unlinked timestamps remain reference text. Existing review snapshots acquire playback through their watch ID without migration. An explicit source-opening button remains available. Timestamp actions without a valid matching template remain blocked before saving position or opening a URL. Linked clip actions save reader position and use an app-only Universal Link; failure never sends a clip to a browser or retries another route. YouTube playback is unchanged.

## Latest integration verification (2026-11-03)

- All 70 native unit tests and 3 selected iPad UI tests passed. New coverage includes complete-template validation, episode mismatch, byte-preserving query rewriting, persistence/removal, app-only handoff, failed position saves, reader-to-review relaunch and unlinked fallback. Existing YouTube UI behavior also passed.
- All 15 contract/shared-timing tests and 8 YouTube player tests passed, as did Swift formatting and the contract freshness check.
- Simulator result bundle: `/private/tmp/cll-ios-netflix-linked-tests.xcresult`; log: `/private/tmp/cll-ios-netflix-linked-tests.log`. The [linked reader screenshot](quality/ios-ipados/netflix-links/linked-moment-reader.png) was visually inspected.
- The signed device build succeeded and was installed over the existing development reader without uninstalling it. The user's provided export was seeded only into local settings for its own episode ID; its real UUIDs are absent from source and test fixtures. The normal reader was relaunched without the temporary probe.
- Physical evidence for the native URL mechanism remains the user's successful original-export and zero-time-export tests through the reader's UIKit opener. Arbitrary starts in other titles/Netflix versions and the final reader-button flow remain physical acceptance checks.

## Regression evidence

Before the reference-time fix, the native regression `testNetflixTimestampTapsCannotReopenVideoOrSavePosition` called the actual navigation helper for two different Netflix times and failed with `["saved", "opened", "saved", "opened"]` instead of `[]`. This proves the repeated navigation in our code; it does not simulate Netflix's internal playhead. Result bundle: `/private/tmp/cll-ios-netflix-reference-red.xcresult`.

The three Netflix projection tests also failed before the change because they emitted `?t=` instead of a plain source URL. They passed after the fix, along with all 15 contract/shared-timing tests.

Native regression coverage checks that timestamp actions have no persistence/navigation effects, explicit source opening strips legacy time parameters, fallback occurs only after an open failure, and failed position saves prevent navigation. The iPad UI scenario taps reference times repeatedly under a failing URL-open stub: no open-error alert may appear, and no timestamp button or embedded panel may exist. It separately checks that the single source button does invoke the opener, and repeats these assertions in hidden/revealed local review after relaunch.

Automated tests verify our routing and UI. Normal UIKit opening of a complete exported link and a zero-time variant additionally has user-confirmed physical evidence. This is not a general Netflix playback-control API.

Verified on 2026-11-03:

- All 67 native unit tests and both selected iPad UI tests passed; the existing YouTube reader/review flow also passed.
- All 15 contract/shared-timing tests and 8 YouTube player tests passed. Strict TypeScript checking of the contract entry point, Swift formatting and bundled contract fingerprint checks passed.
- iPad UI verification used an isolated iPad (10th generation) simulator running iPadOS 27.2. Result bundle: `/private/tmp/cll-ios-netflix-reference-green.xcresult`; log: `/private/tmp/cll-ios-netflix-reference-green.log`.
- Inspected the [corrected reader screenshot](quality/ios-ipados/netflix-links/reference-reader.png), showing one source-opening button and plain scene/sentence reference times.

## Physical iPad acceptance after updating

1. Open a Netflix lesson. Choose **連結 Moments 片段** and paste a complete Netflix-generated export from this same episode/movie. Wrong episode links must be rejected without changing the existing setting.
2. Tap two widely separated sentence times. Confirm the scenes actually change in Netflix rather than merely resuming the previous player. Expect clip UI and the exported clip's original duration, not the full episode timeline or a cue-end pause.
3. Return to the reader and verify the scene/group position. Relaunch the app and repeat from local review with the answer hidden and revealed.
4. Replace/remove the template. Removal should restore reference text in reading and review, leaving the imported lesson and saved review content intact.
5. Check an unlinked episode and a device without Netflix: no generated minimal Moment URL or browser playback fallback should occur.
