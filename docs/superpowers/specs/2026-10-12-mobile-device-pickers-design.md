# Mobile apps — Microphone and camera selection (iOS & Android)

Follow-up to [Audio output picker](2026-10-12-mobile-audio-output-picker-design.md). App
1.7.0 (iOS build 11 / Android versionCode 11).

## Problem

The web client lets people choose their microphone and camera. The mobile apps don't:
the mic is always the system default, and the camera only flips between front and
back. Someone with a Bluetooth headset, a USB mic on an iPad, or a phone with an
ultra-wide or telephoto camera can't pick them.

## Goal

The audio button opens one devices sheet, on both platforms, with three sections:
Output, Microphone, Camera. Each lists what the phone offers, with ✓ on the current
choice, and follows changes made outside the app.

## Decisions

- **Android: the microphone follows the output (approach A).** Calls are self-managed
  Telecom calls, and Telecom ties the mic to the route: Bluetooth uses the headset's
  mic, a wired headset its mic, earpiece and speaker the built-in mic. The Microphone
  section offers those mics, and picking one switches the output accordingly.
  Rejected: B, a fully independent mic through our own `AudioDeviceModule` and
  `setPreferredInputDevice`, which fights Telecom while a Bluetooth SCO link is up and
  may silently fail on some phones. Agreed with the user.
- **One sheet behind the audio button, on both platforms.** Agreed with the user over
  a ☰ More entry and per-button ▾ arrows. On iOS the system output picker moves from
  the button into the sheet's Output row, so an iOS output change takes two taps
  instead of one (agreed).
- **No persistence.** Each call starts as today: front camera, the system's mic and
  output. Android camera ids are indices, not stable identities.
- **The sheet stays open after a pick**, so mic and camera can be changed in one visit.
- **No new third-party dependency.** Cameras come from react-native-webrtc's
  `enumerateDevices` and `getUserMedia({ video: { deviceId } })`, both supported on
  both platforms in 124.x.

## Behaviour

### Output

- **Android:** unchanged list of every output (from the output picker).
- **iOS:** one row: the current output's name with "Change ›". `CoyoteRoutePicker` is
  laid over that row, so a tap opens Apple's picker. The control-bar overlay is
  removed.

### Microphone

- **Android:** derived from the outputs, no native code:
  - "Phone microphone" (`builtin`), always.
  - "Headset microphone" (`wired`), when a wired output is listed.
  - One per Bluetooth output, same id and name as the output.
  - ✓: the selected output's mic (`builtin` when the output is earpiece or speaker).
  - Picking a Bluetooth or wired mic selects that output. Picking "Phone microphone"
    while on Bluetooth or wired selects the earpiece for an audio-only call (speaker
    when there's no earpiece) and the speaker for a video call — the starting-output
    rule. Picking it while on earpiece or speaker does nothing.
  - Works in both the Telecom and incall-manager fallback modes (it rides on
    `selectOutput`).
- **iOS:** every input in `AVAudioSession.availableInputs` (built-in mic, wired
  headset mic, Bluetooth HFP, USB), named by the port name. ✓:
  `currentRoute.inputs.first`. Picking one calls `setPreferredInput`. Picking a
  Bluetooth headset's mic also moves output to it (iOS rule); the Output row follows.

Input kinds: `builtin`, `wired`, `bluetooth`, `usb`. iOS port types map as
`.usbAudio` → `usb`, `.headsetMic` / `.lineIn` → `wired`, `.bluetoothHFP` /
`.bluetoothLE` → `bluetooth`, `.builtInMic` and anything else → `builtin`.

### Camera

- Every `videoinput` from `enumerateDevices`.
- Names: iOS uses the device's localized name ("Front Camera", "Back Ultra Wide
  Camera", an iPad's external camera). Android's labels are camera numbers, so names
  are generated: "Front camera" / "Back camera", numbered "Back camera 2", "Back
  camera 3" … within a facing when there are several, in id order. Any non-empty
  label that isn't just digits is kept as-is on Android.
- Order: front cameras first, then back, then others; within a group, platform order.
- Picking a camera while it's on swaps the published track live (the background
  effect carries over as on flip). Picking while it's off stores the choice for the
  next time it's turned on.
- The self-view flip button stays: it toggles front/back by facing, and the ✓ follows.
- The camera list is read each time the sheet opens. The Camera section is shown even
  with the camera off; it's omitted only when no camera is reported.

### Pending and failure

- Picking a row shows "…" on it until the switch is confirmed (the routes report the
  new output or input, or the camera track is live). Output and mic switches share the
  existing 5 s timeout and notice: "Couldn't switch to <name>." A camera that fails to
  open shows "Could not switch camera." (today's flip notice).
- Selecting the already-selected row does nothing.

### Button

Unchanged face: the current output's kind ("Speaker", "Bluetooth") or "…" while an
output or mic switch is pending. Accessibility label: "Audio and video devices.
Output: <name>". On both platforms it opens the sheet.

## Implementation

### `core/audioRoutes.ts` (pure)

- `InputKind = "builtin" | "wired" | "bluetooth" | "usb"`; `Input { id; kind; name }`.
- `Routes` gains `inputs: Input[]` and `input: string` ("" when unknown). `NO_ROUTES`
  and `parseRoutes` extend accordingly (well-formed inputs only; missing → empty).
- `androidInputs(r: Routes): Routes` — fills `inputs`/`input` from the outputs as
  above.
- `outputForInput(r: Routes, inputId: string, video: boolean): string | null` — the
  output to select for a mic pick, or null for no change.
- `Pending` gains `target: "output" | "input"`; `pendingOutcome` checks `selected` or
  `input` by target. `pickInput(r, id, now)` mirrors `pickOutput`.

### iOS native

- `CoyoteAudioRoute.swift`: the snapshot adds `inputs` (from `availableInputs`, id =
  port uid) and `input` (`currentRoute.inputs.first?.uid`). New method
  `selectInput(uid, resolve, reject)`: finds the port in `availableInputs`, calls
  `setPreferredInput`, rejects `unknown-input` / `select-failed`. Exported in
  `CoyoteAudioRoute.m`. Still never touches category, mode or output override.
- `CoyoteRoutePicker` unchanged; it moves into the sheet.

### Android native

None.

### `native/audioRoute.ts`

- `watchRoutes` passes Android payloads (Telecom and fallback) through
  `androidInputs`.
- `selectInput(id, video)`: iOS → `CoyoteAudioRoute.selectInput(id)`; Android →
  `outputForInput` then `selectOutput`, resolving at once when there's nothing to do.

### Camera

- `core/cameras.ts` (pure): `Camera { id; facing: "front" | "back" | "other"; name }`,
  `parseCameras(devices, platform)` — filters `videoinput`, maps facing
  (`front`/`user` → front, `environment`/`back` → back), names and orders as above.
- `native/webrtc.ts`: `listCameras()` via `mediaDevices.enumerateDevices()` →
  `parseCameras`; `getCamera(choice)` where `choice` is `{ facing }` or `{ deviceId }`
  (`video: { deviceId, width, height, frameRate }`).
- `core/call.ts`: state gains `cameraId: string | null`, set from the camera track's
  `getSettings().deviceId` whenever a camera track starts. `selectCamera(id)` shares
  `flipCamera`'s path (generation guard, `replaceTrack`, stop old track, notice);
  while the camera is off it stores the id (and facing, when known) for the next turn
  on. `flipCamera` acquires by facing and clears the stored id.

### UI

- `AudioRouteSheet` → `DevicesSheet` with three headed sections, a taller scrolling
  sheet, ✓ per section, "…" on a pending row. iOS Output row hosts
  `CoyoteRoutePicker`.
- `Call.tsx` wires inputs, cameras (read on open) and the pending effect for both
  output and input picks. `Controls.tsx` drops the iOS overlay; the button calls
  `onRoute` on both platforms.

## Edge cases

- **The chosen mic disconnects:** the platform falls back; the ✓ follows.
- **A camera disappears** (iPad external camera unplugged): the track ends as today;
  the next open of the sheet no longer lists it; turning the camera on with a stored
  id that's gone falls back to the stored facing.
- **Camera picked during a pending flip / pick:** the newer request wins (generation
  guard).
- **Leaving the call:** nothing new to clean up; the stored camera choice dies with
  the call.

## Testing

- **Jest:** `androidInputs`, `outputForInput`, `parseRoutes` inputs, pending by
  target; `parseCameras` naming and order on both platforms; `selectCamera` (live
  swap, while off then on, stale pick, failure notice, flip after pick);
  `DevicesSheet` sections, ✓ and selection; `native/audioRoute.ts` `selectInput` on
  both platforms with mocked modules.
- **Typecheck, lint, Android Gradle build** here. Swift / ObjC compiled on the Mac.
- **MANUAL-TEST items** (new, from 78):
  - Android: sheet shows Output, Microphone, Camera; picking a Bluetooth mic moves
    output to it; picking "Phone microphone" while on Bluetooth moves to
    earpiece (audio-only) / speaker (video).
  - Android: every camera listed with sensible names; picking each swaps live.
  - iPhone: Output row opens the system picker; Microphone lists iPhone mic and
    AirPods; picking each moves the mic (and output for AirPods).
  - iPhone: ultra-wide / telephoto cameras listed and selectable; flip after a pick.
  - iPad: an external USB camera and USB mic listed and selectable.
  - Picking a camera with the camera off, then turning it on, uses that camera.

## Release

1.7.0, iOS build 11 / Android versionCode 11 (bump both, all four iOS places), as the
last step. Release gates: Swift / ObjC compiled on the Mac; MANUAL-TEST 78+ on device.

## Out of scope

- USB microphones on Android (approach B).
- Choosing among an iPhone's built-in mics (front / bottom data sources).
- Remembering choices across calls.
- The Android video tile resize bug (still deferred).
