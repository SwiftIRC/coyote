# Android Picture-in-Picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Android, leaving the app during a live call shrinks it into a picture-in-picture window showing one tile, with mute and hang-up buttons; the camera keeps sending.

**Architecture:** Pure logic in `core/pip.ts` (which tile, the native params, action routing). An in-house Kotlin `Pip` object (driven by `MainActivity`'s lifecycle) plus a thin `CoyotePip` React module apply `PictureInPictureParams`, enter PiP on 8–11, and emit PiP mode, on-screen state and button presses. `native/pip.ts` wraps the module; `native/lifecycle.ts` switches Android's camera-off/restore trigger from `AppState` to the activity's `onStart`/`onStop`. `Call.tsx` renders `PipView` while in PiP.

**Tech Stack:** React Native 0.87 (TypeScript, Jest), Kotlin (Android API 24–37, PiP API 26+, auto-enter API 31+), react-native-webrtc 124 (`RTCView`).

**Spec:** `docs/superpowers/specs/2026-10-18-mobile-android-pip-design.md`

## Global Constraints

- Android only. iOS behaviour is unchanged (`AppState` still drives `onAppState` there; `native/pip.ts` is a no-op on iOS).
- PiP is allowed only while the call phase is `in-call` or `reconnecting`.
- Auto-enter on API 31+ (`setAutoEnterEnabled`); `onUserLeaveHint` → `enterPictureInPictureMode` on API 26–30; nothing on API 24–25.
- Aspect ratio: 16:9 for a screenshare, 3:4 for a person (and for yourself).
- PiP buttons: mic ("Mute" / "Unmute", icon shows the current state) and "Hang up".
- Closing the PiP window keeps the call going (it is the ordinary backgrounding path).
- When the call ends while in PiP, native brings the activity back to the front.
- No new third-party dependency. Icons are Material Icons paths (Apache-2.0), credited in `THIRD-PARTY-NOTICES.md`.
- Deviations from the spec, on purpose: `pipTile(people)` takes no `selfSharing` argument (your own share is never the PiP tile, so it isn't needed); there is no JS `isSupported()` (native checks `FEATURE_PICTURE_IN_PICTURE` itself and JS never needs the answer); a screenshare counts for PiP only when it has video (`p.screen`), since an audio-only share has nothing to show.
- Release: 1.8.0, iOS build 13 (all four `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION` places in `ios/Coyote.xcodeproj/project.pbxproj`), Android `versionCode 13` / `versionName "1.8.0"`, as the last task.
- Commits: no Co-Authored-By trailer. Work on branch `feat/mobile-android-pip`; merge to master locally when done; push only when the user asks.
- All commands run from `mobile/` unless stated. Android builds need `source android/env.sh` first. Disk is nearly full: build only what a step names, never `clean` other projects.

## Review Focus

1. **Visibility before JS subscribes.** The app can be backgrounded while JS is still starting (e.g. opened from a link, then Home). JS assumes "visible" at subscribe time, so a missed `onStop` means the first event is `onStart` (dropped as a repeat) and the camera wasn't turned off for that background. Accepted: the call doesn't exist yet then; covered by the lifecycle test that the first event equal to the assumed state is dropped.
2. **PiP buttons through a not-exported receiver.** The receiver is registered `RECEIVER_NOT_EXPORTED`; the PendingIntents are explicit (`setPackage`) and created by the app, so System UI's send runs as the app. Only checkable on device (MANUAL-TEST 89).
3. **Expanding from code when the call ends.** `startActivity(… REORDER_TO_FRONT | SINGLE_TOP)` on the singleTask `MainActivity` must expand the PiP window rather than open a second one, and React Native's `onNewIntent` must not treat it as a deep link (no data URI, so `Linking` emits nothing). Only checkable on device (MANUAL-TEST 90, 95).
4. **The mic button's toggle direction.** A press must flip the *current* mic state, not the state when the listener was registered. Covered by Task 4's `micRef` and the `runPipAction` test; device check in MANUAL-TEST 89.
5. **Repeated or reordered lifecycle events.** `onStart` twice (configuration changes don't recreate the activity, but some OEMs send extra callbacks) must not restore the camera twice. Covered by the lifecycle dedupe test.

---

### Task 1: PiP logic in `core/pip.ts`

**Files:**
- Create: `src/core/pip.ts`
- Test: `test/pip.test.ts`

**Interfaces:**
- Consumes: `Participant` (`src/core/roster.ts`), `CallState` (`src/core/call.ts`, type only).
- Produces:
  - `type PipTile = { kind: "screen"; p: Participant } | { kind: "person"; p: Participant } | { kind: "self" }`
  - `type PipAspect = "screen" | "person"`
  - `type PipAction = "mic" | "hangup"`
  - `interface PipParams { enabled: boolean; micOn: boolean; aspect: PipAspect }`
  - `const PIP_OFF: PipParams`
  - `pipTile(people: Participant[]): PipTile`
  - `pipOthers(t: PipTile, people: Participant[]): number`
  - `pipParams(s: Pick<CallState, "phase" | "mic" | "participants"> | null): PipParams`
  - `runPipAction(a: PipAction, h: { toggleMic(): void; hangup(): void }): void`

- [ ] **Step 1: Write the failing tests** — create `test/pip.test.ts`:

```ts
import { PIP_OFF, pipOthers, pipParams, pipTile, runPipAction } from "../src/core/pip";
import type { Participant } from "../src/core/roster";

const stream = { toURL: () => "s" };
const person = (id: string, extra: Partial<Participant> = {}): Participant => ({
  id, name: id, role: "", mic: true, camera: true, ref: id, gravatar: "",
  video: stream, audio: stream, screen: null, screenAudio: null, ...extra,
});

test("pipTile: the first sharer's screen wins over everyone before them", () => {
  const a = person("a");
  const b = person("b", { screen: stream });
  const c = person("c", { screen: stream });
  expect(pipTile([a, b, c])).toEqual({ kind: "screen", p: b });
});

test("pipTile: an audio-only share is not shown; the first person is", () => {
  const a = person("a");
  const b = person("b", { screenAudio: stream });
  expect(pipTile([a, b])).toEqual({ kind: "person", p: a });
});

test("pipTile: the first person, camera on or off", () => {
  const a = person("a", { camera: false, video: null });
  expect(pipTile([a, person("b")])).toEqual({ kind: "person", p: a });
});

test("pipTile: alone in the room shows yourself", () => {
  expect(pipTile([])).toEqual({ kind: "self" });
});

test("pipOthers counts everyone but the one shown", () => {
  const people = [person("a"), person("b", { screen: stream }), person("c")];
  expect(pipOthers(pipTile(people), people)).toBe(2);
  expect(pipOthers(pipTile([person("a")]), [person("a")])).toBe(0);
  expect(pipOthers({ kind: "self" }, [])).toBe(0);
});

test("pipParams: on while in-call or reconnecting, with the mic and the tile's aspect", () => {
  const people = [person("a")];
  expect(pipParams({ phase: "in-call", mic: true, participants: people })).toEqual({ enabled: true, micOn: true, aspect: "person" });
  expect(pipParams({ phase: "reconnecting", mic: false, participants: [person("b", { screen: stream })] }))
    .toEqual({ enabled: true, micOn: false, aspect: "screen" });
  expect(pipParams({ phase: "in-call", mic: true, participants: [] })).toEqual({ enabled: true, micOn: true, aspect: "person" });
});

test("pipParams: off before the call is up, after it ends, and without a call", () => {
  for (const phase of ["idle", "connecting", "ended"] as const) {
    expect(pipParams({ phase, mic: true, participants: [person("a")] })).toEqual(PIP_OFF);
  }
  expect(pipParams(null)).toEqual(PIP_OFF);
  expect(PIP_OFF.enabled).toBe(false);
});

test("runPipAction routes each button", () => {
  const h = { toggleMic: jest.fn(), hangup: jest.fn() };
  runPipAction("mic", h);
  expect(h.toggleMic).toHaveBeenCalledTimes(1);
  expect(h.hangup).not.toHaveBeenCalled();
  runPipAction("hangup", h);
  expect(h.hangup).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/pip.test.ts`
Expected: FAIL, `Cannot find module '../src/core/pip'`.

- [ ] **Step 3: Implement** — create `src/core/pip.ts`:

```ts
import type { CallState } from "./call";
import type { Participant } from "./roster";

// What the Android picture-in-picture window shows: someone's screenshare, else the
// first person in grid order, else yourself when alone. Your own share never: it's
// what you're already looking at.
export type PipTile =
  | { kind: "screen"; p: Participant }
  | { kind: "person"; p: Participant }
  | { kind: "self" };

export type PipAspect = "screen" | "person"; // 16:9 / 3:4
export type PipAction = "mic" | "hangup";

export interface PipParams {
  enabled: boolean; // PiP allowed: the call is up
  micOn: boolean; // for the mic button's icon and label
  aspect: PipAspect;
}

export const PIP_OFF: PipParams = { enabled: false, micOn: false, aspect: "person" };

export function pipTile(people: Participant[]): PipTile {
  const sharer = people.find((p) => !!p.screen); // an audio-only share has nothing to show
  if (sharer) return { kind: "screen", p: sharer };
  return people.length ? { kind: "person", p: people[0] } : { kind: "self" };
}

// How many others are in the call besides the one shown ("+N").
export function pipOthers(t: PipTile, people: Participant[]): number {
  return t.kind === "self" ? 0 : people.length - 1;
}

export function pipParams(s: Pick<CallState, "phase" | "mic" | "participants"> | null): PipParams {
  if (!s || (s.phase !== "in-call" && s.phase !== "reconnecting")) return PIP_OFF;
  return { enabled: true, micOn: s.mic, aspect: pipTile(s.participants).kind === "screen" ? "screen" : "person" };
}

export function runPipAction(a: PipAction, h: { toggleMic(): void; hangup(): void }): void {
  if (a === "mic") h.toggleMic();
  else h.hangup();
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx jest test/pip.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/pip.ts test/pip.test.ts
git commit -m "feat(mobile): pick the picture-in-picture tile and params"
```

---

### Task 2: JS glue — `native/pip.ts`, Android lifecycle from the activity

**Files:**
- Create: `src/native/pip.ts`
- Modify: `src/native/lifecycle.ts`
- Test: `test/pip.native.test.ts`, `test/lifecycle.native.test.ts`

**Interfaces:**
- Consumes: `PipAction`, `PipParams` from `src/core/pip.ts` (Task 1). Native module `CoyotePip` (Task 3): method `setPip(enabled: boolean, micOn: boolean, aspect: string)`, events `CoyotePipChanged { inPip: boolean }`, `CoyotePipVisibility { visible: boolean }`, `CoyotePipAction { action: "mic" | "hangup" }`.
- Produces:
  - `setPip(p: PipParams): void`
  - `watchPip(fn: (inPip: boolean) => void): () => void`
  - `watchPipActions(fn: (a: PipAction) => void): () => void`
  - `watchVisibility(fn: (visible: boolean) => void): (() => void) | null` (null when unavailable: iOS, or the module is missing)
  - `watchLifecycle` keeps its signature.

- [ ] **Step 1: Write the failing tests** — create `test/pip.native.test.ts`:

```ts
// The picture-in-picture native glue, with react-native mocked.
export {};
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", module = true) {
  jest.resetModules();
  const native = { setPip: jest.fn() };
  const listeners = new Map<string, Set<Listener>>();
  class NativeEventEmitter {
    addListener(name: string, fn: Listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return { remove: () => listeners.get(name)!.delete(fn) };
    }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: module ? { CoyotePip: native } : {},
    NativeEventEmitter,
  }));
  let mod: typeof import("../src/native/pip") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/pip");
  });
  return { mod: mod!, native, emit: (name: string, e: unknown) => listeners.get(name)?.forEach((fn) => fn(e)), listeners };
}

test("setPip passes the params to the module on Android", () => {
  const { mod, native } = load("android");
  mod.setPip({ enabled: true, micOn: false, aspect: "screen" });
  expect(native.setPip).toHaveBeenCalledWith(true, false, "screen");
});

test("iOS: setPip does nothing and there is no visibility source", () => {
  const { mod, native } = load("ios");
  mod.setPip({ enabled: true, micOn: true, aspect: "person" });
  expect(native.setPip).not.toHaveBeenCalled();
  expect(mod.watchVisibility(() => {})).toBeNull();
  const fn = jest.fn();
  mod.watchPip(fn)();
  mod.watchPipActions(fn)();
  expect(fn).not.toHaveBeenCalled();
});

test("Android without the module: no visibility source, no crash", () => {
  const { mod } = load("android", false);
  expect(mod.watchVisibility(() => {})).toBeNull();
  expect(() => mod.setPip({ enabled: false, micOn: false, aspect: "person" })).not.toThrow();
});

test("events reach their watchers; malformed ones are dropped; unsubscribe stops them", () => {
  const { mod, emit, listeners } = load("android");
  const pip = jest.fn();
  const act = jest.fn();
  const vis = jest.fn();
  const stopPip = mod.watchPip(pip);
  const stopAct = mod.watchPipActions(act);
  const stopVis = mod.watchVisibility(vis)!;
  emit("CoyotePipChanged", { inPip: true });
  emit("CoyotePipChanged", {});
  emit("CoyotePipAction", { action: "mic" });
  emit("CoyotePipAction", { action: "dance" });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: "no" });
  expect(pip.mock.calls).toEqual([[true], [false]]);
  expect(act.mock.calls).toEqual([["mic"]]);
  expect(vis.mock.calls).toEqual([[false]]);
  stopPip(); stopAct(); stopVis();
  for (const s of listeners.values()) expect(s.size).toBe(0);
});
```

Create `test/lifecycle.native.test.ts`:

```ts
// watchLifecycle: Android follows the activity's on-screen state, iOS AppState.
export {};
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", module = true) {
  jest.resetModules();
  const listeners = new Map<string, Set<Listener>>();
  const add = (name: string, fn: Listener) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
    return { remove: () => listeners.get(name)!.delete(fn) };
  };
  class NativeEventEmitter {
    addListener(name: string, fn: Listener) { return add(name, fn); }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: module ? { CoyotePip: { setPip: jest.fn() } } : {},
    NativeEventEmitter,
    AppState: { addEventListener: (_: string, fn: Listener) => add("AppState", fn) },
  }));
  jest.doMock("@react-native-community/netinfo", () => ({
    __esModule: true,
    default: { addEventListener: (fn: Listener) => { const s = add("NetInfo", fn); return () => s.remove(); } },
  }));
  let mod: typeof import("../src/native/lifecycle") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/lifecycle");
  });
  const call = { onAppState: jest.fn(async () => {}), onNetworkChange: jest.fn() };
  const stop = mod!.watchLifecycle(call);
  return { call, stop, listeners, emit: (name: string, e: unknown) => listeners.get(name)?.forEach((fn) => fn(e)) };
}

test("Android: stop → background, start → active; AppState is ignored", () => {
  const { call, emit } = load("android");
  emit("AppState", "background"); // shrinking into PiP pauses the activity
  expect(call.onAppState).not.toHaveBeenCalled();
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: true });
  expect(call.onAppState.mock.calls).toEqual([["background"], ["active"]]);
});

test("Android: repeats are dropped, including a first 'visible'", () => {
  const { call, emit } = load("android");
  emit("CoyotePipVisibility", { visible: true });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: false });
  emit("CoyotePipVisibility", { visible: true });
  emit("CoyotePipVisibility", { visible: true });
  expect(call.onAppState.mock.calls).toEqual([["background"], ["active"]]);
});

test("Android without the module falls back to AppState", () => {
  const { call, emit } = load("android", false);
  emit("AppState", "background");
  expect(call.onAppState.mock.calls).toEqual([["background"]]);
});

test("iOS: AppState as before", () => {
  const { call, emit } = load("ios");
  emit("AppState", "inactive");
  emit("AppState", "background");
  emit("AppState", "active");
  emit("AppState", "unknown");
  expect(call.onAppState.mock.calls).toEqual([["inactive"], ["background"], ["active"]]);
});

test("unsubscribes everything", () => {
  const { stop, listeners } = load("android");
  stop();
  for (const s of listeners.values()) expect(s.size).toBe(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/pip.native.test.ts test/lifecycle.native.test.ts`
Expected: FAIL — `Cannot find module '../src/native/pip'`; the lifecycle Android tests fail because `CoyotePipVisibility` events don't reach `onAppState` (and the AppState-ignored assertion fails).

- [ ] **Step 3: Implement `src/native/pip.ts`**

```ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { PipAction, PipParams } from "../core/pip";

// Android picture-in-picture (CoyotePip). A no-op on iOS and when the module is
// missing; watchVisibility then returns null so callers can fall back to AppState.
const native = Platform.OS === "android" ? NativeModules.CoyotePip ?? null : null;
let emitter: NativeEventEmitter | null = null;

function on(event: string, fn: (e: Record<string, unknown>) => void): () => void {
  if (!native) return () => {};
  emitter ??= new NativeEventEmitter(native);
  const sub = emitter.addListener(event, (e: unknown) => fn((e ?? {}) as Record<string, unknown>));
  return () => sub.remove();
}

export function setPip(p: PipParams): void {
  native?.setPip(p.enabled, p.micOn, p.aspect);
}

export function watchPip(fn: (inPip: boolean) => void): () => void {
  return on("CoyotePipChanged", (e) => fn(e.inPip === true));
}

export function watchPipActions(fn: (a: PipAction) => void): () => void {
  return on("CoyotePipAction", (e) => {
    if (e.action === "mic" || e.action === "hangup") fn(e.action);
  });
}

// The activity's on-screen state (onStart / onStop).
export function watchVisibility(fn: (visible: boolean) => void): (() => void) | null {
  if (!native) return null;
  return on("CoyotePipVisibility", (e) => {
    if (typeof e.visible === "boolean") fn(e.visible);
  });
}
```

- [ ] **Step 4: Rewrite `src/native/lifecycle.ts`**

```ts
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { Call } from "../core/call";
import { watchVisibility } from "./pip";

type AppPhase = "active" | "background" | "inactive";

// Feeds foreground/background and network changes to the call. A network change
// that keeps "connected" (wifi -> cellular) still reports, because the socket
// usually dies with the old interface; the call only reconnects if it is down.
export function watchLifecycle(call: Pick<Call, "onAppState" | "onNetworkChange">): () => void {
  const report = (s: AppPhase) => call.onAppState(s).catch((e: unknown) => console.warn("onAppState failed", e));
  // Android: the activity's on-screen state, not AppState, which says "background" on
  // pause, and a call shrunk into picture-in-picture is paused but still on screen (its
  // camera keeps sending). Assumed visible at start; repeats are dropped so a restore
  // can't run twice.
  let visible = true;
  const stopVisibility = Platform.OS === "android"
    ? watchVisibility((v) => {
      if (v === visible) return;
      visible = v;
      report(v ? "active" : "background");
    })
    : null;
  const app = stopVisibility ? null : AppState.addEventListener("change", (s) => {
    if (s === "active" || s === "background" || s === "inactive") report(s);
  });
  let last: { connected: boolean; type: string } | null = null; // first event is the baseline
  const net = NetInfo.addEventListener((st) => {
    const now = { connected: !!st.isConnected, type: String(st.type) };
    if (last && now.connected && (!last.connected || now.type !== last.type)) call.onNetworkChange(true);
    last = now;
  });
  return () => {
    stopVisibility?.();
    app?.remove();
    net();
  };
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `npx jest test/pip.native.test.ts test/lifecycle.native.test.ts && npm run typecheck && npm run lint`
Expected: PASS (4 + 5 tests); no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/native/pip.ts src/native/lifecycle.ts test/pip.native.test.ts test/lifecycle.native.test.ts
git commit -m "feat(mobile): picture-in-picture glue; Android lifecycle follows the activity's on-screen state"
```

---

### Task 3: Android native — `Pip`, `CoyotePip`, `MainActivity`, manifest, icons

**Files:**
- Create: `android/app/src/main/java/net/swiftirc/coyote/Pip.kt`
- Create: `android/app/src/main/java/net/swiftirc/coyote/CoyotePipModule.kt`
- Create: `android/app/src/main/java/net/swiftirc/coyote/CoyotePipPackage.kt`
- Create: `android/app/src/main/res/drawable/ic_pip_mic.xml`, `ic_pip_mic_off.xml`, `ic_pip_hangup.xml`
- Modify: `android/app/src/main/java/net/swiftirc/coyote/MainActivity.kt`
- Modify: `android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt` (register the package)
- Modify: `android/app/src/main/AndroidManifest.xml` (`supportsPictureInPicture`)
- Modify: `../THIRD-PARTY-NOTICES.md` (Material Icons)
- Test: `test/nativeModules.test.ts`

**Interfaces:**
- Consumes: nothing from JS tasks; produces what Task 2 consumes.
- Produces: React module `CoyotePip` with `@ReactMethod setPip(enabled: Boolean, micOn: Boolean, aspect: String)`, `addListener`, `removeListeners`; events `CoyotePipChanged { inPip }`, `CoyotePipVisibility { visible }`, `CoyotePipAction { action }`. Kotlin `object Pip` with `onStart(a: Activity)`, `onStop()`, `onUserLeaveHint(a: Activity)`, `onModeChanged(inPip: Boolean)`, `attach(m: CoyotePipModule, ctx: Context)`, `detach(m: CoyotePipModule)`, `set(enabled: Boolean, micOn: Boolean, screen: Boolean)`.

- [ ] **Step 1: Write the failing guard tests** — append to `test/nativeModules.test.ts`:

```ts
// Picture-in-picture (Android): the manifest opts in, MainActivity forwards the four
// callbacks Pip needs, and the module is registered.
describe("picture-in-picture wiring", () => {
  const app = path.join(__dirname, "..", "android", "app", "src", "main");
  const read = (...p: string[]) => fs.readFileSync(path.join(app, ...p), "utf8");
  const kt = (f: string) => read("java", "net", "swiftirc", "coyote", f);

  test("MainActivity declares supportsPictureInPicture", () => {
    const activity = read("AndroidManifest.xml").match(/<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>/)?.[0] ?? "";
    expect(activity).toContain('android:supportsPictureInPicture="true"');
  });

  test("MainActivity forwards onStart, onStop, onUserLeaveHint and PiP mode changes", () => {
    const src = kt("MainActivity.kt");
    expect(src).toMatch(/override fun onStart\(\)[\s\S]*?Pip\.onStart\(this\)/);
    expect(src).toMatch(/override fun onStop\(\)[\s\S]*?Pip\.onStop\(\)/);
    expect(src).toMatch(/override fun onUserLeaveHint\(\)[\s\S]*?Pip\.onUserLeaveHint\(this\)/);
    expect(src).toMatch(/override fun onPictureInPictureModeChanged\([\s\S]*?Pip\.onModeChanged\(/);
  });

  test("CoyotePipPackage is registered", () => {
    expect(kt("MainApplication.kt")).toContain("add(CoyotePipPackage())");
  });

  test("the PiP button receiver is not exported and its intents are explicit", () => {
    const src = kt("Pip.kt");
    expect(src).toContain("RECEIVER_NOT_EXPORTED");
    expect(src).toContain("setPackage(");
    expect(src).toContain("FLAG_IMMUTABLE");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest test/nativeModules.test.ts`
Expected: the four new tests FAIL (no manifest attribute, no overrides, no registration, `Pip.kt` missing → ENOENT); the existing tests still pass.

- [ ] **Step 3: Create `Pip.kt`**

```kotlin
package net.swiftirc.coyote

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference

// Picture-in-picture for a live call. JS says when PiP is allowed (CoyotePip.setPip);
// MainActivity forwards its lifecycle here. Leaving the app enters PiP (auto-enter on
// 12+, onUserLeaveHint on 8–11); PiP mode, the activity's on-screen state and the PiP
// buttons go back to JS through the module. All state is confined to the main thread.
object Pip {
  private const val TAG = "CoyotePip"
  private const val ACTION = "net.swiftirc.coyote.PIP_ACTION"
  private const val EXTRA = "action"

  private val main = Handler(Looper.getMainLooper())
  private var activity = WeakReference<Activity>(null)
  private var module: CoyotePipModule? = null
  private var receiver: BroadcastReceiver? = null
  private var enabled = false
  private var micOn = false
  private var screen = false

  fun attach(m: CoyotePipModule, ctx: Context) {
    main.post {
      module = m
      if (receiver == null) {
        val r = object : BroadcastReceiver() {
          override fun onReceive(c: Context, i: Intent) {
            val a = i.getStringExtra(EXTRA)
            if (a == "mic" || a == "hangup") module?.emit("CoyotePipAction", "action", a)
          }
        }
        ContextCompat.registerReceiver(ctx.applicationContext, r, IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = r
      }
    }
  }

  fun detach(m: CoyotePipModule) {
    main.post { if (module === m) module = null }
  }

  fun set(enabled: Boolean, micOn: Boolean, screen: Boolean) {
    main.post {
      val wasEnabled = this.enabled
      this.enabled = enabled
      this.micOn = micOn
      this.screen = screen
      val a = activity.get() ?: return@post
      apply(a)
      // The call ended while shrunk: bring the app back so the window closes.
      if (wasEnabled && !enabled && Build.VERSION.SDK_INT >= 26 && a.isInPictureInPictureMode) {
        a.startActivity(Intent(a, a.javaClass).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      }
    }
  }

  fun onStart(a: Activity) {
    activity = WeakReference(a)
    apply(a)
    module?.emit("CoyotePipVisibility", "visible", true)
  }

  fun onStop() {
    module?.emit("CoyotePipVisibility", "visible", false)
  }

  // Android 8–11 have no auto-enter: enter on Home / the gesture / switching apps.
  fun onUserLeaveHint(a: Activity) {
    // Plain comparisons (not `in 26..30`) so lint's NewApi check sees the guard.
    if (Build.VERSION.SDK_INT < 26 || Build.VERSION.SDK_INT >= 31) return
    if (!enabled || !supported(a) || a.isInPictureInPictureMode) return
    try {
      a.enterPictureInPictureMode(params(a))
    } catch (e: IllegalStateException) {
      Log.w(TAG, "enterPictureInPictureMode failed", e) // PiP turned off for the app
    }
  }

  fun onModeChanged(inPip: Boolean) {
    module?.emit("CoyotePipChanged", "inPip", inPip)
  }

  private fun supported(a: Activity) = a.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  private fun apply(a: Activity) {
    if (Build.VERSION.SDK_INT < 26 || !supported(a)) return
    try {
      a.setPictureInPictureParams(params(a))
    } catch (e: IllegalStateException) {
      Log.w(TAG, "setPictureInPictureParams failed", e)
    }
  }

  @RequiresApi(26)
  private fun params(c: Context): PictureInPictureParams {
    val b = PictureInPictureParams.Builder()
      .setAspectRatio(if (screen) Rational(16, 9) else Rational(3, 4))
      .setActions(if (enabled) actions(c) else emptyList())
    if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(enabled)
    return b.build()
  }

  @RequiresApi(26)
  private fun actions(c: Context) = listOf(
    if (micOn) action(c, "mic", R.drawable.ic_pip_mic, "Mute", 1)
    else action(c, "mic", R.drawable.ic_pip_mic_off, "Unmute", 1),
    action(c, "hangup", R.drawable.ic_pip_hangup, "Hang up", 2),
  )

  @RequiresApi(26)
  private fun action(c: Context, id: String, icon: Int, title: String, req: Int): RemoteAction {
    val intent = Intent(ACTION).setPackage(c.packageName).putExtra(EXTRA, id)
    val pi = PendingIntent.getBroadcast(c, req, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return RemoteAction(Icon.createWithResource(c, icon), title, title, pi)
  }
}
```

- [ ] **Step 4: Create `CoyotePipModule.kt` and `CoyotePipPackage.kt`**

```kotlin
package net.swiftirc.coyote

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// The JS side of Pip: whether PiP is allowed, and its events.
class CoyotePipModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyotePip"

  init {
    Pip.attach(this, ctx)
  }

  @ReactMethod
  fun setPip(enabled: Boolean, micOn: Boolean, aspect: String) {
    Pip.set(enabled, micOn, aspect == "screen")
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  fun emit(event: String, key: String, value: Any) {
    if (!ctx.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply {
      when (value) {
        is Boolean -> putBoolean(key, value)
        else -> putString(key, value.toString())
      }
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, body)
  }

  override fun invalidate() {
    Pip.detach(this)
    super.invalidate()
  }
}
```

```kotlin
package net.swiftirc.coyote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CoyotePipPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CoyotePipModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
```

In `MainApplication.kt`, after `add(CoyoteAudioRoutePackage())`, add:

```kotlin
          add(CoyotePipPackage())
```

- [ ] **Step 5: Forward the callbacks in `MainActivity.kt`** — add the import `android.content.res.Configuration` and, inside the class after `createReactActivityDelegate`:

```kotlin

  // Picture-in-picture for a live call (Pip).
  override fun onStart() {
    super.onStart()
    Pip.onStart(this)
  }

  override fun onStop() {
    super.onStop()
    Pip.onStop()
  }

  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    Pip.onUserLeaveHint(this)
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    Pip.onModeChanged(isInPictureInPictureMode)
  }
```

- [ ] **Step 6: Manifest** — in `AndroidManifest.xml`, add to the `.MainActivity` element, after `android:windowSoftInputMode="adjustResize"`:

```xml
        android:supportsPictureInPicture="true"
```

- [ ] **Step 7: Icons** — Material Icons paths (Apache-2.0), white on the PiP scrim.

`android/app/src/main/res/drawable/ic_pip_mic.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11L5,11c0,3.41 2.72,6.23 6,6.72L11,21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z"/>
</vector>
```

`android/app/src/main/res/drawable/ic_pip_mic_off.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M19,11h-1.7c0,0.74 -0.16,1.43 -0.43,2.05l1.23,1.23c0.56,-0.98 0.9,-2.09 0.9,-3.28zM14.98,11.17c0,-0.06 0.02,-0.11 0.02,-0.17L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v0.18l5.98,5.99zM4.27,3L3,4.27l6.01,6.01L9,11c0,1.66 1.33,3 2.99,3 0.22,0 0.44,-0.03 0.65,-0.08l1.66,1.66c-0.71,0.33 -1.5,0.52 -2.31,0.52 -2.76,0 -5.3,-2.1 -5.3,-5.1L5,11c0,3.41 2.72,6.23 6,6.72L11,21h2v-3.28c0.91,-0.13 1.77,-0.45 2.54,-0.9L19.73,21 21,19.73 4.27,3z"/>
</vector>
```

`android/app/src/main/res/drawable/ic_pip_hangup.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,9c-1.6,0 -3.15,0.25 -4.6,0.72v3.1c0,0.39 -0.23,0.74 -0.56,0.9 -0.98,0.49 -1.87,1.12 -2.66,1.85 -0.18,0.18 -0.43,0.28 -0.7,0.28 -0.28,0 -0.53,-0.11 -0.71,-0.29L0.29,13.08c-0.18,-0.17 -0.29,-0.42 -0.29,-0.7 0,-0.28 0.11,-0.53 0.29,-0.71C3.34,8.78 7.46,7 12,7s8.66,1.78 11.71,4.67c0.18,0.18 0.29,0.43 0.29,0.71 0,0.28 -0.11,0.53 -0.29,0.71l-2.48,2.48c-0.18,0.18 -0.43,0.29 -0.71,0.29 -0.27,0 -0.52,-0.11 -0.7,-0.28 -0.79,-0.74 -1.69,-1.36 -2.67,-1.85 -0.33,-0.16 -0.56,-0.5 -0.56,-0.9v-3.1C15.15,9.25 13.6,9 12,9z"/>
</vector>
```

In `../THIRD-PARTY-NOTICES.md`, add a subsection at the end of "## Bundled in the repository, and therefore in every binary" (just before "## Not bundled in the repository, but linked into a build"):

```markdown
### Android picture-in-picture icons — `mobile/android/app/src/main/res/drawable/ic_pip_*.xml`

The mic, mic-off and call-end glyphs are the path data of Google's Material Icons
(<https://github.com/google/material-design-icons>), licensed under the Apache License
2.0 (<https://www.apache.org/licenses/LICENSE-2.0>). Only the fill colour was changed.
```

- [ ] **Step 8: Run the guard tests and compile the Kotlin**

Run: `npx jest test/nativeModules.test.ts`
Expected: PASS (all, including the four new ones).

Run: `cd android && source env.sh && ./gradlew :app:compileDebugKotlin --console=plain -q; echo exit=$?; cd ..`
Expected: `exit=0`. If `ContextCompat.RECEIVER_NOT_EXPORTED` doesn't resolve, the androidx.core on the classpath is older than 1.9: check with `./gradlew :app:dependencies --configuration releaseRuntimeClasspath | grep androidx.core:core:` and report rather than adding a dependency.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/java/net/swiftirc/coyote/Pip.kt android/app/src/main/java/net/swiftirc/coyote/CoyotePipModule.kt \
  android/app/src/main/java/net/swiftirc/coyote/CoyotePipPackage.kt android/app/src/main/java/net/swiftirc/coyote/MainActivity.kt \
  android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt android/app/src/main/AndroidManifest.xml \
  android/app/src/main/res/drawable/ic_pip_mic.xml android/app/src/main/res/drawable/ic_pip_mic_off.xml \
  android/app/src/main/res/drawable/ic_pip_hangup.xml ../THIRD-PARTY-NOTICES.md test/nativeModules.test.ts
git commit -m "feat(android): picture-in-picture for a live call (CoyotePip)"
```

---

### Task 4: `PipView` and the Call screen

**Files:**
- Create: `src/ui/components/PipView.tsx`
- Modify: `src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `pipTile`, `pipOthers`, `pipParams`, `PIP_OFF`, `runPipAction`, `PipTile` (Task 1); `setPip`, `watchPip`, `watchPipActions` (Task 2); `Tile`, `ScreenTile`, `Avatar` components (existing; props shown in their files).
- Produces: `PipView({ tile, others, self, volumes, dataSaver })`.

There are no component tests in this project (jest only runs `test/**/*.test.ts`); the logic is covered by Task 1. This task is checked by typecheck, lint, the full suite, and the manual tests in Task 5.

- [ ] **Step 1: Create `src/ui/components/PipView.tsx`**

```tsx
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { PipTile } from "../../core/pip";
import type { StreamLike } from "../../core/types";
import { colors } from "../theme";
import { Avatar } from "./Avatar";
import { ScreenTile } from "./ScreenTile";
import { Tile } from "./Tile";

const noop = () => {};

// The Android picture-in-picture window: one tile filling it, plus how many others are
// in the call. Nothing else is mounted, so no hidden video surface can bleed through.
export function PipView({ tile, others, self, volumes, dataSaver }: {
  tile: PipTile;
  others: number;
  self: { name: string; stream: StreamLike | null };
  volumes: Record<string, number>;
  dataSaver: boolean;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={styles.root}>
      {tile.kind === "screen" ? (
        <ScreenTile p={tile.p} width={width} height={height} onOpen={noop} />
      ) : tile.kind === "person" ? (
        <Tile p={tile.p} width={width} height={height} volume={volumes[tile.p.id] ?? 1} dataSaver={dataSaver} onLongPress={noop} />
      ) : self.stream?.toURL ? (
        <RTCView streamURL={self.stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror />
      ) : (
        <View style={styles.self}>
          <Avatar name={self.name} gravatar="" size={Math.min(width, height) * 0.4} />
        </View>
      )}
      {others > 0 ? <Text style={styles.others}>+{others}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  self: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  others: {
    position: "absolute", top: 6, right: 6, color: colors.text, fontSize: 12, fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden",
  },
});
```

- [ ] **Step 2: Wire it into `src/ui/screens/Call.tsx`**

Add imports (beside the other `core` / `native` / component imports):

```tsx
import { PIP_OFF, pipOthers, pipParams, pipTile, runPipAction } from "../../core/pip";
import { setPip, watchPip, watchPipActions } from "../../native/pip";
import { PipView } from "../components/PipView";
```

After `const hasState = !!state;` add:

```tsx
  // Android picture-in-picture: allowed while the call is up. Entering it closes
  // everything over the grid, since the window shows a single tile.
  const [inPip, setInPip] = useState(false);
  useEffect(() => watchPip((v) => {
    setInPip(v);
    if (!v) return;
    setSheet(null);
    setViewing(null);
    setVolumeFor(null);
    call()?.chat.setOpen(false);
  }), [call]);
  const pip = pipParams(state);
  useEffect(() => {
    setPip({ enabled: pip.enabled, micOn: pip.micOn, aspect: pip.aspect });
  }, [pip.enabled, pip.micOn, pip.aspect]);
  useEffect(() => () => setPip(PIP_OFF), []);
  // The PiP mic button flips the mic as it is now, not as it was when subscribed.
  const micRef = useRef(false);
  micRef.current = !!state?.mic;
  useEffect(() => watchPipActions((a) => runPipAction(a, {
    toggleMic: () => { call()?.setMic(!micRef.current).catch(warn("mic")); },
    hangup: leave,
  })), [call, leave]);
```

After the `if (!state) { … }` block (before `const people = state.participants;`) add:

```tsx
  if (inPip) {
    const t = pipTile(state.participants);
    return (
      <PipView
        tile={t}
        others={pipOthers(t, state.participants)}
        self={{ name: state.name, stream: state.camera && !hideSelf ? state.localStream : null }}
        volumes={volumes}
        dataSaver={state.dataSaver}
      />
    );
  }
```

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npx jest`
Expected: no errors; all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/PipView.tsx src/ui/screens/Call.tsx
git commit -m "feat(mobile): show one tile in the Android picture-in-picture window"
```

---

### Task 5: Manual tests, version 1.8.0, Android build

**Files:**
- Modify: `MANUAL-TEST.md`
- Modify: `android/app/build.gradle` (versionCode / versionName)
- Modify: `ios/Coyote.xcodeproj/project.pbxproj` (4 × `CURRENT_PROJECT_VERSION`, 4 × `MARKETING_VERSION`)

- [ ] **Step 1: Append to `MANUAL-TEST.md`**

```markdown

## Picture-in-picture (1.8.0, Android)

87. **Auto-enter (Android 12+).** In a video call, press Home and then swipe up from
    another app: the call shrinks smoothly into a floating window each time. The others
    still see your camera and hear you.
88. **Older Android (8–11, if a device is available).** Press Home in a call: it enters
    PiP.
89. **PiP buttons.** Tap the window: Mute shows a mic icon; tap it: others stop hearing
    you and it turns into Unmute (mic-off icon); tap again: back. Muting from the call
    screen before going to PiP shows Unmute. Hang up ends the call.
90. **Hang up / kicked in PiP.** Hang up from the window, and (in another call) get kicked
    by an op while in PiP: the window expands to the app, showing Home (with the
    "removed" message for the kick).
91. **Swipe the window away.** You stay in the call (notification shown); others see your
    camera go off. Open the app: camera back on, full call screen.
92. **Screenshare in PiP.** Someone shares: the window shows the share in 16:9 and "+N";
    when they stop, it switches to the first person in 3:4.
93. **Sheets and the viewer.** Open the chat sheet with the keyboard up, press Home: the
    window shows the tile. Expand: the call screen with nothing open. Same with the
    full-screen screen viewer open.
94. **Alone.** Alone in the room, press Home: the window shows your self view (or your
    initials with the camera off or Hide self on).
95. **Expand.** Tap the window, then expand: back to the full call screen, camera still
    on, no duplicate app window in Recents.
96. **Not outside calls.** Press Home on Home, on PreJoin and while "Connecting…": no PiP.
97. **PiP off in settings.** Settings → Apps → Coyote → Picture-in-picture off: Home in a
    call behaves as before (camera off in the background, back on return). Turn it on again.
98. **Incoming phone call in PiP.** Answer a phone call while the window is up: nothing
    crashes; the call carries on afterwards.
```

- [ ] **Step 2: Bump the version** — from `mobile/`:

```bash
sed -i 's/versionCode 12$/versionCode 13/; s/versionName "1.7.1"/versionName "1.8.0"/' android/app/build.gradle
sed -i 's/CURRENT_PROJECT_VERSION = 12;/CURRENT_PROJECT_VERSION = 13;/; s/MARKETING_VERSION = 1.7.1;/MARKETING_VERSION = 1.8.0;/' ios/Coyote.xcodeproj/project.pbxproj
grep -n "versionCode\|versionName" android/app/build.gradle
grep -c "CURRENT_PROJECT_VERSION = 13;\|MARKETING_VERSION = 1.8.0;" ios/Coyote.xcodeproj/project.pbxproj
```

Expected: `versionCode 13`, `versionName "1.8.0"`, and a count of `8`.

- [ ] **Step 3: Full checks and a release R8 build**

Run: `npm run typecheck && npm run lint && npx jest`
Expected: all pass.

Run: `cd android && source env.sh && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain -q 2>&1 | tail -5; cd ..`
Expected: `:app:minifyReleaseWithR8` succeeds; the only failure allowed is `:app:packageRelease` with `SigningConfig "release" is missing required property "storeFile"` (no upload key on this machine). Then check R8 kept the module: `grep "^net.swiftirc.coyote.CoyotePipModule -> net.swiftirc.coyote.CoyotePipModule:" android/app/build/outputs/mapping/release/mapping.txt` prints one line.

- [ ] **Step 4: Commit**

```bash
git add MANUAL-TEST.md android/app/build.gradle ios/Coyote.xcodeproj/project.pbxproj
git commit -m "chore(mobile): 1.8.0 (build 13), manual tests for picture-in-picture"
```
