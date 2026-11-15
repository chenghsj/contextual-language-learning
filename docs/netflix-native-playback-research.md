# Netflix playback in the official iPad app

Research date: 2026-11-03. Scope: public Netflix/Apple sources, the user's exported Moment link, and user-confirmed physical-iPad behavior. No account APIs, DRM access, browser changes, or fabricated share identities.

## Finding

**Normal Universal Link opening can play an authentic Moment, and changing its `t` value can change its start. The UUID-free minimal link failed in the same normal app-to-app test. The implementation therefore retains the complete user-supplied official link.** The user's original Moment link successfully played its 13:18 clip in installed Netflix 26.3.0 after opening on the connected physical iPad. This is the user's visual confirmation; the launcher itself cannot observe Netflix's playhead.

Earlier physical testing of plain `/watch/<episode-id>?t=<seconds>` resumed the saved position through the title/details flow. Those results still invalidate the assumption that an arbitrary `t` query alone implements native seeking on this setup. Testing a real Moment establishes a narrower working path; it does not establish a general playback-control API.

## Official supported workflow

Netflix documents creating Moments on iPhone and iPad: open the player's **Clip** control, choose start/end points, save a clip up to two minutes long, then share or rewatch it in **My Netflix**. Live events, trailers, downloads, and games cannot be clipped. [Netflix Help](https://help.netflix.com/en/node/210664027435620)

Netflix's September 3, 2025 announcement confirms the start/end selection and saved-clip workflow. It does not document an external clip-creation API or a URL recipe that turns an arbitrary timestamp into a saved Moment. [Netflix Tudum](https://www.netflix.com/tudum/articles/netflix-moments)

## What the real exported link establishes

The user's official export had this structure; both real UUID values are intentionally omitted:

```text
https://www.netflix.com/watch/81787986
  ?s=i&trkid=278685009&t=798&d=39
  &momentUuid=<redacted-moment-uuid>
  &shareType=Moment&shareUuid=<redacted-share-uuid>
  &trg=cp&unifiedEntityIdEncoded=Video%3A81787986
```

This is evidence of fields emitted by Netflix, not public documentation of their semantics. `t=798` corresponds to the observed 13:18 start. The roles of `d`, `momentUuid`, `shareUuid`, tracking fields, and encoded entity identity have not been isolated. In particular, neither timestamp binding to a server-side Moment nor the ability to generate a valid Moment by supplying new UUIDs has been established. Do not generate fake UUIDs or label fabricated URLs as official Moments.

## Direct-payload experiments and their limits

The first experiments used `devicectl device process launch --payload-url` addressed directly to Netflix. This is not the same transport as the reader calling `UIApplication.open` with a Universal Link. A launcher success only confirms dispatch; every playback observation below came from the user.

| Variant                                              | Observed result                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Original full exported URL, warm app                 | User confirmed the shared 13:18 clip played.                                    |
| Full export with only `t=858`                        | Clip mode had no full-episode timeline, so start time could not be established. |
| Full export with only `t=0`, warm app                | User reported the opening or a clearly different scene.                         |
| Minimal `t=798&d=39&shareType=Moment`, warm app      | User reported return to the original shared scene.                              |
| Minimal `t=0&d=2&shareType=Moment`, repeated         | User reported it was not the opening.                                           |
| Minimal `t=0&d=39&shareType=Moment`, warm app        | User reported this was not a clip; exact timeline was not established.          |
| Same minimal zero-time URL after terminating Netflix | User reported it resumed the original/previous position.                        |
| Full export with `t=0` after terminating Netflix     | User reported full-video resume/absence of clip playback.                       |

These inconsistent warm/cold observations do **not** establish a reusable minimal URL, a minimum duration, or arbitrary native timestamp seeking. Previous-player state and direct-payload transport remain confounders. The earlier positive warm-app observations must not be used alone to enable generated timestamp buttons.

A temporary DEBUG reader probe was then used to test normal app-to-app `UIApplication.open(..., universalLinksOnly: true)` while retaining the original official URL. The next section records its user-confirmed outcomes. This probe has now been removed.

## Normal UIKit Universal Link experiments

A signed DEBUG reader build was installed over the existing developer app without uninstalling or clearing its data. Its opt-in probe waits for the scene to be active, then calls `UIApplication.shared.open(url, options: [.universalLinksOnly: true])` exactly once. Launching that reader via `devicectl` only supplies the probe argument; UIKit performs the actual handoff to Netflix.

- The original complete exported Moment URL played the original shared clip: user-confirmed.
- The same complete URL with only `t` changed to zero played an opening clip: user-confirmed. This establishes that `t` can change start position on this normal handoff while the official metadata is preserved.
- The UUID-free minimal link was tried through UIKit and repeated at the user’s request. The user reported it remained at the opening/previous position, rather than opening the intended shared scene. It is not accepted as a usable generated-link format.

These observations do not prove which omitted metadata field is essential. The implementation preserves the whole official export and replaces only the `t` query value. It does not fabricate Moments identities, shorten `d`, or generalize the failed minimal URL. Playback evidence is limited to one episode on this user’s Netflix 26.3.0 installation.

## Public first-party link evidence

1. Netflix's live Apple association file declares `/watch/*`, `/title/*`, and `/clips/*` for its official iOS app IDs, including `YXNLG53YV4.com.netflix.Netflix` and `GN37K848D7.com.netflix.Netflix`. This establishes routing eligibility, not timestamp handling. [Netflix AASA](https://www.netflix.com/apple-app-site-association)
2. A bounded, unauthenticated iPad-user-agent read of Netflix's title HTML emitted `nflx://www.netflix.com/title/80057281?locale=en-TW` in both `al:ios:url` and the Apple Smart App Banner's `app-argument`, with App Store ID `363590051`. This proves Netflix itself publishes the `nflx` scheme for title opening. It does not prove a seek-capable custom-scheme route. [Observed public title page](https://www.netflix.com/title/80057281)
3. Reading the user's original Moment URL without cookies redirected from episode `/watch/81787986` to parent `/tw-en/title/81787975`. Netflix preserved all supplied share fields and added `fromWatch=true`; its `al:ios:url` and Smart App Banner then emitted the corresponding `nflx://www.netflix.com/title/81787975?...&locale=en-TW`. A separate request without either UUID also preserved `t=798`, `d=39`, and `shareType=Moment` into that metadata. This demonstrates a public forwarding bridge, **not native playback success for the UUID-free variant**. The web landing page's parent title ID must not be substituted for the episode ID by guesswork. [Netflix watch entry point](https://www.netflix.com/watch/81787986)

The `/clips` route also serves Netflix's separate discovery feed. Netflix describes it as short recommendations that can open a whole title or be shared. Therefore `/clips/*` in AASA does not by itself identify a saved-Moment format. [Netflix mobile navigation Help](https://help.netflix.com/en/node/575087423404644), [Clips availability Help](https://help.netflix.com/en/node/603379754195556)

## Apple boundary and product implication

Apple delivers a Universal Link's URL to the receiving app, which interprets its components and decides the action. Netflix owns that interpretation. Opening through HTTPS, a custom scheme, Chrome, or an app-launch tool does not independently add timestamp support. A successful open confirms handoff, not playback position. [Apple Universal Link handling](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app), [Apple cross-app URL communication](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)

## Implemented integration

Each episode/movie can be linked once to a complete official Moments URL in the native reader. Validation requires an exact HTTPS Netflix watch source, matching episode identity, unique query fields, `shareType=Moment`, valid exported UUID fields and bounded time/duration. These are conservative acceptance checks for the observed export, not a claim that all fields are independently required by Netflix.

Links are saved locally in the app's preferences, keyed by watch ID, and reused by reader and local review. Only the `t` field changes, using whole seconds rounded down from the calibrated row/scene start. All other percent-encoded fields and the original `d` value are retained byte-for-byte. No end-time or automatic looping claim is made.

Without a matching template, timestamps remain reference text. Linked time buttons call UIKit with `universalLinksOnly: true`; a failure reports an error instead of opening a browser or trying a different URL. The original single source button remains available. Saved reading position is required before handoff. The editor supports replacement and removal without changing imported material or review snapshots.

The temporary auto-opening physical probe was removed. The actual exported link is not hardcoded into source or fixtures. DEBUG-only developer seeding accepts an explicitly supplied export for physical installation; ordinary UI uses user-initiated paste in the link editor.
