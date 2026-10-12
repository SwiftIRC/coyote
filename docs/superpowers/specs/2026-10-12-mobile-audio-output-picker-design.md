# Mobile apps — Audio output picker (iOS & Android)

Follow-up to [Heavy sending](2026-10-11-mobile-heavy-sending-design.md). App 1.6.0
(iOS build 10 / Android versionCode 10).

## Problem

The call screen's audio button cycles Phone → Speaker → Bluetooth → Headset. Two
problems:

- **It can't tell Bluetooth devices apart.** react-native-incall-manager exposes one
  generic `BLUETOOTH` route, so someone with earbuds and a car connected can't choose
  between them.
- **On Android it doesn't work at all** (reported on device 2026-10-12, not yet
  confirmed with logcat). Android calls run as a self-managed callkeep
  `ConnectionService` call, so Telecom owns audio routing, while incall-manager routes
  behind its back with `AudioManager.setSpeakerphoneOn` and its own SCO handling. The
  likely result is that Telecom overrides every change.

## Goal

Replace the cycling button with an output picker. Users see every available output,
each Bluetooth device by name where the platform allows, and pick one. The button
always shows the real current output, including after changes made outside the app.

Outputs only: Bluetooth headsets switch mic and speaker together, and nobody asked for
a separate microphone choice.

## Decisions

- **iOS uses the system route picker.** iOS has no API to list outputs or select one by
  name; `AVRoutePickerView` (the Control Centre / CallKit sheet) is the supported way
  and lists every AirPods, car and speaker. Agreed with the user.
- **Android routes through Telecom (approach A).** The picker drives the active callkeep
  `VoiceConnection`: Telecom is already in charge of routing for a self-managed call, so
  working through it fixes the current bug and gives per-device Bluetooth selection.
  Rejected: `AudioManager.setCommunicationDevice` (API 31+), which Telecom would likely
  override just like today; and dropping the `ConnectionService` on Android, which
  loses Bluetooth buttons, cellular hold and background survival.
- **incall-manager stops routing on Android.** A single owner of routing. incall-manager
  stays the fallback when there is no Telecom connection, and stays as-is on iOS.
- **Button shows the kind, not the device name.** "Galaxy Buds3 Pro" doesn't fit the
  76 pt cap; the accessibility label carries the full name.
- **In-house native modules, no new third-party dependency**, like CoyoteSounds and
  CoyoteBackground.

## Android: native module `CoyoteAudioRoute`

Kotlin, `android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRouteModule.kt` (+
package, registered in `MainApplication`).

### Interface

```ts
type OutputKind = "earpiece" | "speaker" | "wired" | "bluetooth";
interface Output { id: string; kind: OutputKind; name: string }
interface Routes { outputs: Output[]; selected: string }  // selected is an Output id, "" if unknown

start(callId: string, video: boolean): Promise<boolean>  // false → no Telecom connection, use fallback
stop(): void
routes(): Promise<Routes>
select(id: string): Promise<void>
// event "CoyoteAudioRoutes": Routes, on any change of list or selection
```

`id` is stable while the device stays connected: `earpiece`, `speaker`, `wired`, and
`bt:<MAC address>` (or `bluetooth` when only the type is known). `name` is the device's
Bluetooth name, or "Phone" / "Speaker" / "Headset" for built-in and wired outputs.

### Reading and switching, by API level

The module finds the connection with `VoiceConnectionService.getConnection(callId)`.

- **API 34+:** `CallEndpoint`s. The connection reports
  `onAvailableCallEndpointsChanged(List<CallEndpoint>)` and
  `onCallEndpointChanged(CallEndpoint)`; selection is
  `requestCallEndpointChange(endpoint, executor, callback)`. Endpoint type maps to
  `kind`, endpoint name to `name`, and the endpoint's identifier to `id`.
- **API 28–33:** `CallAudioState`: `getSupportedRouteMask()` for earpiece / speaker /
  wired, `getSupportedBluetoothDevices()` for each Bluetooth device, `getActiveBluetoothDevice()`
  and `getRoute()` for the selection. Selection is `setAudioRoute(route)` for built-in and
  wired routes, and `requestBluetoothAudio(device)` for a specific Bluetooth device.
- **API 24–27:** `CallAudioState` route mask only; one `bluetooth` output named
  "Bluetooth"; `setAudioRoute(ROUTE_BLUETOOTH)`.

The module reads state from the connection's latest callbacks, not `getCallAudioState()`
polling (deprecated on 34).

### Callkeep patch

`VoiceConnection.onCallAudioStateChanged` only logs today. Extend the existing
`patches/react-native-callkeep+4.3.16.patch` so `VoiceConnection` forwards
`onCallAudioStateChanged`, and on API 34+ also overrides `onCallEndpointChanged` and
`onAvailableCallEndpointsChanged`, to a static listener that `CoyoteAudioRoute`
registers (a small `AudioRouteListener` interface in callkeep's package, set to null
when the module stops). `test/nativeModules.test.ts` asserts the patched file still
contains the forwarding, like the existing patch guards.

### Taking over from incall-manager

When `start` finds a connection, incall-manager is not started on Android.
`CoyoteAudioRoute` does its remaining jobs:

- **Keep the screen on**: `FLAG_KEEP_SCREEN_ON` on the activity window while the call
  runs.
- **Proximity**: a `PROXIMITY_SCREEN_OFF_WAKE_LOCK` held while the selected output is
  the earpiece, released otherwise and on stop.
- **Starting output**: once the first endpoint/state report arrives, if a wired or
  Bluetooth output is present, leave Telecom's choice alone; otherwise select
  `speaker` for a video call and `earpiece` for audio-only (falling back to `speaker`
  when there is no earpiece, e.g. tablets).

Telecom sets the call audio mode and audio focus for self-managed calls (Telecom's
`CallAudioModeStateMachine` handles VoIP calls). **Risk:** if a device test shows no
call audio mode, keep incall-manager started for the mode only and stop its routing:
start it with `auto: false` and never call its route methods. This is the first
on-device check (MANUAL-TEST, see Testing).

### Fallback

`start` resolves `false` when callkeep setup failed or no connection exists for the call
id within 2 s. JS then runs today's incall-manager path, adapted to the new shape: the
outputs are the route types incall-manager reports (`onAudioDeviceChanged`), the
selection goes through `chooseAudioRoute`, and the picker shows types only.

## iOS

- **`CoyoteRoutePicker`**, a native view component (Swift + ObjC view manager)
  wrapping `AVRoutePickerView`, `prioritizesVideoDevices = false`, with its own button
  graphics hidden (clear tint). It is laid over the audio button at the same size, so
  our button draws the label and the tap opens the system sheet.
- **`CoyoteAudioRoute`** (Swift + ObjC) reports the current output only, from
  `AVAudioSession.sharedInstance().currentRoute.outputs.first`, and emits the same
  `CoyoteAudioRoutes` event on `AVAudioSession.routeChangeNotification`. Port type maps
  to `kind` (built-in receiver → earpiece, built-in speaker → speaker, headphones /
  USB → wired, Bluetooth HFP / A2DP / LE → bluetooth, car audio → `car`, other →
  `speaker`); `name` is the port name. `outputs` holds just that one output; `select`
  is not implemented on iOS.
- incall-manager stays exactly as today on iOS, including starting video calls on the
  speaker. iOS adds `car` to `OutputKind`.

## JavaScript

### `core/audioRoutes.ts` (rewritten, pure)

- The `Output`, `OutputKind` and `Routes` types.
- `outputLabel(kind)`: Phone / Speaker / Bluetooth / Headset / Car (button text).
- `sortOutputs(outputs)`: earpiece, speaker, wired, then Bluetooth by name.
- `initialOutput(outputs, video)`: the starting-output rule above, used by the
  fallback path (the Android module applies the same rule natively).
- A small pending-selection reducer: `select(id)` marks pending; a routes update whose
  `selected` equals the pending id clears it; a 5 s timeout clears it and yields a
  failure notice.

`nextRoute`, `cycleRoute` and `core/iosRoute.ts` are deleted.

### `native/audioRoute.ts`

Keeps its role as the platform glue: `startCallAudio(callId, video)` /
`stopCallAudio()` choose the Android module or the incall-manager fallback;
`watchRoutes(fn)` subscribes to `CoyoteAudioRoutes` (or the fallback's events);
`selectOutput(id)` is Android only. `startCallAudio` now needs the call id, so the Call
screen passes the id it already gives the system call.

### UI

- **`Controls`**: the audio button keeps its place and 76 pt cap. Label is
  `outputLabel(selected.kind)`, or "…" while a selection is pending. Accessibility
  label: "Audio output: <name>". On iOS the button is wrapped with `CoyoteRoutePicker`
  overlaid on top; on Android `onRoute` opens the sheet.
- **`AudioRouteSheet`** (Android), built on `Sheet` like `BackgroundSheet`: one row per
  output with a kind icon, the name, and ✓ on the selected one. Tapping a row calls
  `selectOutput` and closes the sheet. The list updates live while open.
- **Failure notice**: "Couldn't switch to <name>." through the call's existing notice
  channel (shown by `Banner`).

## Edge cases

- **The selected device disconnects**: Telecom / iOS falls back; the label follows. We
  don't override.
- **A device connects mid-call**: the system decides whether to move to it; we follow
  what it reports.
- **No earpiece** (tablets): never listed; with nothing connected the sheet shows only
  Speaker.
- **Leaving the call**: listeners removed, keep-screen-on cleared, proximity wake lock
  released, the patch's static listener unset. Telecom resets routing when the
  connection ends.
- **Selecting the already-selected output**: closes the sheet, no call.

## Testing

- **Jest**: `core/audioRoutes.ts` (labels, sorting, starting output, pending reducer
  and timeout), `AudioRouteSheet` rows / selection / live update, `native/audioRoute.ts`
  fallback selection with mocked modules, and the callkeep patch guard in
  `nativeModules.test.ts`.
- **Typecheck, lint, Android Gradle build** here. Swift / ObjC is compiled on the Mac.
- **MANUAL-TEST items** (new, after 69):
  - Android 14+ phone: call audio plays (risk check), proximity turns the screen off on
    the earpiece, speaker ↔ earpiece switching works.
  - Android 9–13 device: the same.
  - Two Bluetooth devices connected: both listed by name; selecting each moves audio.
  - Switching from outside the app (headset button, toggling Bluetooth, the Bluetooth
    device disconnecting) updates the label.
  - Tablet: list shows Speaker plus any Bluetooth devices, never Phone.
  - Bluetooth selection that fails (device switched off just before tapping) shows the
    notice after 5 s and the label returns to the real output.
  - iPhone: the system picker opens over the button and lists AirPods etc.; the label
    follows a switch made from Control Centre; video calls still start on the speaker.

## Release

1.6.0, iOS build 10 / Android versionCode 10 (bump both, all four iOS places). Release
gates: Swift / ObjC compiled on the Mac; the Android risk check above passes on device.

## Out of scope

- Microphone selection.
- Forcing a newly connected device to take over the call.
- The Android video tile resize bug (still deferred).
