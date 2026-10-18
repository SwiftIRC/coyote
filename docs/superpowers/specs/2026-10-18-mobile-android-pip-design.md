# Mobile apps — Picture-in-picture (Android)

Follow-up to [Microphone and camera selection](2026-10-12-mobile-device-pickers-design.md).
App 1.8.0 (iOS build 13 / Android versionCode 13).

## Problem

Leaving the app during a call (Home, the swipe-up gesture, switching apps) hides the
call completely: the camera turns off and the only trace is the call notification.
Play Console suggests picture-in-picture, and people expect it from a video call app.

## Goal

On Android, leaving the app during a live call shrinks the call into a floating
picture-in-picture window. The window shows one video tile and offers mute and hang
up. The call itself carries on exactly as now; only its presentation changes.

## Decisions

- **Android only.** Answers the Play suggestion. iOS PiP for a WebRTC call needs
  `AVPictureInPictureController` fed frames through `AVSampleBufferDisplayLayer`, a
  much larger native job; left for a later round. Agreed with the user.
- **Automatic entry, no button.** Leaving the app during a live call enters PiP (Android
  12+ auto-enter, `onUserLeaveHint` on 8–11). No ☰ entry, no in-app setting; Android's
  per-app PiP switch in system settings turns it off. Agreed with the user.
- **The camera keeps sending in PiP.** A PiP activity is still on screen, so Android
  allows the camera without new permissions. The camera only turns off when the app is
  truly off screen. Agreed with the user.
- **Closing the PiP window keeps the call going**, the same as pressing Home does today
  (camera off, notification, camera back on return). Agreed with the user.
- **One tile, picked by priority** (screenshare, then the first remote person, then
  yourself). No speaker detection: the app has none today, and adding it is a new
  subsystem. Agreed with the user over a 2×2 mini grid.
- **No new third-party dependency.** An in-house Kotlin module, like `CoyoteAudioRoute`.

## Behaviour

### Entering and leaving PiP

- PiP is allowed only while the call phase is `in-call` or `reconnecting`. Home,
  PreJoin and a call still `connecting` never enter PiP.
- Android 12+ (API 31): `PictureInPictureParams.setAutoEnterEnabled(true)` while
  allowed, so the system animates into PiP on Home or the gesture.
- Android 8–11 (API 26–30): `MainActivity.onUserLeaveHint` calls
  `enterPictureInPictureMode` while allowed.
- Android 7 (API 24–25) has no PiP: nothing changes there.
- PiP turned off for Coyote in system settings: entry quietly doesn't happen and the
  app behaves as today.
- Tapping the PiP window and choosing expand returns to the full call screen.
- The MediaProjection consent dialog for a starting screenshare doesn't count as leaving
  the app (no `onUserLeaveHint`), so it doesn't enter PiP.

### Camera and the app's on-screen state

Today `native/lifecycle.ts` feeds React Native's `AppState` to `Call.onAppState`, and
`background` turns the camera off (restored on `active`). On Android `AppState` reports
`background` on `onPause`, which also fires when the activity shrinks into PiP.

- On Android, `lifecycle.ts` stops using `AppState` for `onAppState` and follows the
  activity's on-screen state from the native module instead: `onStop` →
  `call.onAppState("background")`, `onStart` → `call.onAppState("active")`. A PiP
  activity is paused but not stopped, so the camera keeps sending.
- Each event is delivered once per transition; repeated starts or stops with no change
  in between are dropped, so a restore can't be triggered twice.
- iOS keeps using `AppState`, unchanged.
- NetInfo handling is unchanged on both platforms.

### Closing the PiP window

Swiping the window away or tapping its ✕ stops the activity: the backgrounding path
above runs (camera off, call continues with its notification). Opening the app again
starts the activity: the camera comes back and the full call screen shows.

### What the window shows

`pipTile(people, selfSharing)` in a new `core/pip.ts`, a pure function over the same
participant list the grid uses (`gridTiles` order):

1. the first remote participant who is sharing a screen → their screenshare;
2. otherwise the first remote participant → their camera, or avatar and name when
   their camera is off;
3. otherwise (alone in the room) → yourself (self view, or your avatar when your camera
   is off).

Your own outgoing screenshare is never the PiP tile. It returns the tile and its
aspect: 16:9 for a screenshare, 3:4 for a person.

While in PiP, `Call.tsx` renders `PipView` instead of its normal content: the one tile
filling the window, its name, and "+N" for the other participants when there are any.
No top bar, controls, sheets, banners or notices. Only one video view is mounted, which
also keeps hidden Android SurfaceViews from bleeding through.

Entering PiP closes any open sheet (and with it the keyboard) and the full-screen
`ScreenViewer` (a `Modal`, a separate window). Expanding back shows the normal call
screen with nothing open.

If the picked tile changes while in PiP (that person leaves, a share starts or stops),
`PipView` re-renders with the new pick and the new aspect goes to native.

### PiP buttons

Two `RemoteAction`s on the PiP window:

- **Mic**: "Mute" / "Unmute", icon reflecting the current state, calls the same
  `Call.setMic` the control bar uses.
- **Hang up**: calls the same leave path as the control bar's hang up.

Native refreshes the actions whenever JS reports a mic change.

### Call ending while in PiP

When the call ends for any reason (hang up from PiP, kicked, banned, failed), JS sends
`setPip({ enabled: false })`. If the activity is in PiP, native brings it back to the
front of its task so the window closes and the user sees wherever the app goes after a
call, as today.

## Components

### Native: `CoyotePip` (Kotlin)

`android/app/src/main/java/net/swiftirc/coyote/CoyotePipModule.kt` + `CoyotePipPackage.kt`,
registered in `MainApplication` like the other in-house packages.

- `setPip({ enabled: boolean, micOn: boolean, aspect: "screen" | "person" })`: stores
  the state and, on API 26+, applies `PictureInPictureParams` (aspect ratio 16:9 or
  3:4, actions, and `setAutoEnterEnabled(enabled)` on 31+) with
  `activity.setPictureInPictureParams`. When `enabled` turns false while in PiP, moves
  the task's activity back to the front (the PiP window closes).
- Events: `CoyotePipChanged { inPip: boolean }`, `CoyotePipVisibility { visible:
  boolean }` (from `onStart`/`onStop`), `CoyotePipAction { action: "mic" | "hangup" }`.
- `isSupported()`: API 26+ and the device has `FEATURE_PICTURE_IN_PICTURE`.
- PiP buttons: `PendingIntent.getBroadcast` (immutable) to a receiver registered by the
  module (not exported) that emits `CoyotePipAction`.
- Icons: two vector drawables (mic / mic off) and one for hang up, added to `res/drawable`.

`MainActivity` forwards `onUserLeaveHint`, `onPictureInPictureModeChanged`, `onStart` and
`onStop` to the module (a small static hook, since the module may not exist yet when the
activity starts; the latest visibility is kept and sent when JS subscribes).

Manifest: `android:supportsPictureInPicture="true"` on `MainActivity`. Its
`configChanges` already include `screenSize|smallestScreenSize|screenLayout|orientation`,
so resizing into PiP doesn't recreate the activity.

### JS

- `src/native/pip.ts`: wraps the module (no-op on iOS and when unsupported):
  `setPip`, `onPipChanged`, `onVisibility`, `onPipAction`.
- `src/native/lifecycle.ts`: on Android, `onAppState` comes from `onVisibility`
  (deduplicated) instead of `AppState`.
- `src/core/pip.ts`: `pipTile` (pure, unit-tested).
- `src/ui/components/PipView.tsx`: renders the picked tile with name and "+N", reusing
  `Tile` / `ScreenTile` / `SelfView`.
- `src/ui/screens/Call.tsx`: tracks `inPip`; renders `PipView` while true; closes sheets
  and the screen viewer on entry; sends `setPip` whenever liveness, mic or the picked
  tile's aspect changes, and `enabled: false` on unmount or call end; routes
  `CoyotePipAction` to `Call.setMic` / leave.

## Testing

Jest:

- `test/pip.test.ts`: every branch of `pipTile` (sharer first, first remote person with
  and without camera, alone → self, own share ignored, several sharers → the first) and
  the aspect for each.
- `test/lifecycle.test.ts`: on Android, visibility events map to `onAppState`, repeats
  are dropped, `AppState` changes are ignored; on iOS `AppState` is still used.
- PiP actions: `mic` toggles via `Call.setMic`, `hangup` takes the leave path.
- `test/nativeModules.test.ts`: the manifest declares `supportsPictureInPicture`,
  `MainActivity` forwards the four callbacks, and `CoyotePipPackage` is registered.

Manual (new MANUAL-TEST items):

- Android 12+: Home and the gesture during a call enter PiP smoothly; others still see
  your camera; your audio continues.
- Android 8–11 (if a device is available): Home enters PiP.
- Mic button mutes and unmutes (others hear it, icon follows); hang up ends the call
  and the window closes.
- Swipe the window away: still in the call (notification), camera off for others;
  reopen the app: camera back, full call screen.
- Someone sharing: the window shows the share in 16:9; when it stops, it switches to a
  person in 3:4.
- Open the chat sheet (keyboard up) or the screen viewer, press Home: PiP shows the
  tile, and expanding shows the call screen with nothing open.
- Alone in the room: the window shows your self view.
- Being kicked while in PiP: the window closes and the app shows where a kick lands today.
- Incoming phone call while in PiP: nothing breaks; the camera behaves as on backgrounding.
- Leaving the app on Home or PreJoin: no PiP.
- PiP turned off for Coyote in system settings: Home behaves as before.

## Release

1.8.0, iOS build 13 / Android versionCode 13; both platforms bumped together though only
Android changes.

## Out of scope

iOS PiP, speaker detection, a manual PiP button or in-app setting, `sourceRectHint`
animation tuning, and showing more than one tile.
