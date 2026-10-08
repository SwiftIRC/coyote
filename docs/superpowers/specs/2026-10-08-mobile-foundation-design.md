# Mobile apps — Foundation (iOS & Android)

## Problem

Coyote's only client is the browser. On a phone, a call dies the moment the screen
locks or the user switches apps: mobile Safari and WKWebView suspend microphone and
camera capture when the page is backgrounded, and nothing in the web platform can
keep them alive. People join Coyote calls from IRC on their phones and need the call
to behave like a phone call — keep talking with the screen off, survive app
switching, show up on the lock screen.

The goal is native iOS and Android apps with full parity to the web client,
distributed privately first (TestFlight, Play closed testing) and publicly later.
Claude writes and maintains the mobile code on Linux; the maintainer builds, signs
and ships from a Mac.

## Decomposition

Full parity is too large for one spec. It is split into four sub-projects, each with
its own spec → plan → implementation cycle, each leaving shippable apps:

1. **Foundation** — *this spec.* A usable call app: links open the app, pre-join,
   audio/video grid, mute/camera/flip, audio routing, background and lock-screen
   survival, reconnect, kicked/banned handling, and the server's `.well-known` files.
2. **Room features** — chat with replay, polls, soundboard, viewing screenshares,
   per-participant volume, low-bandwidth mode, room timer, settings and rename.
3. **Op moderation** — kick, ban, force-mute, stop-share, room lock, confirm dialogs.
4. **Heavy sending features** — screenshare *sending* (iOS ReplayKit broadcast
   extension, Android MediaProjection) and blur/virtual backgrounds (native MediaPipe
   frame processors).

Noise suppression is not ported: the apps use the platform's built-in voice
processing (libwebrtc APM / iOS voice-processing I/O) instead of the RNNoise worklet.

## Decisions

- **React Native (bare workflow, no Expo) + TypeScript**, with `react-native-webrtc`
  (libwebrtc) for media, `react-native-callkeep` for CallKit / ConnectionService, and
  `react-native-incall-manager` for audio routing and the proximity sensor.
  Rejected: a Capacitor/WebView shell (iOS suspends WebView capture in the
  background — the exact failure being fixed), the `iosrtc` native-media-under-WebView
  pattern (fragile layout sync, breaks the canvas/worklet pipelines), Flutter (a third
  language, no logic sharing with the JS client) and Swift + Kotlin (two codebases,
  and the iOS half can never be compiled where it is maintained).
  The bare workflow keeps `ios/` a plain Xcode project the maintainer opens directly,
  with no prebuild step or cloud service between an edit and a build.
- **The server and its wire protocol are the contract.** Foundation makes no protocol
  change. The apps are a second client of `/ws/{room}` and the HTTP API, behaving as
  the browser does (`internal/signal/messages.go`, `internal/web/assets/net/*.js`).
- **Pure web-client logic is shared, not copied.** Metro's `watchFolders` lets the app
  import the DOM-free modules of `internal/web/assets/lib/` directly, so the two
  clients cannot drift on protocol encoding, negotiation decisions, backoff, error
  disposition or quality tiers.
- **The repo's no-npm stance holds for `internal/web`.** The app is the only thing
  with `node_modules`, isolated under `mobile/`; the Go build ignores it and
  `.dockerignore` excludes it.
- **One built-in server host, `vc.swiftirc.net`.** Universal Links / App Links are
  registered for that domain only; links to any other Coyote host work by pasting.
- **Camera off in the background on both platforms.** Required on iOS, chosen on
  Android for battery. Restored on return if it was on.

## Repository layout

```
mobile/
  package.json, metro.config.js, tsconfig.json, jest.config.js, .eslintrc.js
  src/
    shared/   re-exports of internal/web/assets/lib/{protocol,negotiation,backoff,
              serverError,quality,gridLayout,presence,duration}.js (+ avatarFor/
              gravatarUrl, see below), with .d.ts type declarations
    core/     pure TypeScript — no react-native or native-module imports
      link.ts         URL / room-name parsing
      signaling.ts    WebSocket client (port of net/signaling.js)
      peer.ts         RTCPeerConnection controller (port of net/peer.js)
      call.ts         call controller: join state machine, rejoin, roster, media state
      roster.ts       participant store
      gravatar.ts     SHA-256 email hash (pure JS)
    native/   thin adapters, injected into core/
      webrtc.ts       react-native-webrtc factory + getUserMedia
      callkit.ts      CallKeep wrapper (iOS CallKit, Android ConnectionService)
      foreground.ts   Android foreground-service start/stop
      audioRoute.ts   InCallManager wrapper
      lifecycle.ts    AppState + NetInfo → core events
      storage.ts      AsyncStorage (name, email, recent rooms)
      linking.ts      initial URL + url events → core/link
    ui/
      screens/Home.tsx, PreJoin.tsx, Call.tsx
      components/Tile.tsx, SelfView.tsx, Controls.tsx, Banner.tsx, Avatar.tsx
  ios/ android/       React Native native projects + config
  MANUAL-TEST.md      device checklist (load-bearing, see Testing)
  RELEASE.md          the maintainer's Mac build/sign/ship steps
```

**Layering rule.** `core/` takes its WebSocket constructor, RTCPeerConnection factory,
media acquisition, clock and random source by injection and imports nothing from
React Native. All protocol behaviour is therefore testable with Jest on Linux.
`native/` and `ui/` are the only device-dependent code.

`avatar.js` mixes pure and DOM code, but its top level only declares constants and
functions; browser APIs are touched inside `gravatarHash` and `applyAvatar`, which
the app never calls. Foundation imports `avatarFor`, `gravatarUrl` and
`IRC_AVATAR_COLORS` from it directly, with no change to the web client.

## Entry: links, Home, pre-join

**Links.** `core/link.ts` accepts `https://<host>/<slug>[#i=<id> | #t=<token>]` and a
bare room name. The slug is lowercased and must match `^[a-z0-9-]{1,32}$` (the server's
rule, `internal/server/server.go:36`); fragments are read with the shared
`parseInvite`/`parseToken`. `#i=` wins over `#t=` when both are present, as on the
server. A link opened while already in a call prompts "Leave #current and join
#new?" rather than silently switching.

**Home.** A room-name field (joins on `vc.swiftirc.net`), a paste-link field (any
host), and a list of recently joined rooms (local only, newest first, max 10).

**PreJoin**, mirroring `ui/prejoin.js`:
- Display name: editable, prefilled from storage. Read-only when the link carries a
  nick — from `GET /api/invite/{id}` → `{name}` for `#i=` (404 → show the
  `token-invalid` wording), or the unverified `n` claim of a `#t=` token payload.
- Email (optional, stored on device) → SHA-256 of `trim().toLowerCase()` in
  `core/gravatar.ts`; only the hash is sent. A test vector shared with
  `internal/web/test` pins byte-identical output.
- Password field.
- `GET /api/rooms/{slug}` → `{count, locked}` polled every 3s while the screen is
  visible, for "N in call" and the lock indicator.
- Camera preview and mic/camera toggles; their state becomes `join.mic`/`join.camera`.
- Permissions are requested here (mic, camera; Android also `POST_NOTIFICATIONS` and
  `BLUETOOTH_CONNECT`). Denied mic/camera joins with that device off and says so.

**Pre-join errors.** A join `error` returns to PreJoin with the browser's wording per
code: `bad-password`, `banned`, `identified-only`, `not-provisioned`,
`token-invalid`, `token-expired`, `protocol`, `media`, and a fallback.

## Call: signaling

`core/signaling.ts` ports `net/signaling.js`:
- WebSocket to `wss://<host>/ws/<slug>`. Every frame is `{type, ...fields}` via the
  shared `protocol.js`.
- `join` is the first frame, sent on **every** open with: `name`, `password`, `token`
  or `invite`, `session`, `gravatar`, and the **current** `mic`/`camera` booleans.
- **Session nonce:** a UUID created per join attempt (link open or Join tap), kept
  for that call across all reconnects, discarded on leave. Same single-use invite
  semantics as a browser tab (`internal/server/invite.go`).
- Reconnect on any close not caused by `stop()`: shared `backoffDelay` plus
  0–250 ms jitter; attempt counter resets on open; frames sent while closed are
  queued and flushed on open.
- **Mobile addition:** on app-foreground (`AppState` → `active`) or a network change
  (NetInfo), if the socket is not open, reconnect immediately (reset backoff).
- Errors go through the shared `serverErrorDisposition`: before `joined` → fatal,
  back to PreJoin; in call → non-fatal toast.
- `kicked {by}` / `banned {by}` → `stop()`, tear down media, end the CallKit/
  ConnectionService call, show "Removed from the call by <by>" on Home, never rejoin.
- `server-restarting` → "Reconnecting…" banner; the normal reconnect does the rest.
- Keepalive is the server's WebSocket ping (20s); React Native's WebSocket answers
  pings natively on both platforms — confirmed on-device per MANUAL-TEST.md.
- Leaving closes the socket via `stop()` (no `leave` frame, matching the browser).

## Call: media

`core/peer.ts` ports `net/peer.js`:
- `RTCPeerConnection` with **no ICE servers** (the SFU advertises a public IP).
- The client offers first: one `sendonly` transceiver per local track, each with its
  own `MediaStream`. A second track of the same kind is `replaceTrack`, not a new
  m-line.
- Every client offer carries `kinds`: `{<msid stream id>: "mic" | "camera"}`.
- Candidates trickle as `{candidate: <RTCIceCandidate JSON>}`; the null
  end-of-candidates is not sent. Inbound candidates are buffered until a remote
  description is set, then drained.
- **Perfect negotiation, client polite** (shared `negotiation.js`). `makingOffer` is
  set only around `createOffer` + `setLocalDescription`; an offer is deferred while
  `makingOffer` or not `stable`. On collision: a bare `setRemoteDescription(offer)`
  (implicit rollback — never an explicit `{type:"rollback"}`), drain candidates,
  answer, then re-offer once stable.
- **Codecs:** the SFU accepts only VP8 and Opus. The client calls
  `setCodecPreferences` on video transceivers to put VP8 first; a Jest test asserts
  the generated offer contains VP8 and Opus.
- No simulcast. Quality caps come from `joined.quality` via the shared `quality.js`,
  applied with `sender.setParameters` (`scaleResolutionDownBy`, `maxFramerate`).
- **Remote tracks:** `tracks {tracks:[{mid, participantId, kind}]}` is joined with
  `ontrack` by `transceiver.mid`, either order. An empty list is ignored entirely; for
  a non-empty list, held mids not listed are dropped. Each remote track gets its own
  `MediaStream` for its `RTCView`.
- **Remote screenshares** (`screen` / `screen-audio` kinds) are received but not
  rendered or played in Foundation; the sharer's camera tile is unaffected. Viewing
  them is sub-project 2.
- **Mic mute:** `track.enabled = false`, no renegotiation, then
  `media-state {mic, camera}`.
- **Camera off:** stop the track, `sender.replaceTrack(null)`, then `media-state`.
  **On:** new `getUserMedia` track, `replaceTrack(track)` (or publish if no sender
  yet), then `media-state`. **Flip** swaps front/back with `replaceTrack`.
- **ICE restart:** on `connectionState` or `iceConnectionState` `failed`, call
  `restartIce()` once with a 6s grace. If still not connected, do a full rejoin
  (close the socket and let reconnect run). There is no page to reload.
- **Rejoin while in a call** (a `joined` arriving after a reconnect), as
  `app.js:259-287`: close the old peer, create a new one (the server built a fresh SFU
  peer), clear remote media and reset the roster from `joined.peers`, republish the
  current mic and camera tracks in a new offer, and apply `joined.quality`.

## Background and lock-screen survival

**iOS**
- Joining reports an **outgoing call** to CallKit (`startCall`, handle = `#<slug>`,
  then `reportConnectedOutgoingCall` on `joined`). `Info.plist` declares the `voip`
  and `audio` background modes.
- CallKit owns the audio session. `RTCAudioSession.useManualAudio = true`;
  `isAudioEnabled` is set true in CallKit's `didActivateAudioSession` and false in
  `didDeactivateAudioSession`. Getting this wrong produces a silent call, so it is
  item one on MANUAL-TEST.md.
- The CallKit mute action and the in-app mic toggle are one state, synced both ways;
  either change sends `media-state`. CallKit's end action leaves the room. Leaving
  in-app or being kicked/banned ends the CallKit call.
- Hold (a cellular call or another VoIP app) mutes the mic; unhold restores the
  mic's previous state.
- On background, if the camera is on: camera off (as above) and remember it. On
  foreground: camera back on.

**Android**
- A **foreground service** of type `microphone|camera` runs from join to leave, with
  an ongoing notification "In call: #<slug>" (tap → return to the call, action →
  Leave). Started before the call screen shows, stopped on leave, kick, ban or a
  fatal error.
- A **self-managed ConnectionService** via CallKeep registers the call with the
  system: Bluetooth headset buttons, and correct behaviour when a cellular call
  arrives mid-meeting (hold/unhold, as on iOS).
- Camera off in the background and back on return, as on iOS.

**Both:** `react-native-incall-manager` starts in video mode when the camera is on
(speaker by default) and audio mode otherwise (earpiece by default, proximity sensor
turns the screen off). Bluetooth and wired headsets take precedence when connected.
The Controls route button cycles the available routes. The screen stays awake while
in the Call screen and in the foreground.

## UI

React Navigation stack: **Home → PreJoin → Call**.

**Call screen**
- Tile grid of `RTCView`s laid out with the shared `gridLayout.js`; portrait stacks
  small calls into one column, matching the web client's narrow-stack behaviour.
- Each tile: display name, muted-mic badge, op marker. Camera off → avatar
  placeholder (Gravatar via `gravatarUrl`, falling back to initials from `avatarFor`).
- Self-view: mirrored, a draggable picture-in-picture corner tile; hidden when the
  camera is off.
- Controls bar: mic, camera, flip camera, audio route, leave. Laid out to take
  sub-project 2's chat/polls/soundboard buttons without rework.
- Banners: "Reconnecting…", "Media connection lost — rejoining…". In-call `error`
  frames show as transient toasts.
- Joining and leaving peers play no sounds in Foundation (call sounds arrive with
  sub-project 2).

## Server change

`internal/server` gains two routes, both `Content-Type: application/json`:

- `GET /.well-known/apple-app-site-association`
  ```json
  {"applinks":{"details":[{"appIDs":["<TEAMID>.<bundle id>"],
   "components":[{"/":"/api/*","exclude":true},{"/":"/ws/*","exclude":true},
                 {"/":"/.well-known/*","exclude":true},{"/":"/*"}]}]}}
  ```
- `GET /.well-known/assetlinks.json` — the standard
  `delegate_permission/common.handle_all_urls` statement for the package and its
  signing-certificate SHA-256 fingerprint(s).

Driven by new config (`internal/config`): `-apple-app-id` / `WVC_APPLE_APP_ID`,
`-android-package` / `WVC_ANDROID_PACKAGE`, `-android-cert-sha256` /
`WVC_ANDROID_CERT_SHA256` (comma-separated). Each route returns 404 when its config is
unset, so existing deployments are unchanged. Covered by Go tests; documented in
README's flag table and `docs/DEPLOY.md`; the Docker and k8s manifests list the env
vars commented out.

The Android intent filter uses `autoVerify` for `https://vc.swiftirc.net` with all
paths; Android has no exclude syntax, so a link whose path fails `link.ts` validation
(e.g. `/api/...`) opens the app's Home screen rather than a room.

## Identity, build and release

- App name **Coyote**. Bundle ID / applicationId **`net.swiftirc.coyote`** (changeable
  before first TestFlight upload; it is also the value for `-apple-app-id` and
  `-android-package`).
- iOS: CocoaPods. Capabilities: Associated Domains (`applinks:vc.swiftirc.net`),
  Background Modes (`audio`, `voip`). Usage strings for camera, microphone and
  Bluetooth. The maintainer's team is selected in Xcode; nothing team-specific is
  committed.
- Android: `minSdk` per the React Native release in use; `targetSdk` current. Release
  signing reads keystore path and passwords from `~/.gradle/gradle.properties` on the
  build machine; nothing is committed.
- `mobile/RELEASE.md` gives the exact Mac steps: `npm ci`, `pod install`, open
  `ios/Coyote.xcworkspace`, select team, Archive → upload to TestFlight; and
  `./gradlew bundleRelease` → upload to Play internal testing. It also lists the
  server env to set for links to work.
- The app version (marketing + build number) is bumped in one place per release,
  documented in RELEASE.md. The server's `/api/version` is shown in an About line on
  Home for bug reports. No forced-update logic.

## Testing

**Automated, run on Linux by Claude for every change:**
- `tsc --noEmit`, ESLint.
- Jest for `core/` against a fake WebSocket and fake RTCPeerConnection:
  - `link.ts`: link forms, slug validation, `#i=` precedence, bad input.
  - `signaling.ts`: `join` frame shape and current-state re-send on reconnect;
    backoff and queueing; foreground/network immediate reconnect; error disposition
    pre-join vs in-call; kicked/banned stop with no rejoin; server-restarting.
  - `peer.ts`: `kinds` on every offer; candidate buffering; collision →
    implicit rollback → answer → re-offer; `tracks`/`ontrack` in both orders; empty
    and pruning `tracks` lists; camera off/on via `replaceTrack`; ICE-restart then
    rejoin fallback; VP8/Opus in the offer.
  - `call.ts`: rejoin while in call rebuilds the peer and republishes; session nonce
    stable across reconnects and fresh per join; background/foreground camera
    handling; CallKit mute ↔ mic sync (against a fake callkit adapter).
  - `gravatar.ts`: shared test vector.
- Go: `.well-known` routes (body shape, content type, 404 when unconfigured, config
  parsing), plus the existing suite.
- Android debug build (`./gradlew assembleDebug`) on Linux, if the Android SDK can be
  installed here; otherwise RELEASE.md's steps are the first build.

**Device, run by the maintainer before each TestFlight / closed-testing build** —
`mobile/MANUAL-TEST.md`, treated as load-bearing like the root `MANUAL-TEST.md`:
- Two-way audio and video with a browser participant (iOS and Android).
- Lock the screen mid-call: the other side still hears you and you hear them; camera
  shows the placeholder; unlock restores the camera.
- Switch apps for 2 minutes and return: call intact or rejoins within seconds.
- Mute from the lock screen / Control Centre / notification; in-app state matches.
- End from the lock screen: you leave the room.
- A cellular call arrives mid-meeting: held, mic muted; after hanging up, resumes.
- Bluetooth headset connect/disconnect mid-call; route button cycles routes.
- Airplane mode for 10s then off: rejoins, media resumes.
- Tap an `#i=` link in an IRC client: app opens to PreJoin with the invite's name;
  a second device using the same link is refused.
- Get kicked by an op on the web: app returns to Home with the message and stays out.
- Server restart mid-call: "Reconnecting…", then back in.

Every change that touches iOS-only native code or configuration comes with the
specific MANUAL-TEST.md items to re-run.

## Out of scope (Foundation)

Chat, polls, soundboard, screenshare viewing and sending, per-participant volume,
low-bandwidth mode, room timer, rename, settings menu, call sounds, op moderation,
background effects, push notifications / incoming-call ringing, room favourites with
live occupancy, multiple built-in hosts, a tablet- or landscape-specific layout, and
any change to the wire protocol.
