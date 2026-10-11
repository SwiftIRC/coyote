# Mobile apps — Heavy sending features (iOS & Android)

Sub-project 4 of 4. Builds on [Foundation](2026-10-08-mobile-foundation-design.md),
[Room features](2026-10-11-mobile-room-features-design.md) and
[Op moderation](2026-10-11-mobile-op-moderation-design.md).

## Problem

Two things a browser can send that a phone cannot: a **screenshare**, and a camera
with its **background blurred or replaced**. Phones already *receive* both (a
screenshare renders as a ScreenTile; a remote blur is just video). Everything needed
on the wire already exists: the SFU accepts the `screen` kind, room screen-quality
caps apply to it, and an op's "stop share" reaches the sharer as `muted{kind:"screen"}`.

## Scope

Two releases, like 2a/2b, from one spec with a plan per release:

- **4a (app 1.4.0, iOS build 7 / Android versionCode 7): screenshare sending.**
  Video only. iOS via a ReplayKit Broadcast Upload Extension, Android via
  MediaProjection.
- **4b (app 1.5.0, iOS build 8 / Android versionCode 8): background effects.**
  None, Blur, Blur+, and the server's photographic scenes. Native segmentation:
  Apple Vision on iOS, ML Kit Selfie Segmentation on Android.

## Decisions

- **Screenshare first.** It is the more requested capability and adds no third-party
  native dependency.
- **Video only, no screen audio.** react-native-webrtc's capture is video-only on both
  platforms; adding audio means a custom audio path through the broadcast extension
  (iOS) and `AudioPlaybackCapture` (Android 10+), which many apps opt out of. The
  sharer's mic keeps working, so they can talk over it.
- **Use react-native-webrtc's built-in plumbing.** v124 already has Android
  `getDisplayMedia` with its own `MediaProjectionService`, the iOS
  `ScreenCaptureController` socket fed by a broadcast extension through an App Group,
  the `ScreenCapturePickerView` that opens the system broadcast sheet, and
  `ProcessorProvider` + `track._setVideoEffects()` for native per-frame processors.
  No new JS dependency; no fork or patch expected.
- **Share lives in ☰, stop is always visible.** A ☰ item (Share screen / Stop sharing)
  rather than a seventh controls-bar button; while sharing, a red pill at the top of
  the call screen stops it in one tap.
- **No self-preview of your own share.** It would show the call screen inside itself.
  Your share shows as a placeholder tile.
- **Camera behaviour unchanged.** Backgrounding still turns the camera off (required on
  iOS). Sharing another app therefore means your camera is off until you return —
  the norm for phone call apps.
- **Platform-native segmentation** (rejected: MediaPipe on both — the Foundation
  spec's assumption). Vision's `VNGeneratePersonSegmentationRequest` ships with iOS
  (min target is 17), runs on the Neural Engine, and adds nothing to the app. ML Kit
  Selfie Segmentation is one Gradle dependency (~4.5 MB, model bundled, no Play
  Services). MediaPipe Tasks would add ~10–20 MB per platform and framework quirks to
  the Mac build. Edges will not match the web exactly; a viewer sees one person's
  effect at a time, so that is acceptable.
- **Scenes come from the server, not the app bundle.** Four of the web's six scenes
  are frames from copyrighted film and television, deliberately untracked in git
  (see `internal/server/scenes.go`, THIRD-PARTY-NOTICES.md). Bundling them would
  redistribute them in store binaries. Instead the app fetches the server's scene
  list (new `GET /api/scenes`) and downloads the images to its cache — the soundboard
  pattern from 2b. A clone without the stills offers only the two NASA/ESA nebulae,
  exactly as its web client does.
- **Procedural backgrounds and custom upload are not ported.** The painters are JS
  canvas code that would need two native rewrites kept pixel-matched with the web.
- **Android composites on the CPU at 640×360.** While an effect is on, Android's
  camera output is 640×360 (others see a lower-resolution camera). A GL shader
  pipeline on the texture frames would keep 720p but is much harder to debug without
  an emulator; it is a later optimisation. iOS composites at the full 720p.
- **Effects are local.** Nothing goes over signaling; screenshares are never processed.

## 4a — Screenshare sending

### `core/screenShare.ts`

A store beside `Call`, following `Moderation`/`Polls`, exposed as `call.screenShare`.

- State: `{ status: "idle" | "starting" | "sharing" }`, subscribe/notify like the
  other stores.
- `start()`: `idle → starting`; asks the native wrapper for a display track; on a
  track, → `sharing`, listens for the track's `ended`, and
  `peer.publish(track, "screen")`; if publishing fails, the share is stopped with
  the failure notice. A cancel (user dismissed the sheet / denied consent / timeout) → `idle`
  silently. Any other error → `idle` and the notice **"Couldn't start screen
  sharing."** Calling `start()` while not idle is a no-op.
- `stop(reason)`: unpublishes `screen`, stops the track, → `idle`. Idempotent. Reasons:
  `"user"` (pill / ☰), `"ended"` (system UI ended the track), `"op"` (shows the
  notice **"An op stopped your screen share."**), `"leave"` (call finished).
- `onReconnected(peer)`: if `sharing` and the track is still `live`, republish it on
  the new peer; if the track died while offline, `stop("ended")`.
- The store depends on a narrow `ScreenCapture` interface (from `src/native/`) and on
  `publish`/`unpublish` callbacks, so jest tests it with fakes.

### `Call` wiring

- `call.screenShare` is created with the call; `finish()` calls `stop("leave")`.
- The existing `onForceMuted(kind)` gains `"screen"` → `screenShare.stop("op")`.
- The rejoin path that republishes mic and camera also calls
  `screenShare.onReconnected`.
- Room screen-quality caps already apply through `applyQuality("screen")`.

### Native: `src/native/screenCapture.ts`

`startDisplayCapture(): Promise<MediaStreamTrack>` and a `CaptureCancelled` error.

- **Android:** `mediaDevices.getDisplayMedia({ video: true })`. react-native-webrtc
  shows the system consent prompt and runs `MediaProjectionService` (foreground,
  type `mediaProjection`). A denied prompt rejects → `CaptureCancelled`. Android 15
  single-app sharing comes from the system dialog for free.
- **iOS:** `getDisplayMedia` opens react-native-webrtc's socket server in the App
  Group container and resolves at once with an idle track; the wrapper then calls
  an in-house `CoyoteScreenShare.showPicker()`, which taps a hidden
  `RPSystemBroadcastPickerView` (our extension preselected) so the system **Start
  Broadcast** sheet appears. The extension posts the Darwin notification
  `net.swiftirc.coyote.broadcast.started` once its socket is connected;
  `CoyoteScreenShare` relays it as the RN event `CoyoteBroadcastStarted`, which
  confirms the share. With no confirmation within 30 s (sheet dismissed), the
  wrapper stops the track and rejects with `CaptureCancelled`. Stopping the
  broadcast from Control Center or the red status pill closes the socket and ends
  the track.

### iOS broadcast extension `CoyoteBroadcast`

- A Broadcast Upload Extension target in `ios/Coyote.xcodeproj`, bundle id
  `net.swiftirc.coyote.broadcast`, embedded in the app.
- Its `SampleHandler`, `SocketConnection` and `SampleUploader` follow Jitsi's
  react-native-webrtc sample (Apache-2.0;
  credited in THIRD-PARTY-NOTICES.md). Frames are downscaled and JPEG-encoded before
  upload to stay under the extension's 50 MB memory limit. Audio sample buffers are
  ignored.
- App Group `group.net.swiftirc.coyote` on both targets (entitlements files).
- App Info.plist: `RTCAppGroupIdentifier = group.net.swiftirc.coyote`,
  `RTCScreenSharingExtension = net.swiftirc.coyote.broadcast`.
- If the app is not sharing (no socket to connect to within 5 s), the extension
  finishes the broadcast with the message "Start screen sharing from a Coyote
  call."

### Android

- Manifest: `FOREGROUND_SERVICE_MEDIA_PROJECTION` (required on Android 14+;
  `FOREGROUND_SERVICE` is already declared). The service itself is declared by
  react-native-webrtc's manifest.

### UI

- **☰ More sheet:** a **Share screen** row (or **Stop sharing** while sharing;
  disabled with "Starting…" while starting). Tapping Share closes the sheet first,
  so the system sheet/prompt is not stacked over ours.
- **Sharing pill:** while `sharing`, a red pill centred just above the controls
  (clear of the TopBar and the notices at the top): **"Sharing your screen ·
  Stop"**, one tap stops. Accessibility label "Stop sharing your screen".
- **Own share tile:** while `sharing`, a ScreenTile-sized placeholder in the grid
  reading "You're sharing your screen" — no video, not tappable. Remote shares are
  unchanged.

## 4b — Background effects

### Server: `GET /api/scenes`

Returns the scene list the web shell already embeds — `[{id, label, src}]` from
`buildScenes`, alphabetical, `src` version-stamped and absolute-path — as JSON with
the same caching headers as `GET /api/soundboard`. No other server change. Go tests:
the handler returns the embedded scenes; an empty scene dir returns `[]`.

### Catalogue: `core/backgrounds.ts`

- Built-in effects: `none`, `blur` (radius 1.2% of frame height), `blur-strong` (3%),
  matching the web's ids and strengths.
- Scenes: from `GET /api/scenes`, fetched once per call when the picker opens or a
  scene pref must be applied. The full image is fetched natively — as `CoyoteSounds`
  does for board clips — by `CoyoteBackground.setEffect` itself, cached in the app's
  cache directory under a hash of the absolute URL (a new server build changes the
  version-stamped `src`, so a changed image is re-downloaded). Picker thumbnails are
  plain RN `<Image>`s of the same URL (WebP decodes natively on iOS 17 and Android).
- `effectFor(id)` → `{ kind: "none" } | { kind: "blur", radius } | { kind: "scene",
  url }`. An id the server no longer offers, or a scene whose download fails
  (`setEffect` rejects), resolves to `none` for this call without clearing the pref,
  with the notice "Couldn't load that background."

### Native module `CoyoteBackground`

In-house (Swift / Kotlin), like `CoyoteSounds`. At startup it registers one
processor named `coyote-background` with react-native-webrtc's `ProcessorProvider`.

- `setEffect({ kind, radius?, url? }): Promise<void>` configures the shared
  processor; for a scene it downloads (or reuses the cached file), decodes and
  pre-scales the image off the frame thread, and resolves once the effect is live.
  The previous effect stays in place until then.
- JS attaches with `track._setVideoEffects(["coyote-background"])` and detaches for
  `none`, so None costs nothing per frame. Every new camera track (camera off→on,
  rejoin) gets the current effect reapplied; a camera flip keeps the same source and
  the effect.
- Emits `CoyoteBackgroundTripped` (with a reason: `"slow"` or `"failed"`).

**iOS pipeline.** `RTCCVPixelBuffer` → Vision `VNGeneratePersonSegmentationRequest`
(`.balanced`, run on at most ~15 fps of frames; others reuse the latest mask) →
mask slightly feathered → Core Image composite (`CIGaussianBlur` with the clamped
frame, or the scene centre-cropped) via `CIBlendWithMask` → rendered by a
Metal-backed `CIContext` into a `CVPixelBufferPool` buffer at the input size →
new `RTCVideoFrame` with the original timestamp and rotation.

**Android pipeline.** `VideoFrame` → `toI420()` → scaled to 640×360 → ARGB Bitmap →
ML Kit Selfie Segmenter (`STREAM_MODE`, raw size mask off) → mask → Canvas composite
(blur = downscale-then-upscale with bilinear filtering, as the web's fallback; scene =
pre-scaled centre-crop bitmap) → I420 (`JavaI420Buffer`) → new `VideoFrame` with the
original timestamp and rotation. The ML Kit call is synchronous on the processor
thread (`Tasks.await`); if it is still busy, the previous mask is reused.

**Circuit breaker** (a port of the web guard's intent). Native keeps a rolling
average of per-frame processing time. Above the budget (45 ms) for ~3 s after a
2 s warm-up, or if the segmenter fails to initialise, the processor passes frames
through untouched and emits `tripped`. JS detaches it, sets the call's effect to
`none`, and shows **"Background effect turned off: this phone couldn't keep up."**
(or "…couldn't start." for `failed`). The pref is kept, so the next call tries
again.

### Prefs

`prefs.background: string` (default `"none"`), saved through the existing prefs
helpers; applied on every join after the camera track exists.

### UI

- **Background sheet** (`BackgroundSheet.tsx`): a grid of tiles — None, Blur, Blur+,
  then one thumbnail per server scene. The current choice is ticked; a scene being
  applied shows a spinner on its tile. Selecting applies immediately and saves the
  pref.
  Offline / fetch failure: the built-in three only, with a line "Scenes unavailable
  offline."
- **PreJoin:** a **Background** row beside the self-preview opens the sheet; the
  preview shows the effect live.
- **☰ More sheet:** **Background…** opens the sheet.
- The front-camera self-view is mirrored as today, so a scene appears mirrored to
  you and correct to everyone else — as on the web.

## Lifecycle

- **Background (app):** camera off as today; the processor sees no frames. A
  screenshare keeps running (that is the point) — on iOS the broadcast extension
  keeps capturing while the app stays alive on its VoIP/audio background modes; on
  Android the media-projection foreground service keeps it alive.
- **Lock screen:** iOS ends the broadcast when the device locks (system behaviour);
  the track ends → `stop("ended")`. Android keeps projecting a black/secure frame.
- **Reconnect:** screen track republished if live; effect reapplied to the new camera
  track.
- **Leave / kicked / banned:** share stopped; effect detached with the camera.

## Testing

Jest, with native modules faked behind the `src/native/` wrappers as `sounds.ts` is
today:

- `screenShare.ts`: start → sharing; cancel → idle with no notice; error → idle with
  notice; the four stop reasons (user, ended, op with notice, leave); start while not
  idle is a no-op; reconnect republishes a live track and stops on a dead one.
- `Call`: `muted{kind:"screen"}` stops the share; `finish()` stops it.
- `backgrounds.ts`: catalogue; unknown/old id → none without clearing the pref;
  `setEffect` rejection → none + notice; scene list fetch failure → built-ins only; effect reapplied
  on a new camera track; `tripped` → none + notice, pref kept.
- `nativeModules.test.ts` guards: Info.plist has `RTCAppGroupIdentifier` and
  `RTCScreenSharingExtension`; the pbxproj has the `CoyoteBroadcast` target; both
  entitlements files have the App Group; the Android manifest has
  `FOREGROUND_SERVICE_MEDIA_PROJECTION`; `CoyoteBackground` is registered on both
  platforms.
- Go: `GET /api/scenes`.

Manual device checklist additions in `mobile/MANUAL-TEST.md`:

- **4a:** iOS share via the broadcast sheet; cancel the sheet; stop from Control
  Center; Android consent denied; Android 15 single-app share; op stops the share
  from the web; lock the phone while sharing; reconnect mid-share; web and mobile
  viewers see it at the room's screen quality.
- **4b:** each effect on both platforms; flip camera; camera off→on; switch effect
  mid-call; breaker trips on an older phone; Android 640×360 seen from the web;
  scenes offered match the server's web picker.

## Release

- **4a gate:** in the Apple Developer portal, create the App Group
  `group.net.swiftirc.coyote`, enable it on the app's App ID, create the
  `net.swiftirc.coyote.broadcast` App ID with the group, and a provisioning profile
  for it (RELEASE.md documents this). The Swift extension is first compiled on the
  Mac.
- **4b gate:** deploy the server with `GET /api/scenes` before 1.5.0 (an older server
  404s → built-in effects only, no error). ML Kit adds ~4.5 MB to Android. Swift and
  Kotlin processors are first compiled and run on device by the user.

## Out of scope

Screen audio; procedural backgrounds; custom image upload; Android GL compositing;
processing screenshares; picture-in-picture; any signaling change.
