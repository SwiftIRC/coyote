# Audio Output Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the call screen's cycling audio button with an output picker: an in-app list of every output (each Bluetooth device by name) on Android, routed through Telecom; Apple's system route picker on iOS.

**Architecture:** Android gets an in-house Kotlin module `CoyoteAudioRoute` that lists and selects outputs on the call's callkeep `VoiceConnection` (Telecom owns routing for self-managed calls), fed by a small addition to the existing callkeep patch; react-native-incall-manager is no longer started on Android unless no Telecom connection appears (fallback). iOS gets a `CoyoteAudioRoute` that reports the current output and a `CoyoteRoutePicker` native view (an `AVRoutePickerView`) laid over the button. JS keeps pure logic in `core/audioRoutes.ts`, platform glue in `native/audioRoute.ts`, and a new `AudioRouteSheet`.

**Tech Stack:** React Native 0.87 (New Architecture, legacy modules via interop), TypeScript, Jest, Kotlin (Android Telecom `Connection` / `CallEndpoint` APIs), Swift + ObjC (AVFoundation / AVKit), patch-package.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-audio-output-picker-design.md`

## Global Constraints

- App version 1.6.0, iOS build 10 / Android versionCode 10; bump both platforms together, all four iOS places (Coyote and CoyoteBroadcast, Debug and Release).
- No new third-party native dependency; in-house modules only.
- Android routing goes through Telecom only: the Android module must never call `AudioManager.setSpeakerphoneOn`, `setCommunicationDevice`, `startBluetoothSco` or `setMode`.
- iOS code must never set the audio session category/mode, activate it, or override the output port (CallKit and WebRTC own the session; incall-manager stays as-is on iOS).
- Event name `CoyoteAudioRoutes`, payload `{ outputs: { id, kind, name }[], selected: string }` on both platforms.
- Output ids: `earpiece`, `speaker`, `wired`, `bluetooth` (type-only Bluetooth), `bt:<address>` (API 28–33) or `bt:<endpoint identifier>` (API 34+); iOS uses the port UID.
- Button text is the kind label (Phone / Speaker / Headset / Bluetooth / Car, "Audio" when unknown, "…" while switching); the accessibility label carries the device name.
- Switch timeout 5 s; failure notice text: `Couldn't switch to <name>.`
- Fallback: Android `start` resolves false when no connection for the call id appears within 2 s.
- Commit messages: conventional style (`feat(mobile): …`), **no Co-Authored-By trailer**.
- Run JS checks from `mobile/`: `npx jest`, `npm run typecheck`, `npm run lint`. Android builds: `cd mobile/android && source ./env.sh && ./gradlew …`.

## Review Focus

- Muting the mic on Android: callkeep's `setMutedCall` pushes a synthetic `CallAudioState` with no Bluetooth devices through `onCallAudioStateChanged`; the Bluetooth list must not empty. (Task 2 makes the listener carry no state; Task 3 reads Telecom's real `getCallAudioState()`; guarded in Task 3's test.)
- Leaving the call while `start` is still waiting for the Telecom connection: no incall-manager start and no keep-screen-on afterwards. (Task 5 test.)
- Malformed native payloads: unknown kinds, missing ids, garbage incall-manager JSON, route names like `constructor`: dropped, never crash or show phantom rows. (Task 1 tests.)
- The device you just picked disappears (switched off) before the switch lands: the failure notice shows at once, not after 5 s, and the label returns to the real output. (Task 1 `pendingOutcome` test.)
- Tapping the output that's already selected, or one that vanished while the sheet was open: no select call, no "…". (Task 1 `pickOutput` test.)

---

## File Structure

- `mobile/src/core/audioRoutes.ts` (rewrite): types, parsing, labels, sorting, incall-manager mapping, pending-switch logic. Pure.
- `mobile/src/core/iosRoute.ts`, `mobile/test/iosRoute.test.ts` (delete).
- `mobile/patches/react-native-callkeep+4.3.16.patch` (regenerate): `VoiceConnection` audio-route forwarding.
- `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRouteModule.kt`, `CoyoteAudioRoutePackage.kt` (create); `MainApplication.kt` (register).
- `mobile/ios/Coyote/CoyoteAudioRoute.swift`, `CoyoteAudioRoute.m`, `CoyoteRoutePicker.swift`, `CoyoteRoutePicker.m` (create); `mobile/ios/Coyote.xcodeproj/project.pbxproj` (add files).
- `mobile/src/native/audioRoute.ts` (rewrite): start/stop, watch, select; Android telecom vs fallback.
- `mobile/src/native/RoutePicker.tsx` (create): iOS native view binding.
- `mobile/src/ui/components/AudioRouteSheet.tsx` (create).
- `mobile/src/ui/components/Controls.tsx`, `mobile/src/ui/screens/Call.tsx`, `mobile/src/ui/CallContext.tsx`, `mobile/src/core/call.ts` (modify).
- Tests: `mobile/test/audioRoutes.test.ts` (rewrite), `mobile/test/audioRoute.native.test.ts` (create), `mobile/test/nativeModules.test.ts` (extend), `mobile/test/call.test.ts` (extend).
- `mobile/MANUAL-TEST.md`, `mobile/android/app/build.gradle` (modify).

---

### Task 1: Pure output logic (`core/audioRoutes.ts`)

**Files:**
- Modify: `mobile/src/core/audioRoutes.ts` (add the new API; keep `nextRoute`, `routeLabel` and the old `AudioRoutes` until Task 6 removes them, so the app still compiles)
- Test: `mobile/test/audioRoutes.test.ts`

**Interfaces:**
- Produces (used by Tasks 5 and 6):
  - `type OutputKind = "earpiece" | "speaker" | "wired" | "bluetooth" | "car"`
  - `interface Output { id: string; kind: OutputKind; name: string }`
  - `interface Routes { outputs: Output[]; selected: string }`, `const NO_ROUTES: Routes`
  - `parseRoutes(raw: unknown): Routes`
  - `selectedOutput(r: Routes): Output | null`
  - `outputLabel(kind: OutputKind | undefined): string`
  - `sortOutputs(outputs: Output[]): Output[]`
  - `fromInCallManager(event: unknown): Routes`, `toInCallManager(id: string): string | null`
  - `const SWITCH_TIMEOUT_MS = 5000`, `interface Pending { id: string; name: string; at: number }`
  - `type PendingOutcome = { kind: "done" } | { kind: "failed" } | { kind: "wait"; ms: number }`
  - `pendingOutcome(p: Pending, r: Routes, now: number): PendingOutcome`
  - `pickOutput(r: Routes, id: string, now: number): Pending | null`

- [ ] **Step 1: Write the failing tests**

Append to `mobile/test/audioRoutes.test.ts` (keep the existing tests for now; Task 6 deletes them with `nextRoute`):

```ts
import {
  NO_ROUTES, SWITCH_TIMEOUT_MS, fromInCallManager, outputLabel, parseRoutes, pendingOutcome, pickOutput,
  selectedOutput, sortOutputs, toInCallManager, type Routes,
} from "../src/core/audioRoutes";

const buds = { id: "bt:AA", kind: "bluetooth" as const, name: "Galaxy Buds3 Pro" };
const car = { id: "bt:BB", kind: "bluetooth" as const, name: "Car" };
const phone = { id: "earpiece", kind: "earpiece" as const, name: "Phone" };
const speaker = { id: "speaker", kind: "speaker" as const, name: "Speaker" };
const routes: Routes = { outputs: [buds, speaker, car, phone], selected: "speaker" };

test("parseRoutes keeps well-formed outputs and drops the rest", () => {
  expect(parseRoutes({
    outputs: [buds, { id: "", kind: "speaker", name: "x" }, { id: "y", kind: "hdmi", name: "TV" }, { id: "z", kind: "wired" }, null, 3],
    selected: "bt:AA",
  })).toEqual({ outputs: [buds], selected: "bt:AA" });
  expect(parseRoutes(null)).toEqual(NO_ROUTES);
  expect(parseRoutes({ outputs: "nope", selected: 4 })).toEqual(NO_ROUTES);
});

test("selectedOutput finds the selected output, or null", () => {
  expect(selectedOutput(routes)).toBe(speaker);
  expect(selectedOutput({ ...routes, selected: "gone" })).toBeNull();
  expect(selectedOutput(NO_ROUTES)).toBeNull();
});

test("outputLabel names each kind for the button", () => {
  expect(outputLabel("earpiece")).toBe("Phone");
  expect(outputLabel("speaker")).toBe("Speaker");
  expect(outputLabel("wired")).toBe("Headset");
  expect(outputLabel("bluetooth")).toBe("Bluetooth");
  expect(outputLabel("car")).toBe("Car");
  expect(outputLabel(undefined)).toBe("Audio");
});

test("sortOutputs: built-in first, then wired, then Bluetooth by name; input untouched", () => {
  const wired = { id: "wired", kind: "wired" as const, name: "Headset" };
  const input = [buds, wired, speaker, car, phone];
  expect(sortOutputs(input).map((o) => o.id)).toEqual(["earpiece", "speaker", "wired", "bt:BB", "bt:AA"]);
  expect(input[0]).toBe(buds);
});

test("fromInCallManager maps the fallback's route types", () => {
  expect(fromInCallManager({ availableAudioDeviceList: '["SPEAKER_PHONE","EARPIECE","BLUETOOTH"]', selectedAudioDevice: "BLUETOOTH" })).toEqual({
    outputs: [
      { id: "speaker", kind: "speaker", name: "Speaker" },
      { id: "earpiece", kind: "earpiece", name: "Phone" },
      { id: "bluetooth", kind: "bluetooth", name: "Bluetooth" },
    ],
    selected: "bluetooth",
  });
});

test("fromInCallManager survives garbage and never trusts inherited names", () => {
  expect(fromInCallManager({ availableAudioDeviceList: "{not json", selectedAudioDevice: "toString" })).toEqual(NO_ROUTES);
  expect(fromInCallManager({ availableAudioDeviceList: '["constructor","WIRED_HEADSET",7]', selectedAudioDevice: "" })).toEqual({
    outputs: [{ id: "wired", kind: "wired", name: "Headset" }], selected: "",
  });
  expect(fromInCallManager(undefined)).toEqual(NO_ROUTES);
});

test("toInCallManager maps ids back to route types", () => {
  expect(toInCallManager("speaker")).toBe("SPEAKER_PHONE");
  expect(toInCallManager("earpiece")).toBe("EARPIECE");
  expect(toInCallManager("wired")).toBe("WIRED_HEADSET");
  expect(toInCallManager("bluetooth")).toBe("BLUETOOTH");
  expect(toInCallManager("bt:AA")).toBeNull();
  expect(toInCallManager("constructor")).toBeNull();
});

test("pickOutput: a pending switch for another listed output, else null", () => {
  expect(pickOutput(routes, "bt:AA", 100)).toEqual({ id: "bt:AA", name: "Galaxy Buds3 Pro", at: 100 });
  expect(pickOutput(routes, "speaker", 100)).toBeNull(); // already selected
  expect(pickOutput(routes, "bt:ZZ", 100)).toBeNull(); // vanished while the sheet was open
});

test("pendingOutcome: done when selected, failed when gone or timed out, else wait", () => {
  const p = { id: "bt:AA", name: "Galaxy Buds3 Pro", at: 1000 };
  expect(pendingOutcome(p, { ...routes, selected: "bt:AA" }, 1200)).toEqual({ kind: "done" });
  expect(pendingOutcome(p, { outputs: [speaker], selected: "speaker" }, 1200)).toEqual({ kind: "failed" });
  expect(pendingOutcome(p, routes, 1200)).toEqual({ kind: "wait", ms: SWITCH_TIMEOUT_MS - 200 });
  expect(pendingOutcome(p, routes, 1000 + SWITCH_TIMEOUT_MS)).toEqual({ kind: "failed" });
  expect(pendingOutcome({ ...p, at: 0 }, routes, 1200)).toEqual({ kind: "failed" }); // rejected select (Task 6)
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest test/audioRoutes.test.ts`
Expected: FAIL (`parseRoutes` etc. are not exported).

- [ ] **Step 3: Implement**

Add to `mobile/src/core/audioRoutes.ts`, below the existing code (leave `ORDER`, `AudioRoutes`, `nextRoute`, `routeLabel` in place for now):

```ts
// Audio outputs for the call's output picker. Android lists every output (each
// Bluetooth device by name on Android 9+); iOS reports only the current one, since
// choosing happens in Apple's route picker.
export type OutputKind = "earpiece" | "speaker" | "wired" | "bluetooth" | "car";

export interface Output {
  id: string;
  kind: OutputKind;
  name: string;
}

export interface Routes {
  outputs: Output[];
  selected: string; // an Output id; "" when unknown
}

export const NO_ROUTES: Routes = { outputs: [], selected: "" };

const KINDS: readonly string[] = ["earpiece", "speaker", "wired", "bluetooth", "car"];

// A native CoyoteAudioRoutes payload, keeping only well-formed outputs.
export function parseRoutes(raw: unknown): Routes {
  const r = raw as { outputs?: unknown; selected?: unknown } | null | undefined;
  const outputs: Output[] = [];
  if (r && Array.isArray(r.outputs)) {
    for (const o of r.outputs as Array<Record<string, unknown> | null>) {
      if (o && typeof o.id === "string" && o.id !== "" && typeof o.name === "string" && typeof o.kind === "string" && KINDS.includes(o.kind)) {
        outputs.push({ id: o.id, kind: o.kind as OutputKind, name: o.name });
      }
    }
  }
  return { outputs, selected: typeof r?.selected === "string" ? r.selected : "" };
}

export function selectedOutput(r: Routes): Output | null {
  return r.outputs.find((o) => o.id === r.selected) ?? null;
}

// Button text: the kind, since device names don't fit.
export function outputLabel(kind: OutputKind | undefined): string {
  switch (kind) {
    case "earpiece": return "Phone";
    case "speaker": return "Speaker";
    case "wired": return "Headset";
    case "bluetooth": return "Bluetooth";
    case "car": return "Car";
    default: return "Audio";
  }
}

const KIND_ORDER: OutputKind[] = ["earpiece", "speaker", "wired", "car", "bluetooth"];

export function sortOutputs(outputs: Output[]): Output[] {
  return [...outputs].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

// react-native-incall-manager (the Android fallback) names routes by type only.
const ICM_KINDS: Record<string, OutputKind> = {
  EARPIECE: "earpiece",
  SPEAKER_PHONE: "speaker",
  WIRED_HEADSET: "wired",
  BLUETOOTH: "bluetooth",
};

function icmKind(name: unknown): OutputKind | null {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(ICM_KINDS, name) ? ICM_KINDS[name] : null;
}

// An incall-manager onAudioDeviceChanged event as Routes.
export function fromInCallManager(event: unknown): Routes {
  const e = event as { availableAudioDeviceList?: unknown; selectedAudioDevice?: unknown } | null | undefined;
  let names: unknown = [];
  try {
    names = JSON.parse(String(e?.availableAudioDeviceList ?? "[]"));
  } catch {
    names = [];
  }
  const outputs: Output[] = [];
  for (const n of Array.isArray(names) ? names : []) {
    const kind = icmKind(n);
    if (kind) outputs.push({ id: kind, kind, name: outputLabel(kind) });
  }
  return { outputs, selected: icmKind(e?.selectedAudioDevice) ?? "" };
}

export function toInCallManager(id: string): string | null {
  return Object.keys(ICM_KINDS).find((k) => ICM_KINDS[k] === id) ?? null;
}

// A switch the user asked for and the system hasn't confirmed yet.
export const SWITCH_TIMEOUT_MS = 5000;

export interface Pending {
  id: string;
  name: string;
  at: number; // ms; 0 marks a switch the platform already rejected
}

export type PendingOutcome = { kind: "done" } | { kind: "failed" } | { kind: "wait"; ms: number };

export function pendingOutcome(p: Pending, r: Routes, now: number): PendingOutcome {
  if (r.selected === p.id) return { kind: "done" };
  if (!r.outputs.some((o) => o.id === p.id)) return { kind: "failed" };
  const ms = p.at + SWITCH_TIMEOUT_MS - now;
  return ms <= 0 ? { kind: "failed" } : { kind: "wait", ms };
}

// The pending switch for tapping `id`; null when there is nothing to do.
export function pickOutput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.selected) return null;
  const o = r.outputs.find((x) => x.id === id);
  return o ? { id, name: o.name, at: now } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mobile && npx jest test/audioRoutes.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/audioRoutes.ts mobile/test/audioRoutes.test.ts
git commit -m "feat(mobile): audio output model for the output picker"
```

---

### Task 2: Callkeep patch forwards Telecom audio-route changes

**Files:**
- Modify: `mobile/node_modules/react-native-callkeep/android/src/main/java/io/wazo/callkeep/VoiceConnection.java`, then regenerate `mobile/patches/react-native-callkeep+4.3.16.patch`
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Produces (used by Task 3), in package `io.wazo.callkeep`:
  - `public interface VoiceConnection.AudioRouteListener { void onAudioRouteChanged(VoiceConnection connection); }`
  - `public static volatile VoiceConnection.AudioRouteListener audioRouteListener`
  - `public volatile Object currentEndpoint` (a `CallEndpoint` on API 34+, else null)
  - `public volatile List<Object> availableEndpoints` (`CallEndpoint`s on API 34+, else empty)
  - The listener carries **no audio state**: callkeep's own `setMutedCall` calls `onCallAudioStateChanged` with a synthetic state that has no Bluetooth devices, so the module must read Telecom's real `getCallAudioState()` instead.

- [ ] **Step 1: Write the failing test**

Append to `mobile/test/nativeModules.test.ts`:

```ts
// CoyoteAudioRoute follows Telecom's routes through callkeep's VoiceConnection
// (patched): a ping only, so callkeep's synthetic mute states (no Bluetooth
// devices) never reach the picker.
test("callkeep's VoiceConnection forwards audio-route changes", () => {
  const file = path.join(__dirname, "..", "node_modules", "react-native-callkeep", "android",
    "src", "main", "java", "io", "wazo", "callkeep", "VoiceConnection.java");
  const src = fs.readFileSync(file, "utf8");
  expect(src).toMatch(/public interface AudioRouteListener\s*\{\s*void onAudioRouteChanged\(VoiceConnection connection\);\s*\}/);
  expect(src).toContain("public static volatile AudioRouteListener audioRouteListener");
  expect(src).toMatch(/public void onCallEndpointChanged\(CallEndpoint endpoint\)/);
  expect(src).toMatch(/public void onAvailableCallEndpointsChanged\(List<CallEndpoint> endpoints\)/);
  // Forwarded before the mute early return, so route-only changes reach the app.
  const body = src.slice(src.indexOf("public void onCallAudioStateChanged"));
  const notify = body.indexOf("notifyAudioRoute();");
  expect(notify).toBeGreaterThan(0);
  expect(notify).toBeLessThan(body.indexOf("return;"));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest test/nativeModules.test.ts -t "forwards audio-route"`
Expected: FAIL (no `AudioRouteListener`).

- [ ] **Step 3: Edit callkeep's `VoiceConnection.java`**

In `mobile/node_modules/react-native-callkeep/android/src/main/java/io/wazo/callkeep/VoiceConnection.java`:

Add imports next to the existing `android.telecom` and `java.util` imports:

```java
import android.telecom.CallEndpoint;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
```

Inside the class, right after `private static final String TAG = "RNCallKeep";`:

```java
    // Coyote: lets the app's CoyoteAudioRoute module follow Telecom's audio routes.
    // A ping only: the module reads Telecom's state itself, because setMutedCall
    // feeds onCallAudioStateChanged a synthetic state without Bluetooth devices.
    public interface AudioRouteListener {
        void onAudioRouteChanged(VoiceConnection connection);
    }
    public static volatile AudioRouteListener audioRouteListener;
    // CallEndpoint / List<CallEndpoint> on API 34+, typed loosely so older APIs
    // never resolve the class.
    public volatile Object currentEndpoint;
    public volatile List<Object> availableEndpoints = Collections.emptyList();

    private void notifyAudioRoute() {
        AudioRouteListener l = audioRouteListener;
        if (l != null) l.onAudioRouteChanged(this);
    }

    @Override
    public void onCallEndpointChanged(CallEndpoint endpoint) {
        currentEndpoint = endpoint;
        notifyAudioRoute();
    }

    @Override
    public void onAvailableCallEndpointsChanged(List<CallEndpoint> endpoints) {
        availableEndpoints = new ArrayList<Object>(endpoints);
        notifyAudioRoute();
    }
```

In `onCallAudioStateChanged`, directly after `sendCallRequestToActivity(ACTION_DID_CHANGE_AUDIO_ROUTE, handle);` (before the `if (state.isMuted() == this.isMuted) { return; }`):

```java
        notifyAudioRoute();
```

- [ ] **Step 4: Regenerate the patch and run the test**

Run: `cd mobile && npx patch-package react-native-callkeep && git diff --stat patches/ && npx jest test/nativeModules.test.ts`
Expected: the patch file changes (it keeps the existing RNCallKeepModule / VoiceConnectionService / RNCallKeep.m hunks and gains the VoiceConnection hunk); all nativeModules tests PASS.

Then confirm the patch re-applies cleanly from scratch:

Run: `cd mobile && npx patch-package --reverse && npx patch-package && npx jest test/nativeModules.test.ts`
Expected: both commands report `react-native-callkeep@4.3.16 ✔` (and the webrtc patch); tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/patches/react-native-callkeep+4.3.16.patch mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): callkeep forwards Telecom audio-route changes (patch)"
```

---

### Task 3: Android `CoyoteAudioRoute` module

**Files:**
- Create: `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRouteModule.kt`
- Create: `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRoutePackage.kt`
- Modify: `mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt` (register the package)
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Consumes: Task 2's `VoiceConnection.AudioRouteListener`, `audioRouteListener`, `currentEndpoint`, `availableEndpoints`; callkeep's `VoiceConnectionService.getConnection(String): Connection`.
- Produces (native module `CoyoteAudioRoute`, used by Task 5):
  - `start(callId: string, video: boolean): Promise<boolean>`: true once attached to the call's connection; false after 2 s without one or if stopped meanwhile.
  - `stop(): void`
  - `routes(): Promise<Routes>`
  - `select(id: string): Promise<void>`: rejects `unknown-output`, `no-call`, or `select-failed` (API 34 Telecom error).
  - Event `CoyoteAudioRoutes` with `Routes`, after every Telecom report while attached.
  - While attached: keeps the screen on; holds a proximity wake lock while the selected output is the earpiece; applies the starting output once (leave Telecom's choice if wired/Bluetooth is present; else speaker for video, earpiece for audio-only, speaker when there is no earpiece).

- [ ] **Step 1: Write the failing test**

Append to `mobile/test/nativeModules.test.ts`:

```ts
test("CoyoteAudioRoute routes only through Telecom and reads Telecom's real state", () => {
  const app = path.join(__dirname, "..");
  const dir = path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote");
  const kt = fs.readFileSync(path.join(dir, "CoyoteAudioRouteModule.kt"), "utf8");
  expect(exportedNames(kt).sort()).toEqual(["addListener", "removeListeners", "routes", "select", "start", "stop"]);
  expect(kt).toContain('"CoyoteAudioRoutes"');
  expect(kt).not.toMatch(/setSpeakerphoneOn|setCommunicationDevice|startBluetoothSco|setMode\(/);
  // Mute pushes a synthetic CallAudioState through callkeep; never route from it.
  expect(kt).toContain("c.callAudioState");
  expect(kt).toContain("override fun onAudioRouteChanged(connection: VoiceConnection)");
  // Kotlin's `and` binds looser than `!=`: masks must be parenthesised.
  expect(kt).not.toMatch(/mask and [\w.]+ !=/);
  expect(fs.readFileSync(path.join(dir, "MainApplication.kt"), "utf8")).toContain("add(CoyoteAudioRoutePackage())");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest test/nativeModules.test.ts -t "CoyoteAudioRoute routes"`
Expected: FAIL (ENOENT on `CoyoteAudioRouteModule.kt`).

- [ ] **Step 3: Write the module**

`mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRouteModule.kt`:

```kotlin
package net.swiftirc.coyote

import android.bluetooth.BluetoothDevice
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.OutcomeReceiver
import android.os.PowerManager
import android.os.SystemClock
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.util.Log
import android.view.WindowManager
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.wazo.callkeep.VoiceConnection
import io.wazo.callkeep.VoiceConnectionService

// Audio output selection for a call, through Telecom. Android calls are self-managed
// callkeep connections, so Telecom owns routing: this module lists and selects
// outputs on the call's VoiceConnection and never touches AudioManager routing.
// While attached it also does InCallManager's other jobs (InCallManager isn't
// started then): keep the screen on, and turn it off near the ear on the earpiece.
// All state is confined to the main thread, where Telecom delivers its callbacks.
class CoyoteAudioRouteModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), VoiceConnection.AudioRouteListener {
  override fun getName() = "CoyoteAudioRoute"

  private data class Output(val id: String, val kind: String, val name: String)

  private val main = Handler(Looper.getMainLooper())
  private var gen = 0 // bumped by start/stop; a stale start attempt gives up
  private var conn: VoiceConnection? = null
  private var video = false
  private var initialDone = false
  private var proximity: PowerManager.WakeLock? = null

  @ReactMethod
  fun start(callId: String, video: Boolean, promise: Promise) {
    main.post {
      detach()
      val g = ++gen
      this.video = video
      initialDone = false
      val deadline = SystemClock.uptimeMillis() + CONNECTION_WAIT_MS
      fun attempt() {
        if (g != gen) {
          promise.resolve(false)
          return
        }
        val c = VoiceConnectionService.getConnection(callId) as? VoiceConnection
        when {
          c != null -> {
            attach(c)
            promise.resolve(true)
          }
          SystemClock.uptimeMillis() >= deadline -> promise.resolve(false)
          else -> main.postDelayed({ attempt() }, 100)
        }
      }
      attempt()
    }
  }

  @ReactMethod
  fun stop() {
    main.post {
      gen++
      detach()
    }
  }

  @ReactMethod
  fun routes(promise: Promise) {
    main.post { promise.resolve(toMap(outputs(), selectedId())) }
  }

  @ReactMethod
  fun select(id: String, promise: Promise) {
    main.post {
      val c = conn
      if (c == null) promise.reject("no-call", "No call audio to route") else selectOn(c, id, promise)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    main.post {
      gen++
      detach()
    }
    super.invalidate()
  }

  override fun onAudioRouteChanged(connection: VoiceConnection) {
    main.post { if (connection === conn) changed() }
  }

  private fun attach(c: VoiceConnection) {
    conn = c
    VoiceConnection.audioRouteListener = this
    setKeepScreenOn(true)
    changed()
  }

  private fun detach() {
    if (VoiceConnection.audioRouteListener === this) VoiceConnection.audioRouteListener = null
    if (conn != null) setKeepScreenOn(false)
    conn = null
    setProximity(false)
  }

  // After every report: tell JS, follow the earpiece, apply the starting output once.
  private fun changed() {
    val outs = outputs()
    val sel = selectedId()
    emit(toMap(outs, sel))
    setProximity(outs.firstOrNull { it.id == sel }?.kind == "earpiece")
    if (!initialDone && outs.isNotEmpty()) {
      initialDone = true
      val want = initialOutput(outs)
      val c = conn
      if (want != null && want != sel && c != null) selectOn(c, want, null)
    }
  }

  // A connected headset keeps Telecom's choice; otherwise video starts on the
  // speaker and audio-only on the earpiece (speaker when there is none, e.g. tablets).
  private fun initialOutput(outs: List<Output>): String? {
    if (outs.any { it.kind == "wired" || it.kind == "bluetooth" }) return null
    return if (!video && outs.any { it.kind == "earpiece" }) "earpiece" else "speaker"
  }

  private fun outputs(): List<Output> {
    val c = conn ?: return emptyList()
    if (Build.VERSION.SDK_INT >= 34) {
      return c.availableEndpoints.filterIsInstance<CallEndpoint>().mapNotNull { endpointOutput(it) }
    }
    @Suppress("DEPRECATION")
    val s = c.callAudioState ?: return emptyList()
    val mask = s.supportedRouteMask
    val list = mutableListOf<Output>()
    if ((mask and CallAudioState.ROUTE_EARPIECE) != 0) list += Output("earpiece", "earpiece", "Phone")
    if ((mask and CallAudioState.ROUTE_SPEAKER) != 0) list += Output("speaker", "speaker", "Speaker")
    if ((mask and CallAudioState.ROUTE_WIRED_HEADSET) != 0) list += Output("wired", "wired", "Headset")
    if ((mask and CallAudioState.ROUTE_BLUETOOTH) != 0) {
      val devices = if (Build.VERSION.SDK_INT >= 28) s.supportedBluetoothDevices.toList() else emptyList()
      if (devices.isEmpty()) list += Output("bluetooth", "bluetooth", "Bluetooth")
      else devices.forEach { list += Output("bt:${it.address}", "bluetooth", btName(it)) }
    }
    return list
  }

  private fun selectedId(): String {
    val c = conn ?: return ""
    if (Build.VERSION.SDK_INT >= 34) {
      return (c.currentEndpoint as? CallEndpoint)?.let { endpointOutput(it)?.id } ?: ""
    }
    @Suppress("DEPRECATION")
    val s = c.callAudioState ?: return ""
    return when (s.route) {
      CallAudioState.ROUTE_EARPIECE -> "earpiece"
      CallAudioState.ROUTE_SPEAKER -> "speaker"
      CallAudioState.ROUTE_WIRED_HEADSET -> "wired"
      CallAudioState.ROUTE_BLUETOOTH -> {
        val d = if (Build.VERSION.SDK_INT >= 28) s.activeBluetoothDevice ?: s.supportedBluetoothDevices.firstOrNull() else null
        if (d != null) "bt:${d.address}" else "bluetooth"
      }
      else -> ""
    }
  }

  @RequiresApi(34)
  private fun endpointOutput(e: CallEndpoint): Output? = when (e.endpointType) {
    CallEndpoint.TYPE_EARPIECE -> Output("earpiece", "earpiece", "Phone")
    CallEndpoint.TYPE_SPEAKER -> Output("speaker", "speaker", "Speaker")
    CallEndpoint.TYPE_WIRED_HEADSET -> Output("wired", "wired", "Headset")
    CallEndpoint.TYPE_BLUETOOTH -> Output("bt:${e.identifier}", "bluetooth", e.endpointName.toString().ifBlank { "Bluetooth device" })
    else -> null // streaming / unknown endpoints are not call outputs
  }

  // BLUETOOTH_CONNECT is requested at join (API 31+); without it, a generic name.
  private fun btName(d: BluetoothDevice): String {
    val name = try { d.name } catch (e: SecurityException) { null }
    return if (name.isNullOrBlank()) "Bluetooth device" else name
  }

  @Suppress("DEPRECATION")
  private fun selectOn(c: VoiceConnection, id: String, promise: Promise?) {
    if (Build.VERSION.SDK_INT >= 34) {
      val ep = c.availableEndpoints.filterIsInstance<CallEndpoint>().firstOrNull { endpointOutput(it)?.id == id }
      if (ep == null) {
        promise?.reject("unknown-output", "No output $id")
        return
      }
      c.requestCallEndpointChange(ep, ctx.mainExecutor, object : OutcomeReceiver<Void?, CallEndpointException> {
        override fun onResult(result: Void?) { promise?.resolve(null) }
        override fun onError(error: CallEndpointException) {
          Log.w(TAG, "select $id failed", error)
          promise?.reject("select-failed", error.message, error)
        }
      })
      return
    }
    when {
      id == "earpiece" -> c.setAudioRoute(CallAudioState.ROUTE_EARPIECE)
      id == "speaker" -> c.setAudioRoute(CallAudioState.ROUTE_SPEAKER)
      id == "wired" -> c.setAudioRoute(CallAudioState.ROUTE_WIRED_HEADSET)
      id == "bluetooth" -> c.setAudioRoute(CallAudioState.ROUTE_BLUETOOTH)
      id.startsWith("bt:") && Build.VERSION.SDK_INT >= 28 -> {
        val d = c.callAudioState?.supportedBluetoothDevices?.firstOrNull { "bt:${it.address}" == id }
        if (d == null) {
          promise?.reject("unknown-output", "No output $id")
          return
        }
        c.requestBluetoothAudio(d)
      }
      else -> {
        promise?.reject("unknown-output", "No output $id")
        return
      }
    }
    promise?.resolve(null)
  }

  private fun setProximity(on: Boolean) {
    if (on) {
      if (proximity != null) return
      val pm = ctx.getSystemService(PowerManager::class.java) ?: return
      if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
      proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "coyote:proximity").apply {
        setReferenceCounted(false)
        acquire()
      }
    } else {
      proximity?.let { if (it.isHeld) it.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY) }
      proximity = null
    }
  }

  private fun setKeepScreenOn(on: Boolean) {
    val w = ctx.currentActivity?.window ?: return
    if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun toMap(outs: List<Output>, sel: String): WritableMap {
    val arr = Arguments.createArray()
    for (o in outs) {
      arr.pushMap(Arguments.createMap().apply {
        putString("id", o.id)
        putString("kind", o.kind)
        putString("name", o.name)
      })
    }
    return Arguments.createMap().apply {
      putArray("outputs", arr)
      putString("selected", sel)
    }
  }

  private fun emit(body: WritableMap) {
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, body)
  }

  companion object {
    private const val TAG = "CoyoteAudioRoute"
    private const val EVENT = "CoyoteAudioRoutes"
    private const val CONNECTION_WAIT_MS = 2000L
  }
}
```

`mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRoutePackage.kt`:

```kotlin
package net.swiftirc.coyote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CoyoteAudioRoutePackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CoyoteAudioRouteModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
```

In `MainApplication.kt`, after `add(CoyoteBackgroundPackage())`:

```kotlin
          add(CoyoteAudioRoutePackage())
```

- [ ] **Step 4: Run the guard test and compile**

Run: `cd mobile && npx jest test/nativeModules.test.ts`
Expected: PASS.

Run (through `ctx_execute` or with output trimmed): `cd mobile/android && source ./env.sh && ./gradlew :app:compileDebugKotlin -q 2>&1 | grep -E "^e:|error:|FAILED" | head -30; echo exit=${PIPESTATUS[0]}`
Expected: no `e:` lines, `exit=0`. If `ctx.currentActivity` doesn't resolve on this RN version, use `reactApplicationContext.currentActivity`; if `io.wazo.callkeep` doesn't resolve, check `android/settings.gradle` autolinking includes react-native-callkeep (it does for the app's existing callkeep usage) and report rather than adding a manual dependency.

- [ ] **Step 5: Commit**

```bash
git add mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRouteModule.kt \
  mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteAudioRoutePackage.kt \
  mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): Android CoyoteAudioRoute lists and selects outputs through Telecom"
```

---

### Task 4: iOS `CoyoteAudioRoute` and `CoyoteRoutePicker`

**Files:**
- Create: `mobile/ios/Coyote/CoyoteAudioRoute.swift`, `mobile/ios/Coyote/CoyoteAudioRoute.m`
- Create: `mobile/ios/Coyote/CoyoteRoutePicker.swift`, `mobile/ios/Coyote/CoyoteRoutePicker.m`
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj`
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Produces (used by Task 5):
  - Native module `CoyoteAudioRoute` (RCTEventEmitter): `routes(): Promise<Routes>` with the current output only (`outputs.length <= 1`), event `CoyoteAudioRoutes` on every `AVAudioSession.routeChangeNotification` while JS listens.
  - Native view `CoyoteRoutePicker` (manager `CoyoteRoutePickerManager`): an `AVRoutePickerView` with its icon hidden; tapping it opens the system output sheet.

Swift can't be compiled on Linux; the user builds on the Mac. Keep the code minimal and match the existing `CoyoteSounds` patterns (`import React`, `RCT_EXTERN_MODULE`).

- [ ] **Step 1: Write the failing test**

Append to `mobile/test/nativeModules.test.ts`:

```ts
test("iOS CoyoteAudioRoute only reports routes; CoyoteRoutePicker wraps AVRoutePickerView; both are built", () => {
  const ios = path.join(__dirname, "..", "ios");
  const read = (f: string) => fs.readFileSync(path.join(ios, "Coyote", f), "utf8");
  expect(read("CoyoteAudioRoute.m")).toContain("RCT_EXTERN_MODULE(CoyoteAudioRoute, RCTEventEmitter)");
  expect(read("CoyoteAudioRoute.m")).toContain("routes:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject");
  const swift = read("CoyoteAudioRoute.swift");
  expect(swift).toContain("routeChangeNotification");
  expect(swift).toContain('"CoyoteAudioRoutes"');
  expect(swift).not.toMatch(/setCategory|setMode|setActive|overrideOutputAudioPort/);
  expect(read("CoyoteRoutePicker.m")).toContain("RCT_EXTERN_MODULE(CoyoteRoutePickerManager, RCTViewManager)");
  expect(read("CoyoteRoutePicker.swift")).toContain("AVRoutePickerView");
  const pbx = fs.readFileSync(path.join(ios, "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  for (const f of ["CoyoteAudioRoute.swift", "CoyoteAudioRoute.m", "CoyoteRoutePicker.swift", "CoyoteRoutePicker.m"]) {
    // PBXBuildFile definition + Sources phase entry.
    expect(pbx.split(`/* ${f} in Sources */`).length - 1).toBe(2);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest test/nativeModules.test.ts -t "iOS CoyoteAudioRoute"`
Expected: FAIL (ENOENT).

- [ ] **Step 3: Write the iOS files**

`mobile/ios/Coyote/CoyoteAudioRoute.swift`:

```swift
import AVFoundation
import React

// Reports the call's current audio output. iOS has no API to list or pick outputs by
// name: choosing happens in Apple's route picker (CoyoteRoutePicker), and this keeps
// the button's label in step, including switches from Control Centre or CallKit.
// It never touches the session's category, mode or output override.
@objc(CoyoteAudioRoute)
class CoyoteAudioRoute: RCTEventEmitter {
  private var listening = false

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteAudioRoutes"] }

  override func startObserving() {
    listening = true
    NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
  }

  override func stopObserving() {
    listening = false
    NotificationCenter.default.removeObserver(self, name: AVAudioSession.routeChangeNotification, object: nil)
  }

  @objc private func routeChanged(_ note: Notification) {
    if listening { sendEvent(withName: "CoyoteAudioRoutes", body: Self.snapshot()) }
  }

  @objc(routes:rejecter:)
  func routes(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(Self.snapshot())
  }

  private static func snapshot() -> [String: Any] {
    guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
      return ["outputs": [], "selected": ""]
    }
    let output: [String: Any] = ["id": port.uid, "kind": kind(port.portType), "name": port.portName]
    return ["outputs": [output], "selected": port.uid]
  }

  private static func kind(_ type: AVAudioSession.Port) -> String {
    switch type {
    case .builtInReceiver: return "earpiece"
    case .builtInSpeaker: return "speaker"
    case .headphones, .usbAudio, .lineOut: return "wired"
    case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE: return "bluetooth"
    case .carAudio: return "car"
    default: return "speaker"
    }
  }
}
```

`mobile/ios/Coyote/CoyoteAudioRoute.m`:

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CoyoteAudioRoute, RCTEventEmitter)
RCT_EXTERN_METHOD(routes:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
```

`mobile/ios/Coyote/CoyoteRoutePicker.swift`:

```swift
import AVKit
import React

// Apple's output picker button with its icon hidden. JS lays it over the call's
// audio button, which draws the label; a tap opens the system output sheet.
@objc(CoyoteRoutePickerManager)
class CoyoteRoutePickerManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    let picker = AVRoutePickerView()
    picker.prioritizesVideoDevices = false
    picker.tintColor = .clear
    picker.activeTintColor = .clear
    picker.backgroundColor = .clear
    return picker
  }
}
```

`mobile/ios/Coyote/CoyoteRoutePicker.m`:

```objc
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(CoyoteRoutePickerManager, RCTViewManager)
@end
```

- [ ] **Step 4: Add the files to the Xcode project**

First confirm the IDs are unused: `grep -c "C0A0D10" mobile/ios/Coyote.xcodeproj/project.pbxproj` must print `0`.

In `mobile/ios/Coyote.xcodeproj/project.pbxproj`, insert each block directly after the matching `CoyoteScreenShare.m` line in that section (keep tabs as in the file):

PBXBuildFile section (after the `C0B0AD122E00000000000001 /* CoyoteScreenShare.m in Sources */` line):

```
		C0A0D1112E00000000000001 /* CoyoteAudioRoute.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0A0D1012E00000000000001 /* CoyoteAudioRoute.swift */; };
		C0A0D1122E00000000000001 /* CoyoteAudioRoute.m in Sources */ = {isa = PBXBuildFile; fileRef = C0A0D1022E00000000000001 /* CoyoteAudioRoute.m */; };
		C0A0D1132E00000000000001 /* CoyoteRoutePicker.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0A0D1032E00000000000001 /* CoyoteRoutePicker.swift */; };
		C0A0D1142E00000000000001 /* CoyoteRoutePicker.m in Sources */ = {isa = PBXBuildFile; fileRef = C0A0D1042E00000000000001 /* CoyoteRoutePicker.m */; };
```

PBXFileReference section (after the `C0B0AD022E00000000000001 /* CoyoteScreenShare.m */ = {isa = PBXFileReference; …` line):

```
		C0A0D1012E00000000000001 /* CoyoteAudioRoute.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = CoyoteAudioRoute.swift; path = Coyote/CoyoteAudioRoute.swift; sourceTree = "<group>"; };
		C0A0D1022E00000000000001 /* CoyoteAudioRoute.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = CoyoteAudioRoute.m; path = Coyote/CoyoteAudioRoute.m; sourceTree = "<group>"; };
		C0A0D1032E00000000000001 /* CoyoteRoutePicker.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = CoyoteRoutePicker.swift; path = Coyote/CoyoteRoutePicker.swift; sourceTree = "<group>"; };
		C0A0D1042E00000000000001 /* CoyoteRoutePicker.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = CoyoteRoutePicker.m; path = Coyote/CoyoteRoutePicker.m; sourceTree = "<group>"; };
```

Coyote group children (after the `C0B0AD022E00000000000001 /* CoyoteScreenShare.m */,` line):

```
				C0A0D1012E00000000000001 /* CoyoteAudioRoute.swift */,
				C0A0D1022E00000000000001 /* CoyoteAudioRoute.m */,
				C0A0D1032E00000000000001 /* CoyoteRoutePicker.swift */,
				C0A0D1042E00000000000001 /* CoyoteRoutePicker.m */,
```

Coyote target Sources build phase (after the `C0B0AD122E00000000000001 /* CoyoteScreenShare.m in Sources */,` line):

```
				C0A0D1112E00000000000001 /* CoyoteAudioRoute.swift in Sources */,
				C0A0D1122E00000000000001 /* CoyoteAudioRoute.m in Sources */,
				C0A0D1132E00000000000001 /* CoyoteRoutePicker.swift in Sources */,
				C0A0D1142E00000000000001 /* CoyoteRoutePicker.m in Sources */,
```

If `plutil` is available, `plutil -lint mobile/ios/Coyote.xcodeproj/project.pbxproj`; otherwise check braces balance: `python3 -c "s=open('mobile/ios/Coyote.xcodeproj/project.pbxproj').read(); print(s.count('{')-s.count('}'), s.count('(')-s.count(')'))"` prints `0 0`.

- [ ] **Step 5: Run the test**

Run: `cd mobile && npx jest test/nativeModules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/ios/Coyote/CoyoteAudioRoute.swift mobile/ios/Coyote/CoyoteAudioRoute.m \
  mobile/ios/Coyote/CoyoteRoutePicker.swift mobile/ios/Coyote/CoyoteRoutePicker.m \
  mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): iOS current-output reporting and system route picker view"
```

---

### Task 5: JS platform glue (`native/audioRoute.ts`, `native/RoutePicker.tsx`)

**Files:**
- Modify (rewrite): `mobile/src/native/audioRoute.ts`
- Create: `mobile/src/native/RoutePicker.tsx`
- Modify: `mobile/src/ui/screens/Call.tsx` (only the two call sites whose signatures change; the UI rework is Task 6)
- Modify: `mobile/src/core/call.ts` (expose the system call id)
- Test: `mobile/test/audioRoute.native.test.ts` (create), `mobile/test/call.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Routes`, `parseRoutes`, `fromInCallManager`, `toInCallManager`); native `CoyoteAudioRoute` from Tasks 3/4.
- Produces (used by Task 6):
  - `startCallAudio(callId: string, video: boolean): Promise<void>`
  - `stopCallAudio(): void`
  - `watchRoutes(fn: (r: Routes) => void): () => void`
  - `selectOutput(id: string): Promise<void>` (Android only; rejects elsewhere)
  - `RoutePicker: React.ComponentType<ViewProps> | null` (null on Android)
  - `Call.systemCallId: string` (getter; "" before join)

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/audioRoute.native.test.ts`:

```ts
// The audio-route native glue, with react-native and incall-manager mocked.
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", opts: { module?: boolean; start?: () => Promise<boolean> } = {}) {
  jest.resetModules();
  const native = {
    start: jest.fn(opts.start ?? (async () => true)),
    stop: jest.fn(),
    routes: jest.fn(async () => ({ outputs: [{ id: "u1", kind: "speaker", name: "Speaker" }], selected: "u1" })),
    select: jest.fn(async () => undefined),
  };
  const icm = {
    start: jest.fn(), stop: jest.fn(), setKeepScreenOn: jest.fn(),
    chooseAudioRoute: jest.fn(async () => ({})),
  };
  const moduleListeners = new Set<Listener>();
  const deviceListeners = new Map<string, Set<Listener>>();
  class NativeEventEmitter {
    addListener(_name: string, fn: Listener) {
      moduleListeners.add(fn);
      return { remove: () => moduleListeners.delete(fn) };
    }
  }
  const DeviceEventEmitter = {
    addListener(name: string, fn: Listener) {
      if (!deviceListeners.has(name)) deviceListeners.set(name, new Set());
      deviceListeners.get(name)!.add(fn);
      return { remove: () => deviceListeners.get(name)!.delete(fn) };
    },
  };
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: opts.module === false ? {} : { CoyoteAudioRoute: native },
    NativeEventEmitter,
    DeviceEventEmitter,
  }));
  jest.doMock("react-native-incall-manager", () => ({ __esModule: true, default: icm }));
  let mod: typeof import("../src/native/audioRoute") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/audioRoute");
  });
  return {
    mod: mod!, native, icm,
    emit: (e: unknown) => moduleListeners.forEach((fn) => fn(e)),
    emitIcm: (e: unknown) => deviceListeners.get("onAudioDeviceChanged")?.forEach((fn) => fn(e)),
    moduleListeners, deviceListeners,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

test("Android with a Telecom connection: CoyoteAudioRoute only, no incall-manager", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", true);
  expect(t.native.start).toHaveBeenCalledWith("c1", true);
  expect(t.icm.start).not.toHaveBeenCalled();
  await t.mod.selectOutput("bt:AA");
  expect(t.native.select).toHaveBeenCalledWith("bt:AA");
  t.mod.stopCallAudio();
  expect(t.native.stop).toHaveBeenCalled();
  expect(t.icm.stop).not.toHaveBeenCalled();
});

test("Android without a Telecom connection falls back to incall-manager", async () => {
  const t = load("android", { start: async () => false });
  await t.mod.startCallAudio("c1", false);
  expect(t.icm.start).toHaveBeenCalledWith({ media: "audio", auto: true });
  expect(t.icm.setKeepScreenOn).toHaveBeenCalledWith(true);
  await t.mod.selectOutput("speaker");
  expect(t.icm.chooseAudioRoute).toHaveBeenCalledWith("SPEAKER_PHONE");
  t.mod.stopCallAudio();
  expect(t.icm.setKeepScreenOn).toHaveBeenLastCalledWith(false);
  expect(t.icm.stop).toHaveBeenCalled();
});

test("a failing native start also falls back", async () => {
  const t = load("android", { start: async () => { throw new Error("boom"); } });
  await t.mod.startCallAudio("c1", true);
  expect(t.icm.start).toHaveBeenCalledWith({ media: "video", auto: true });
});

test("leaving while start still waits for the connection starts nothing afterwards", async () => {
  let resolve: (ok: boolean) => void = () => {};
  const t = load("android", { start: () => new Promise<boolean>((r) => { resolve = r; }) });
  const started = t.mod.startCallAudio("c1", true);
  t.mod.stopCallAudio();
  resolve(false);
  await started;
  expect(t.icm.start).not.toHaveBeenCalled();
  expect(t.icm.setKeepScreenOn).not.toHaveBeenCalled();
  await expect(t.mod.selectOutput("speaker")).rejects.toThrow();
});

test("watchRoutes: Telecom events always, incall-manager events only in fallback", async () => {
  const t = load("android", { start: async () => false });
  const seen: unknown[] = [];
  const stop = t.mod.watchRoutes((r) => seen.push(r));
  expect(t.native.routes).not.toHaveBeenCalled(); // Android reports on attach
  t.emitIcm({ availableAudioDeviceList: '["SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  expect(seen).toEqual([]); // not in fallback yet
  await t.mod.startCallAudio("c1", true);
  t.emitIcm({ availableAudioDeviceList: '["SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  t.emit({ outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "x", kind: "nope", name: "?" }], selected: "speaker" });
  expect(seen).toEqual([
    { outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }], selected: "speaker" },
    { outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }], selected: "speaker" },
  ]);
  stop();
  expect(t.moduleListeners.size).toBe(0);
  expect(t.deviceListeners.get("onAudioDeviceChanged")!.size).toBe(0);
});

test("iOS: incall-manager as before, current output fetched at once and followed", async () => {
  const t = load("ios");
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  await flush();
  expect(seen).toEqual([{ outputs: [{ id: "u1", kind: "speaker", name: "Speaker" }], selected: "u1" }]);
  await t.mod.startCallAudio("c1", true);
  expect(t.native.start).not.toHaveBeenCalled();
  expect(t.icm.start).toHaveBeenCalledWith({ media: "video", auto: true });
  await expect(t.mod.selectOutput("u1")).rejects.toThrow();
  t.mod.stopCallAudio();
  expect(t.icm.stop).toHaveBeenCalled();
});

test("without the native module: fallback on Android, still no crash on watch", async () => {
  const t = load("android", { module: false });
  const stop = t.mod.watchRoutes(() => {});
  await t.mod.startCallAudio("c1", true);
  expect(t.icm.start).toHaveBeenCalled();
  stop();
});
```

Append to `mobile/test/call.test.ts`:

```ts
test("systemCallId is the id the system call was started with", async () => {
  const { call, system } = setup();
  expect(call.systemCallId).toBe("");
  await call.join(req());
  const started = system.find((x) => x.startsWith("start "))!;
  expect(started.split(" ")[1]).toBe(call.systemCallId);
  expect(call.systemCallId).not.toBe("");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd mobile && npx jest test/audioRoute.native.test.ts test/call.test.ts -t "systemCallId|Android|iOS|watchRoutes|leaving|native"`
Expected: FAIL (`startCallAudio` takes one argument / `selectOutput` missing / `systemCallId` undefined).

- [ ] **Step 3: Implement**

In `mobile/src/core/call.ts`, after the `private callId = "";` field block's class members (place it just above the first public method of `Call`):

```ts
  // The id the system call (CallKit / ConnectionService) was started with; "" before join.
  get systemCallId(): string {
    return this.callId;
  }
```

Replace `mobile/src/native/audioRoute.ts` with:

```ts
import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { fromInCallManager, parseRoutes, toInCallManager, type Routes } from "../core/audioRoutes";

const { CoyoteAudioRoute } = NativeModules;

// Android: "telecom" once CoyoteAudioRoute attached to the call's Telecom connection
// (it then owns routing, screen-on and proximity); "fallback" when it found none and
// incall-manager does it all as before. iOS: incall-manager as before ("ios").
let mode: "idle" | "telecom" | "fallback" | "ios" = "idle";
// Bumped by every start/stop; a start that finds it moved on was left mid-way.
let token = 0;

// Video calls start on the speaker, audio-only on the earpiece; a connected headset
// takes precedence.
export async function startCallAudio(callId: string, video: boolean): Promise<void> {
  const mine = ++token;
  if (Platform.OS === "android" && CoyoteAudioRoute) {
    const ok: boolean = await CoyoteAudioRoute.start(callId, video).catch(() => false);
    if (mine !== token) return;
    if (ok) {
      mode = "telecom";
      return;
    }
  }
  mode = Platform.OS === "android" ? "fallback" : "ios";
  InCallManager.start({ media: video ? "video" : "audio", auto: true });
  InCallManager.setKeepScreenOn(true);
}

export function stopCallAudio(): void {
  token++;
  if (Platform.OS === "android") CoyoteAudioRoute?.stop();
  if (mode === "fallback" || mode === "ios") {
    InCallManager.setKeepScreenOn(false);
    InCallManager.stop();
  }
  mode = "idle";
}

// Every change of outputs or selection. Android's module reports when it attaches;
// iOS reports the current output right away, then on every route change.
export function watchRoutes(fn: (r: Routes) => void): () => void {
  const subs: { remove(): void }[] = [];
  if (CoyoteAudioRoute) {
    subs.push(new NativeEventEmitter(CoyoteAudioRoute).addListener("CoyoteAudioRoutes", (e) => fn(parseRoutes(e))));
    if (Platform.OS === "ios") {
      CoyoteAudioRoute.routes().then((r: unknown) => fn(parseRoutes(r))).catch(() => {});
    }
  }
  if (Platform.OS === "android") {
    subs.push(DeviceEventEmitter.addListener("onAudioDeviceChanged", (e: unknown) => {
      if (mode === "fallback") fn(fromInCallManager(e));
    }));
  }
  return () => subs.forEach((s) => s.remove());
}

// Android only: iOS picks outputs in the system route picker.
export async function selectOutput(id: string): Promise<void> {
  if (mode === "telecom") return CoyoteAudioRoute.select(id);
  if (mode === "fallback") {
    const route = toInCallManager(id);
    if (!route) throw new Error(`unknown audio output ${id}`);
    await InCallManager.chooseAudioRoute(route);
    return;
  }
  throw new Error("audio output selection is not available");
}
```

Create `mobile/src/native/RoutePicker.tsx`:

```tsx
import type React from "react";
import { Platform, requireNativeComponent, type ViewProps } from "react-native";

// iOS: Apple's output picker (CoyoteRoutePicker, an AVRoutePickerView with its icon
// hidden), laid over the audio button so a tap opens the system sheet. Android has
// no system equivalent: null, and the app shows AudioRouteSheet instead.
export const RoutePicker: React.ComponentType<ViewProps> | null =
  Platform.OS === "ios" ? requireNativeComponent<ViewProps>("CoyoteRoutePicker") : null;
```

In `mobile/src/ui/screens/Call.tsx`, keep the screen compiling against the new glue (Task 6 replaces this wiring):

- Replace the audio-start effect body's `startCallAudio(state.camera);` with:

```ts
      startCallAudio(call()?.systemCallId ?? "", state.camera).catch(warn("call audio"));
```

  and add `call` to that effect's dependency array: `[state?.phase, state?.camera, call]`.
- `watchRoutes(setRoutes)` now delivers `Routes`; change the `routes` state to the new type and the two old uses, temporarily, so typecheck passes:

```ts
import { NO_ROUTES, outputLabel, selectedOutput, type Routes } from "../../core/audioRoutes";
import { selectOutput, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";
// …
  const [routes, setRoutes] = useState<Routes>(NO_ROUTES);
// … in <Controls>:
          routeLabel={outputLabel(selectedOutput(routes)?.kind)}
// …
          onRoute={() => {}}
```

  Remove the now-unused `routeLabel, type AudioRoutes` and `cycleRoute` imports. `selectOutput` is imported here because Task 6 uses it in this file; if lint flags it unused in this commit, leave it out until Task 6.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `cd mobile && npx jest && npm run typecheck && npm run lint`
Expected: all PASS (the old `nextRoute` tests in `audioRoutes.test.ts` still pass; nothing imports `cycleRoute` any more).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/native/audioRoute.ts mobile/src/native/RoutePicker.tsx mobile/src/core/call.ts \
  mobile/src/ui/screens/Call.tsx mobile/test/audioRoute.native.test.ts mobile/test/call.test.ts
git commit -m "feat(mobile): audio route glue picks Telecom or the incall-manager fallback"
```

---

### Task 6: Picker UI and wiring

**Files:**
- Create: `mobile/src/ui/components/AudioRouteSheet.tsx`
- Modify: `mobile/src/ui/components/Controls.tsx`, `mobile/src/ui/screens/Call.tsx`, `mobile/src/ui/CallContext.tsx`
- Modify: `mobile/src/core/audioRoutes.ts` (delete the old `ORDER`, `AudioRoutes`, `nextRoute`, `routeLabel`)
- Delete: `mobile/src/core/iosRoute.ts`, `mobile/test/iosRoute.test.ts`
- Test: `mobile/test/audioRoutes.test.ts` (delete the old `nextRoute` / `routeLabel` tests)

**Interfaces:**
- Consumes: Task 1 (`NO_ROUTES`, `outputLabel`, `selectedOutput`, `sortOutputs`, `pickOutput`, `pendingOutcome`, `Pending`, `Routes`, `OutputKind`); Task 5 (`selectOutput`, `startCallAudio`, `stopCallAudio`, `watchRoutes`, `RoutePicker`, `Call.systemCallId`).
- Produces: `CallCtx.notify(text: string): void`; `Controls` props `routeLabel: string`, `routeA11y: string`, `onRoute(): void`; `AudioRouteSheet({ visible, onClose, routes, onSelect })`.

The UI has no component-test harness (Jest runs `*.test.ts` only); behaviour lives in Task 1's tested functions, and this task is verified by typecheck, lint, the full suite and the device checklist (Task 7).

- [ ] **Step 1: Remove the old cycling code**

Delete `mobile/src/core/iosRoute.ts` and `mobile/test/iosRoute.test.ts` (`git rm`). In `mobile/src/core/audioRoutes.ts`, delete `ORDER`, `AudioRoutes`, `nextRoute` and `routeLabel` (the top of the file down to the new header comment). In `mobile/test/audioRoutes.test.ts`, delete the first import line and the three old tests ("cycles through…", "nothing to switch to", "labels").

Run: `cd mobile && npx jest test/audioRoutes.test.ts && npm run typecheck`
Expected: PASS (nothing else imports the deleted names after Task 5).

- [ ] **Step 2: Expose notices to the Call screen**

In `mobile/src/ui/CallContext.tsx`, add to `CallCtx`:

```ts
  /** Shows a transient notice in the call's banner. */
  notify(text: string): void;
```

and pass the existing `pushNotice` in the provider value:

```tsx
  return <Ctx.Provider value={{ state, outcome, notices, notify: pushNotice, join, leave, call, busy, switchTo, takePendingLink }}>{children}</Ctx.Provider>;
```

- [ ] **Step 3: Create `AudioRouteSheet`**

`mobile/src/ui/components/AudioRouteSheet.tsx`:

```tsx
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { sortOutputs, type OutputKind, type Routes } from "../../core/audioRoutes";
import { colors } from "../theme";
import { Sheet } from "./Sheet";

const ICON: Record<OutputKind, string> = { earpiece: "📱", speaker: "🔊", wired: "🎧", bluetooth: "🎧", car: "🚗" };

// Android's audio output picker: every output Telecom offers, each Bluetooth device
// by name. Picking one closes the sheet; the list follows devices coming and going.
export function AudioRouteSheet({ visible, onClose, routes, onSelect }: {
  visible: boolean; onClose(): void; routes: Routes; onSelect(id: string): void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.4}>
      <ScrollView contentContainerStyle={styles.list}>
        {sortOutputs(routes.outputs).map((o) => {
          const on = o.id === routes.selected;
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.name}
              style={styles.row}
            >
              <Text style={styles.icon}>{ICON[o.kind]}</Text>
              <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>{o.name}</Text>
              {on ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })}
        {routes.outputs.length === 0 ? <Text style={styles.msg}>No audio outputs reported yet.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { fontSize: 20, width: 36 },
  name: { flex: 1, color: colors.text, fontSize: 17 },
  nameOn: { fontWeight: "700" },
  check: { color: colors.accent, fontSize: 18, fontWeight: "700", marginLeft: 8 },
  msg: { color: colors.muted, marginTop: 12 },
});
```

- [ ] **Step 4: Update `Controls`**

In `mobile/src/ui/components/Controls.tsx`:

- Add `import { RoutePicker } from "../../native/RoutePicker";`.
- In `Props`, after `routeLabel: string;` add `routeA11y: string;`.
- Add `hidden?: boolean` to `BtnProps` and to `Btn`'s destructuring (`hidden = false`), and on its `Pressable` add `accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}`.
- Replace the route button line with:

```tsx
      {RoutePicker ? (
        // iOS: the system route picker sits on top and takes the tap and VoiceOver.
        <View>
          <Btn label={p.routeLabel} onPress={p.onRoute} fit a11y={p.routeA11y} hidden />
          <RoutePicker style={StyleSheet.absoluteFill} accessible accessibilityLabel={p.routeA11y} />
        </View>
      ) : (
        <Btn label={p.routeLabel} onPress={p.onRoute} fit a11y={p.routeA11y} />
      )}
```

- [ ] **Step 5: Wire the Call screen**

In `mobile/src/ui/screens/Call.tsx`:

- Imports: add `Platform` to the `react-native` import; replace the audioRoutes import with

```ts
import { NO_ROUTES, outputLabel, pendingOutcome, pickOutput, selectedOutput, type Pending, type Routes } from "../../core/audioRoutes";
```

  keep `import { selectOutput, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";` and add `import { AudioRouteSheet } from "../components/AudioRouteSheet";`.
- `const { state, notices, notify, leave, call, outcome, takePendingLink, busy } = useCall();`
- After the `routes` state: `const [pending, setPending] = useState<Pending | null>(null);`
- Sheet union: `useState<"chat" | "more" | "poll-form" | "background" | "audio" | null>(null)`.
- After the audio-start effect, add:

```ts
  // A requested output switch: settled by the next report that selects it, failed
  // when the output vanishes, the platform rejects it, or 5 s pass.
  useEffect(() => {
    if (!pending) return;
    const fail = () => {
      setPending(null);
      notify(`Couldn't switch to ${pending.name}.`);
    };
    const o = pendingOutcome(pending, routes, Date.now());
    if (o.kind === "done") {
      setPending(null);
      return;
    }
    if (o.kind === "failed") {
      fail();
      return;
    }
    const t = setTimeout(fail, o.ms);
    return () => clearTimeout(t);
  }, [pending, routes, notify]);
```

- Before `return (` of the in-call render (after `const viewed = …`):

```ts
  const current = selectedOutput(routes);
  const pickRoute = (id: string) => {
    setSheet(null);
    const p = pickOutput(routes, id, Date.now());
    if (!p) return;
    setPending(p);
    // at: 0 marks it failed; the pending effect shows the notice.
    selectOutput(id).catch((e) => {
      console.warn("audio output failed", e);
      setPending((cur) => (cur === p ? { ...p, at: 0 } : cur));
    });
  };
```

- `<Controls>` props: replace `routeLabel={…}` and `onRoute={() => {}}` with

```tsx
          routeLabel={pending ? "…" : outputLabel(current?.kind)}
          routeA11y={`Audio output: ${current?.name ?? outputLabel(undefined)}`}
          onRoute={() => {
            if (Platform.OS !== "android") return; // iOS: the route picker takes the tap
            setSheet(sheet === "audio" ? null : "audio");
            call()?.chat.setOpen(false);
          }}
```

- After `<BackgroundSheet … />`:

```tsx
        <AudioRouteSheet visible={sheet === "audio"} onClose={() => setSheet(null)} routes={routes} onSelect={pickRoute} />
```

- [ ] **Step 6: Run the full checks**

Run: `cd mobile && npx jest && npm run typecheck && npm run lint && git grep -n "cycleRoute\|nextRoute\|iosRoute\|routeLabel(" -- src test`
Expected: all PASS; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A mobile/src mobile/test
git commit -m "feat(mobile): audio output picker replaces the cycling route button"
```

---

### Task 7: Device checklist and version 1.6.0

**Files:**
- Modify: `mobile/MANUAL-TEST.md` (items 70–77)
- Modify: `mobile/android/app/build.gradle` (`versionCode 10`, `versionName "1.6.0"`)
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (four `CURRENT_PROJECT_VERSION = 10;`, four `MARKETING_VERSION = 1.6.0;`)

- [ ] **Step 1: Append the checklist**

Append to `mobile/MANUAL-TEST.md` (match the existing numbered, bold-titled style):

```markdown
70. **Android call audio (risk check, do first).** On an Android 14+ phone and an
    Android 9–13 device: join a call and hear the others; they hear you. Audio-only
    call: it starts on the earpiece and the screen turns off at your ear. Video call:
    it starts on the speaker. (No call audio at all means Telecom didn't set the
    call audio mode: report it; the fix is to start incall-manager for the mode only.)
71. **Output list.** Tap the audio button: a sheet lists Phone, Speaker and any
    headset; the current one has ✓. Pick Speaker, then Phone: audio moves each time
    and the button follows.
72. **Two Bluetooth devices.** Connect two (earbuds and a speaker or car): both are
    listed by name; picking each moves the call audio there. Mute and unmute your mic:
    both stay listed.
73. **Changes from outside the app.** Mid-call, put the earbuds in their case, turn
    Bluetooth off and on, plug in a wired headset: the button's label follows each
    change; an open sheet updates live.
74. **Tablet.** On the tablet: the list shows Speaker (plus any Bluetooth), never
    Phone.
75. **Failed switch.** Pick a Bluetooth device and switch it off at the same moment:
    within 5 s "Couldn't switch to <name>." appears and the label shows the real
    output.
76. **iPhone picker.** Tap the audio button: Apple's output sheet opens and lists
    iPhone, Speaker, AirPods etc. Pick each: audio moves and the label follows. Switch
    from Control Centre: the label follows too. Video calls still start on the
    speaker. VoiceOver reads "Audio output: <name>".
77. **Leaving.** After leaving a call (Android): the screen times out normally again
    and the proximity sensor no longer blanks it.
```

- [ ] **Step 2: Bump the version**

In `mobile/android/app/build.gradle`: `versionCode 9` → `versionCode 10`, `versionName "1.5.1"` → `versionName "1.6.0"`.
In `mobile/ios/Coyote.xcodeproj/project.pbxproj`: `CURRENT_PROJECT_VERSION = 9;` → `10;` and `MARKETING_VERSION = 1.5.1;` → `1.6.0;` (four each).

Run: `cd mobile && grep -c "CURRENT_PROJECT_VERSION = 10;" ios/Coyote.xcodeproj/project.pbxproj && grep -c "MARKETING_VERSION = 1.6.0;" ios/Coyote.xcodeproj/project.pbxproj && grep -n "versionCode\|versionName" android/app/build.gradle`
Expected: `4`, `4`, `versionCode 10`, `versionName "1.6.0"`.

- [ ] **Step 3: Final verification**

Run: `cd mobile && npx jest && npm run typecheck && npm run lint`
Run (output trimmed): `cd mobile/android && source ./env.sh && ./gradlew :app:assembleDebug -q 2>&1 | grep -E "^e:|error:|FAILED" | head -30; echo exit=${PIPESTATUS[0]}`
Expected: all PASS; `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add mobile/MANUAL-TEST.md mobile/android/app/build.gradle mobile/ios/Coyote.xcodeproj/project.pbxproj
git commit -m "chore(mobile): 1.6.0 (build 10) with audio output picker device checks"
```

---

## Notes for the executor

- Deviation from the spec, deliberate: the spec's JS `initialOutput` helper is dropped. In fallback mode incall-manager's `auto: true` already picks the starting output, and on the Telecom path the Kotlin module does, so a JS copy would be dead code.
- Android `bt:` ids differ by API level (`bt:<address>` on 28–33, `bt:<CallEndpoint identifier>` on 34+); JS treats ids as opaque, so this is invisible above the module.
- Swift / ObjC is not compiled here. Report "not compiled; build on the Mac" rather than claiming iOS works.
