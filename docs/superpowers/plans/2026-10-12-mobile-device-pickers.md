# Microphone and Camera Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile call's audio button opens one devices sheet (Output, Microphone, Camera) on iOS and Android.

**Architecture:** Pure logic in `core/audioRoutes.ts` (Android mics derived from Telecom outputs, mic→output mapping, pending by target) and `core/cameras.ts` (camera list and names). The Call controller gains `cameraId` state and `selectCamera`. iOS's `CoyoteAudioRoute` adds inputs and `selectInput` (`setPreferredInput`). `AudioRouteSheet` becomes `DevicesSheet`; on iOS the system route picker moves from the control bar into the sheet's Output row. No Android native code.

**Tech Stack:** React Native 0.87 (TypeScript, Jest), react-native-webrtc 124 (`enumerateDevices`, `getUserMedia` `deviceId`), Swift / ObjC (iOS, compiled on the Mac).

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-device-pickers-design.md`

## Global Constraints

- Android: the microphone follows the output; no new Android native code, no `AudioDeviceModule`.
- iOS `CoyoteAudioRoute` never calls `setCategory`, `setMode`, `setActive` or `overrideOutputAudioPort` (existing guard test).
- No new third-party dependency.
- No persistence of device choices across calls.
- The sheet stays open after a pick.
- Notices: "Couldn't switch to <name>." (output/mic), "Could not switch camera." (camera).
- Button accessibility label: "Audio and video devices. Output: <name>".
- Release: 1.7.0, iOS build 11 (all four `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION` places in `project.pbxproj`), Android `versionCode 11` / `versionName "1.7.0"`, as the last step.
- Commits: no Co-Authored-By trailer. Work on a feature branch, merge to master locally when done (user's standing rule); never push.
- All commands run from `mobile/` unless stated.

## Review Focus

1. iOS: `CoyoteRoutePicker` inside the sheet (an `Animated.View`, not a Modal) must still open Apple's picker and be reachable by VoiceOver — only checkable on device (MANUAL-TEST 76).
2. Android mic pick while Telecom has reported no outputs yet: `outputForInput` returns null, the pending switch times out after 5 s with the notice — acceptable, must not hang "…" forever (covered by `pendingOutcome` wait/timeout).
3. Camera pick while the app backgrounds: backgrounding turns the camera off (bumps `camGen`), so the in-flight pick must stop its track (covered by the stale-pick test's guard; same path as flip).
4. Camera pick with a background effect on: the new track must go through `refreshLocalStream` → `background.setTrack` exactly as flip does (shared `swapCamera`).
5. Android camera ids: `enumerateDevices` ids are camera indices and the track's `getSettings().deviceId` reports the same index string (react-native-webrtc `CameraCaptureController.currentDeviceId`), so ✓ matches after flip.

---

### Task 1: Microphones in `core/audioRoutes.ts`

**Files:**
- Modify: `src/core/audioRoutes.ts`
- Test: `test/audioRoutes.test.ts`

**Interfaces:**
- Produces: `InputKind`, `Input`, `Routes { outputs; selected; inputs: Input[]; input: string }`, `NO_ROUTES`, `androidInputs(r: Routes): Routes`, `outputForInput(r: Routes, inputId: string, video: boolean): string | null`, `sortInputs(inputs: Input[]): Input[]`, `Pending { id; name; at; target: "output" | "input" }`, `pickInput(r: Routes, id: string, now: number): Pending | null`. `pickOutput` now returns `target: "output"`.

- [ ] **Step 1: Write the failing tests** — append to `test/audioRoutes.test.ts`, add the new names to its import (`androidInputs, outputForInput, pickInput, sortInputs, type Input`), and change the `routes` fixture to `{ outputs: [buds, speaker, car, phone], selected: "speaker", inputs: [], input: "" }`:

```ts
const wired = { id: "wired", kind: "wired" as const, name: "Headset" };
const PHONE_MIC = { id: "builtin", kind: "builtin", name: "Phone microphone" };

test("parseRoutes keeps well-formed inputs; a payload without inputs has none", () => {
  const mic = { id: "m1", kind: "builtin", name: "iPhone Microphone" };
  expect(parseRoutes({
    outputs: [speaker], selected: "speaker",
    inputs: [mic, { id: "", kind: "usb", name: "x" }, { id: "m2", kind: "hdmi", name: "y" }, null], input: "m1",
  })).toEqual({ outputs: [speaker], selected: "speaker", inputs: [mic], input: "m1" });
  expect(parseRoutes({ outputs: [speaker], selected: "speaker" })).toEqual({ outputs: [speaker], selected: "speaker", inputs: [], input: "" });
});

test("androidInputs: phone mic always, headset mic with a wired output, one per Bluetooth device; follows the output", () => {
  const r = androidInputs({ outputs: [phone, speaker, wired, buds, car], selected: "bt:AA", inputs: [], input: "" });
  expect(r.inputs).toEqual([
    PHONE_MIC,
    { id: "wired", kind: "wired", name: "Headset microphone" },
    { id: "bt:AA", kind: "bluetooth", name: "Galaxy Buds3 Pro" },
    { id: "bt:BB", kind: "bluetooth", name: "Car" },
  ]);
  expect(r.input).toBe("bt:AA");
  expect(androidInputs({ ...r, selected: "wired" }).input).toBe("wired");
  expect(androidInputs({ ...r, selected: "speaker" }).input).toBe("builtin");
  expect(androidInputs({ ...r, selected: "earpiece" }).input).toBe("builtin");
  expect(androidInputs(NO_ROUTES)).toEqual({ ...NO_ROUTES, inputs: [PHONE_MIC], input: "" });
});

test("outputForInput: Bluetooth and headset mics select their output; the phone mic leaves a headset by the starting rule", () => {
  const r = androidInputs({ outputs: [phone, speaker, wired, buds], selected: "bt:AA", inputs: [], input: "" });
  expect(outputForInput(r, "bt:AA", false)).toBeNull();
  expect(outputForInput(r, "wired", false)).toBe("wired");
  expect(outputForInput(r, "builtin", false)).toBe("earpiece");
  expect(outputForInput(r, "builtin", true)).toBe("speaker");
  const noEarpiece = androidInputs({ outputs: [speaker, buds], selected: "bt:AA", inputs: [], input: "" });
  expect(outputForInput(noEarpiece, "builtin", false)).toBe("speaker");
  const onSpeaker = androidInputs({ ...r, selected: "speaker" });
  expect(outputForInput(onSpeaker, "builtin", false)).toBeNull();
  expect(outputForInput(onSpeaker, "bt:AA", false)).toBe("bt:AA");
  expect(outputForInput(onSpeaker, "bt:ZZ", false)).toBeNull();
});

test("sortInputs: built-in, wired, USB, then Bluetooth by name; input untouched", () => {
  const ins: Input[] = [
    { id: "b2", kind: "bluetooth", name: "Zeta" }, { id: "u", kind: "usb", name: "USB Mic" },
    { id: "b1", kind: "bluetooth", name: "AirPods" }, { id: "w", kind: "wired", name: "Headset Mic" },
    { id: "m", kind: "builtin", name: "iPhone Microphone" },
  ];
  expect(sortInputs(ins).map((i) => i.id)).toEqual(["m", "w", "u", "b1", "b2"]);
  expect(ins[0].id).toBe("b2");
});

test("pickInput and pendingOutcome follow the input for a mic switch", () => {
  const r = androidInputs({ outputs: [phone, speaker, buds], selected: "speaker", inputs: [], input: "" });
  expect(pickInput(r, "builtin", 10)).toBeNull();
  expect(pickInput(r, "nope", 10)).toBeNull();
  const p = pickInput(r, "bt:AA", 10)!;
  expect(p).toEqual({ id: "bt:AA", name: "Galaxy Buds3 Pro", at: 10, target: "input" });
  expect(pendingOutcome(p, r, 20)).toEqual({ kind: "wait", ms: SWITCH_TIMEOUT_MS - 10 });
  expect(pendingOutcome(p, androidInputs({ ...r, selected: "bt:AA" }), 20)).toEqual({ kind: "done" });
  expect(pendingOutcome(p, androidInputs({ ...r, outputs: [phone, speaker] }), 20)).toEqual({ kind: "failed" });
});
```

Existing expectations that compare whole `Routes` objects (`parseRoutes`, `fromInCallManager`) gain `inputs: [], input: ""`; existing `pickOutput` / `Pending` literals gain `target: "output"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/audioRoutes.test.ts`
Expected: FAIL — `androidInputs` / `outputForInput` / `pickInput` / `sortInputs` are not exported.

- [ ] **Step 3: Implement** in `src/core/audioRoutes.ts`. Update the header comment to mention microphones. Add/replace:

```ts
// Microphones. Android's follow the output (Telecom ties them together), so they are
// derived from it; iOS reports its own.
export type InputKind = "builtin" | "wired" | "bluetooth" | "usb";

export interface Input {
  id: string;
  kind: InputKind;
  name: string;
}

export interface Routes {
  outputs: Output[];
  selected: string; // an Output id; "" when unknown
  inputs: Input[];
  input: string; // an Input id; "" when unknown
}

export const NO_ROUTES: Routes = { outputs: [], selected: "", inputs: [], input: "" };

const INPUT_KINDS: readonly string[] = ["builtin", "wired", "bluetooth", "usb"];
```

`parseRoutes` (replace body):

```ts
export function parseRoutes(raw: unknown): Routes {
  const r = raw as { outputs?: unknown; selected?: unknown; inputs?: unknown; input?: unknown } | null | undefined;
  const outputs: Output[] = [];
  for (const o of wellFormed(r?.outputs, KINDS)) outputs.push({ id: o.id, kind: o.kind as OutputKind, name: o.name });
  const inputs: Input[] = [];
  for (const i of wellFormed(r?.inputs, INPUT_KINDS)) inputs.push({ id: i.id, kind: i.kind as InputKind, name: i.name });
  return {
    outputs,
    selected: typeof r?.selected === "string" ? r.selected : "",
    inputs,
    input: typeof r?.input === "string" ? r.input : "",
  };
}

function wellFormed(list: unknown, kinds: readonly string[]): Array<{ id: string; kind: string; name: string }> {
  const out: Array<{ id: string; kind: string; name: string }> = [];
  if (!Array.isArray(list)) return out;
  for (const o of list as Array<Record<string, unknown> | null>) {
    if (o && typeof o.id === "string" && o.id !== "" && typeof o.name === "string" && typeof o.kind === "string" && kinds.includes(o.kind)) {
      out.push({ id: o.id, kind: o.kind, name: o.name });
    }
  }
  return out;
}
```

`fromInCallManager` returns `{ outputs, selected: icmKind(e?.selectedAudioDevice) ?? "", inputs: [], input: "" }`.

New functions (after `sortOutputs`):

```ts
const INPUT_ORDER: InputKind[] = ["builtin", "wired", "usb", "bluetooth"];

export function sortInputs(inputs: Input[]): Input[] {
  return [...inputs].sort((a, b) => INPUT_ORDER.indexOf(a.kind) - INPUT_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

const PHONE_MIC: Input = { id: "builtin", kind: "builtin", name: "Phone microphone" };

// Android: the mic each output brings — the built-in mic for earpiece and speaker,
// the headset's for wired, each Bluetooth device's own.
export function androidInputs(r: Routes): Routes {
  const inputs: Input[] = [PHONE_MIC];
  if (r.outputs.some((o) => o.kind === "wired")) inputs.push({ id: "wired", kind: "wired", name: "Headset microphone" });
  for (const o of r.outputs) if (o.kind === "bluetooth") inputs.push({ id: o.id, kind: "bluetooth", name: o.name });
  const sel = selectedOutput(r);
  const input = !sel ? "" : sel.kind === "bluetooth" ? sel.id : sel.kind === "wired" ? "wired" : "builtin";
  return { ...r, inputs, input };
}

// Android: the output to select for a mic pick, or null when nothing changes. The
// phone mic leaves a headset for the earpiece (audio-only) or the speaker (video).
export function outputForInput(r: Routes, inputId: string, video: boolean): string | null {
  if (inputId === r.input) return null;
  const first = (k: OutputKind) => r.outputs.find((o) => o.kind === k)?.id ?? null;
  if (inputId === "builtin") {
    const sel = selectedOutput(r);
    if (sel && (sel.kind === "earpiece" || sel.kind === "speaker")) return null;
    return (video ? null : first("earpiece")) ?? first("speaker");
  }
  if (inputId === "wired") return first("wired");
  return r.outputs.some((o) => o.kind === "bluetooth" && o.id === inputId) ? inputId : null;
}
```

Pending (replace interface, `pendingOutcome`, `pickOutput`; add `pickInput`):

```ts
export interface Pending {
  id: string;
  name: string;
  at: number; // ms; 0 marks a switch the platform already rejected
  target: "output" | "input";
}

export function pendingOutcome(p: Pending, r: Routes, now: number): PendingOutcome {
  const current = p.target === "input" ? r.input : r.selected;
  const listed = p.target === "input" ? r.inputs.some((i) => i.id === p.id) : r.outputs.some((o) => o.id === p.id);
  if (current === p.id) return { kind: "done" };
  if (p.at === 0 || !listed) return { kind: "failed" };
  const ms = p.at + SWITCH_TIMEOUT_MS - now;
  return ms <= 0 ? { kind: "failed" } : { kind: "wait", ms };
}

export function pickOutput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.selected) return null;
  const o = r.outputs.find((x) => x.id === id);
  return o ? { id, name: o.name, at: now, target: "output" } : null;
}

export function pickInput(r: Routes, id: string, now: number): Pending | null {
  if (id === r.input) return null;
  const i = r.inputs.find((x) => x.id === id);
  return i ? { id, name: i.name, at: now, target: "input" } : null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest test/audioRoutes.test.ts`
Expected: PASS. (Other files that build `Routes` literals are fixed by `tsc` in Task 6; Jest doesn't typecheck.)

- [ ] **Step 5: Commit**

```bash
git add src/core/audioRoutes.ts test/audioRoutes.test.ts
git commit -m "feat(mobile): microphones in the audio routes model"
```

---

### Task 2: Camera list in `core/cameras.ts`

**Files:**
- Create: `src/core/cameras.ts`
- Test: `test/cameras.test.ts`

**Interfaces:**
- Consumes: `Facing` type from `src/core/call.ts`.
- Produces: `CameraFacing = "front" | "back" | "other"`, `Camera { id; facing: CameraFacing; name }`, `parseCameras(devices: unknown): Camera[]`, `cameraFacing(f: CameraFacing): Facing`.

Note: the spec's `parseCameras(devices, platform)` has no `platform` parameter here — the rule "keep a label unless it is empty or only digits" gives iOS's names and Android's generated names on both platforms (iOS labels are never digits).

- [ ] **Step 1: Write the failing test** `test/cameras.test.ts`:

```ts
import { cameraFacing, parseCameras } from "../src/core/cameras";

test("parseCameras: Android's numbered cameras get names by facing, numbered when several", () => {
  expect(parseCameras([
    { deviceId: "0", kind: "videoinput", label: "0", facing: "environment" },
    { deviceId: "1", kind: "videoinput", label: "1", facing: "front" },
    { deviceId: "2", kind: "videoinput", label: "2", facing: "environment" },
    { deviceId: "audio-1", kind: "audioinput", label: "Audio" },
  ])).toEqual([
    { id: "1", facing: "front", name: "Front camera" },
    { id: "0", facing: "back", name: "Back camera" },
    { id: "2", facing: "back", name: "Back camera 2" },
  ]);
});

test("parseCameras: iOS names kept; front, then back, then others, platform order within each", () => {
  expect(parseCameras([
    { deviceId: "B1", kind: "videoinput", label: "Back Camera", facing: "environment" },
    { deviceId: "X", kind: "videoinput", label: "USB Camera", facing: "unknown" },
    { deviceId: "B2", kind: "videoinput", label: "Back Ultra Wide Camera", facing: "environment" },
    { deviceId: "F", kind: "videoinput", label: "Front Camera", facing: "front" },
  ]).map((c) => [c.id, c.facing, c.name])).toEqual([
    ["F", "front", "Front Camera"], ["B1", "back", "Back Camera"], ["B2", "back", "Back Ultra Wide Camera"], ["X", "other", "USB Camera"],
  ]);
});

test("parseCameras survives garbage", () => {
  expect(parseCameras(null)).toEqual([]);
  expect(parseCameras([null, 3, { kind: "videoinput" }, { kind: "videoinput", deviceId: "" }, { kind: "videoinput", deviceId: "7", facing: "user" }]))
    .toEqual([{ id: "7", facing: "front", name: "Front camera" }]);
});

test("cameraFacing maps to the call's facing", () => {
  expect(cameraFacing("front")).toBe("user");
  expect(cameraFacing("back")).toBe("environment");
  expect(cameraFacing("other")).toBe("environment");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest test/cameras.test.ts`
Expected: FAIL — cannot find module `../src/core/cameras`.

- [ ] **Step 3: Implement** `src/core/cameras.ts`:

```ts
// The cameras the devices sheet lists, from react-native-webrtc's enumerateDevices.
// iOS names them ("Back Ultra Wide Camera"); Android only numbers them, so those get
// "Front camera" / "Back camera", numbered when a facing has several.
import type { Facing } from "./call";

export type CameraFacing = "front" | "back" | "other";

export interface Camera {
  id: string;
  facing: CameraFacing;
  name: string;
}

const ORDER: CameraFacing[] = ["front", "back", "other"];
const BASE: Record<CameraFacing, string> = { front: "Front camera", back: "Back camera", other: "Camera" };

function facingOf(f: unknown): CameraFacing {
  if (f === "front" || f === "user") return "front";
  if (f === "environment" || f === "back") return "back";
  return "other";
}

export function parseCameras(devices: unknown): Camera[] {
  const found: Array<{ id: string; facing: CameraFacing; label: string }> = [];
  for (const d of Array.isArray(devices) ? devices : []) {
    const r = d as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || r.kind !== "videoinput" || typeof r.deviceId !== "string" || r.deviceId === "") continue;
    found.push({ id: r.deviceId, facing: facingOf(r.facing), label: typeof r.label === "string" ? r.label.trim() : "" });
  }
  found.sort((a, b) => ORDER.indexOf(a.facing) - ORDER.indexOf(b.facing)); // stable: platform order within a facing
  const counts: Partial<Record<CameraFacing, number>> = {};
  return found.map((c) => {
    if (c.label && !/^\d+$/.test(c.label)) return { id: c.id, facing: c.facing, name: c.label };
    const n = (counts[c.facing] = (counts[c.facing] ?? 0) + 1);
    return { id: c.id, facing: c.facing, name: n === 1 ? BASE[c.facing] : `${BASE[c.facing]} ${n}` };
  });
}

export function cameraFacing(f: CameraFacing): Facing {
  return f === "front" ? "user" : "environment";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest test/cameras.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/cameras.ts test/cameras.test.ts
git commit -m "feat(mobile): camera list with names for the devices sheet"
```

---

### Task 3: `selectCamera` in the Call controller

**Files:**
- Modify: `src/core/call.ts`, `src/core/types.ts`, `test/fakes.ts`
- Test: `test/call.test.ts`

**Interfaces:**
- Produces: `CameraChoice { facing: Facing; deviceId?: string }`; `MediaPort.getCamera(choice: CameraChoice)`; `CallState.cameraId: string | null`; `Call.selectCamera(id: string, facing: Facing): Promise<void>`; `TrackLike.getSettings?(): { height?: number; width?: number; deviceId?: string }`.

- [ ] **Step 1: Write the failing tests.**

In `test/fakes.ts`, `FakeTrack` gains a public `deviceId?: string;` field and `getSettings()` returns `{ height: this.height, width: this.width, deviceId: this.deviceId }`.

In `test/call.test.ts` `setup`: add `missing: new Set<string>()` to `ctl`, a `const camChoices: CameraChoice[] = [];` (import `type CameraChoice` from `../src/core/call`), return `camChoices` from `setup`, and replace the fake `getCamera`:

```ts
      getCamera: (choice) => {
        camChoices.push(choice);
        if (opts.camDenied || (choice.deviceId && ctl.missing.has(choice.deviceId))) return Promise.resolve(null);
        const t = new FakeTrack("video");
        t.deviceId = choice.deviceId ?? (choice.facing === "user" ? "cam-front" : "cam-back");
        cams.push(t);
        return ctl.deferCam ? new Promise<FakeTrack>((r) => ctl.camWaits.push(() => r(t))) : Promise.resolve(t);
      },
```

Make sure `inCall` passes `camChoices` through (it spreads/returns `setup`'s result; add it if `inCall` lists fields). Append the tests:

```ts
test("selectCamera swaps the live camera to that device and the next turn-on reuses it", async () => {
  const { call, peers, cams, camChoices } = await inCall();
  expect(call.getState().cameraId).toBe("cam-front");
  await call.selectCamera("wide2", "environment");
  expect(camChoices.at(-1)).toEqual({ facing: "environment", deviceId: "wide2" });
  expect(call.getState()).toMatchObject({ facing: "environment", cameraId: "wide2" });
  expect(peers[0].replaced.at(-1)).toEqual(["camera", cams[1]]);
  expect(cams[0].stopped).toBe(true);
  await call.setCamera(false);
  await call.setCamera(true);
  expect(camChoices.at(-1)).toEqual({ facing: "environment", deviceId: "wide2" });
});

test("selectCamera on the current camera does nothing", async () => {
  const { call, cams } = await inCall();
  await call.selectCamera("cam-front", "user");
  expect(cams).toHaveLength(1);
});

test("selectCamera with the camera off is used by the next turn-on", async () => {
  const { call, cams, camChoices } = await inCall({ camera: false });
  await call.selectCamera("ext", "environment");
  expect(cams).toHaveLength(0);
  expect(call.getState()).toMatchObject({ camera: false, facing: "environment", cameraId: "ext" });
  await call.setCamera(true);
  expect(camChoices.at(-1)).toEqual({ facing: "environment", deviceId: "ext" });
  expect(call.getState()).toMatchObject({ camera: true, cameraId: "ext" });
});

test("a chosen camera that's gone falls back to its facing on turn-on", async () => {
  const { call, ctl, camChoices } = await inCall({ camera: false });
  await call.selectCamera("ext", "environment");
  ctl.missing.add("ext");
  await call.setCamera(true);
  expect(camChoices.slice(-2)).toEqual([{ facing: "environment", deviceId: "ext" }, { facing: "environment" }]);
  expect(call.getState()).toMatchObject({ camera: true, cameraId: "cam-back" });
});

test("a camera that fails to open keeps the old one and shows the notice", async () => {
  const { call, ctl, cams, notices } = await inCall();
  ctl.missing.add("tele");
  await call.selectCamera("tele", "environment");
  expect(notices).toContain("Could not switch camera.");
  expect(call.getState()).toMatchObject({ camera: true, facing: "user", cameraId: "cam-front" });
  expect(cams[0].stopped).toBe(false);
});

test("of two quick camera picks the newer wins; the stale track is stopped", async () => {
  const { call, ctl, cams } = await inCall();
  ctl.deferCam = true;
  const a = call.selectCamera("a", "environment");
  const b = call.selectCamera("b", "environment");
  ctl.camWaits[0]();
  ctl.camWaits[1]();
  await a;
  await b;
  expect(cams[1].stopped).toBe(true);
  expect(call.getState().cameraId).toBe("b");
});

test("flip after a pick goes by facing and forgets the pick", async () => {
  const { call, camChoices } = await inCall();
  await call.selectCamera("wide2", "environment");
  await call.flipCamera();
  expect(camChoices.at(-1)).toEqual({ facing: "user" });
  expect(call.getState()).toMatchObject({ facing: "user", cameraId: "cam-front" });
  await call.setCamera(false);
  await call.setCamera(true);
  expect(camChoices.at(-1)?.deviceId).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/call.test.ts`
Expected: the new tests FAIL (`call.selectCamera is not a function`, `cameraId` undefined); existing tests still pass.

- [ ] **Step 3: Implement.**

`src/core/types.ts`: `getSettings?(): { height?: number; width?: number; deviceId?: string };`

`src/core/call.ts`:

```ts
export type Facing = "user" | "environment";
// A camera by facing, or a specific one (devices sheet); deviceId wins when given.
export interface CameraChoice {
  facing: Facing;
  deviceId?: string;
}
```

`MediaPort.getCamera(choice: CameraChoice): Promise<TrackLike | null>;`

`CallState` gains `cameraId: string | null; // the camera in use, or picked for the next turn-on` (after `facing`); the initial state gains `cameraId: null`.

New field after `camGen`:

```ts
  // A camera picked in the devices sheet; the next turn-on asks for it. Flip clears it.
  private cameraPick: string | null = null;
```

`join`: `this.camTrack = await this.deps.media.getCamera({ facing: "user" });` and `this.update({ mic, camera: !!this.camTrack, cameraId: this.cameraIdOf(this.camTrack) });`.

`setCamera(true)` acquisition becomes:

```ts
    let t: TrackLike | null;
    const choice: CameraChoice = { facing: this.state.facing, deviceId: this.cameraPick ?? undefined };
    this.cameraOns++;
    try {
      t = await this.deps.media.getCamera(choice);
      // The picked camera is gone (an iPad's USB camera unplugged): fall back to its facing.
      if (!t && choice.deviceId && gen === this.camGen && this.isLive()) t = await this.deps.media.getCamera({ facing: choice.facing });
    } finally {
      this.cameraOns--;
    }
```

and its success update becomes `this.update({ camera: true, cameraId: this.cameraIdOf(t) ?? choice.deviceId ?? null });`.

Replace `flipCamera` and add `selectCamera` / `swapCamera` / `cameraIdOf`:

```ts
  async flipCamera(): Promise<void> {
    if (!this.isLive() || !this.ready) return;
    const facing: Facing = this.state.facing === "user" ? "environment" : "user";
    this.cameraPick = null;
    if (!this.state.camera) {
      this.update({ facing, cameraId: null });
      return;
    }
    await this.swapCamera({ facing });
  }

  // A camera picked in the devices sheet: swapped in live, or used by the next turn-on.
  async selectCamera(id: string, facing: Facing): Promise<void> {
    if (!this.isLive() || !this.ready) return;
    if (!this.state.camera) {
      this.cameraPick = id;
      this.update({ facing, cameraId: id });
      return;
    }
    if (id === this.state.cameraId) return;
    if (await this.swapCamera({ facing, deviceId: id })) this.cameraPick = id;
  }

  // Replaces the live camera track; false when superseded or the camera won't open.
  private async swapCamera(choice: CameraChoice): Promise<boolean> {
    const gen = ++this.camGen;
    const t = await this.deps.media.getCamera(choice);
    if (gen !== this.camGen || !this.isLive() || !this.state.camera) {
      t?.stop(); // camera turned off, superseded, or the call ended while switching
      return false;
    }
    if (!t) {
      this.events.notice("Could not switch camera.");
      return false;
    }
    const old = this.camTrack;
    this.camTrack = t;
    this.update({ facing: choice.facing, cameraId: this.cameraIdOf(t) ?? choice.deviceId ?? null });
    this.refreshLocalStream();
    if (this.peer) await this.peer.replaceTrack("camera", t);
    old?.stop();
    return true;
  }

  private cameraIdOf(t: TrackLike | null): string | null {
    return t?.getSettings?.().deviceId ?? null;
  }
```

Any test asserting a whole `CallState` with `toEqual` gains `cameraId`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest test/call.test.ts`
Expected: PASS, all tests including the existing flip tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/call.ts src/core/types.ts test/fakes.ts test/call.test.ts
git commit -m "feat(mobile): pick a specific camera during a call"
```

---

### Task 4: Native glue — `selectInput`, Android mics, camera list

**Files:**
- Modify: `src/native/audioRoute.ts`, `src/native/webrtc.ts`
- Test: `test/audioRoute.native.test.ts`

**Interfaces:**
- Consumes: Task 1 (`androidInputs`, `outputForInput`, `Routes`), Task 2 (`parseCameras`, `Camera`), Task 3 (`CameraChoice`).
- Produces: `selectInput(routes: Routes, id: string, video: boolean): Promise<void>`; `watchRoutes` delivers Android payloads with derived inputs; `listCameras(): Promise<Camera[]>`; `media.getCamera(choice: CameraChoice)`.

- [ ] **Step 1: Write the failing tests** — in `test/audioRoute.native.test.ts` add `selectInput: jest.fn(async () => undefined),` to the `native` mock, import `{ androidInputs, NO_ROUTES } from "../src/core/audioRoutes"` at the top (keep `export {}`), and append:

```ts
const androidRoutes = (selected: string) => androidInputs({
  outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "bt:AA", kind: "bluetooth", name: "Buds" }],
  selected, inputs: [], input: "",
});

test("Android payloads gain the microphones their outputs bring", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", false);
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emit({ outputs: [{ id: "speaker", kind: "speaker", name: "Speaker" }, { id: "bt:AA", kind: "bluetooth", name: "Buds" }], selected: "bt:AA" });
  expect(seen.at(-1)).toMatchObject({ input: "bt:AA", inputs: [{ id: "builtin" }, { id: "bt:AA", name: "Buds" }] });
});

test("the Android fallback's routes gain microphones too", async () => {
  const t = load("android", { start: async () => false });
  await t.mod.startCallAudio("c1", false);
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emitIcm({ availableAudioDeviceList: '["EARPIECE","SPEAKER_PHONE"]', selectedAudioDevice: "SPEAKER_PHONE" });
  expect(seen.at(-1)).toMatchObject({ input: "builtin", inputs: [{ id: "builtin" }] });
});

test("Android selectInput switches to the output the mic belongs to", async () => {
  const t = load("android");
  await t.mod.startCallAudio("c1", true);
  await t.mod.selectInput(androidRoutes("bt:AA"), "builtin", true);
  expect(t.native.select).toHaveBeenCalledWith("speaker");
  t.native.select.mockClear();
  await t.mod.selectInput(androidRoutes("bt:AA"), "bt:AA", true);
  expect(t.native.select).not.toHaveBeenCalled();
  expect(t.native.selectInput).not.toHaveBeenCalled();
});

test("iOS selectInput sets the preferred input natively; its payloads keep their inputs", async () => {
  const t = load("ios");
  await t.mod.selectInput(NO_ROUTES, "uid-1", false);
  expect(t.native.selectInput).toHaveBeenCalledWith("uid-1");
  const seen: unknown[] = [];
  t.mod.watchRoutes((r) => seen.push(r));
  t.emit({ outputs: [], selected: "", inputs: [{ id: "uid-1", kind: "usb", name: "USB Mic" }], input: "uid-1" });
  expect(seen.at(-1)).toMatchObject({ input: "uid-1", inputs: [{ id: "uid-1", kind: "usb" }] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/audioRoute.native.test.ts`
Expected: FAIL — `selectInput` is not a function; Android payloads have `inputs: []`.

- [ ] **Step 3: Implement.**

`src/native/audioRoute.ts`: import `androidInputs, outputForInput` too. In `watchRoutes`, the module listener becomes:

```ts
    subs.push(new NativeEventEmitter(CoyoteAudioRoute).addListener("CoyoteAudioRoutes", (e) => {
      const r = parseRoutes(e);
      fn(Platform.OS === "android" ? androidInputs(r) : r);
    }));
```

and the fallback listener `if (mode === "fallback") fn(androidInputs(fromInCallManager(e)));`. Append:

```ts
// iOS: the preferred input. Android: mics follow outputs, so switch the output the
// mic belongs to (nothing to do when it's already in use).
export async function selectInput(routes: Routes, id: string, video: boolean): Promise<void> {
  if (Platform.OS === "ios") {
    if (!CoyoteAudioRoute) throw new Error("microphone selection is not available");
    return CoyoteAudioRoute.selectInput(id);
  }
  const out = outputForInput(routes, id, video);
  if (out) await selectOutput(out);
}
```

Update `selectOutput`'s comment to "Android only: iOS picks outputs in the system route picker (in the devices sheet)."

`src/native/webrtc.ts`: import `type CameraChoice` (instead of `Facing`) from `../core/call` and `{ parseCameras, type Camera }` from `../core/cameras`; replace `getCamera` and add `listCameras`:

```ts
const CAMERA = { width: 1280, height: 720, frameRate: 30 };

export const media: MediaPort = {
  getMic: () => firstTrack({ audio: true, video: false }),
  // deviceId wins over facingMode in react-native-webrtc on both platforms.
  getCamera: (choice: CameraChoice) =>
    firstTrack({ audio: false, video: choice.deviceId ? { ...CAMERA, deviceId: choice.deviceId } : { ...CAMERA, facingMode: choice.facing } }),
  createStream,
};

export async function listCameras(): Promise<Camera[]> {
  try {
    return parseCameras(await mediaDevices.enumerateDevices());
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest test/audioRoute.native.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/native/audioRoute.ts src/native/webrtc.ts test/audioRoute.native.test.ts
git commit -m "feat(mobile): microphone selection and camera list in the native glue"
```

---

### Task 5: iOS — inputs and `selectInput` in `CoyoteAudioRoute`

**Files:**
- Modify: `ios/Coyote/CoyoteAudioRoute.swift`, `ios/Coyote/CoyoteAudioRoute.m`
- Test: `test/nativeModules.test.ts`

**Interfaces:**
- Produces: snapshot `{ outputs, selected, inputs: [{ id, kind, name }], input }`; `selectInput(uid) → Promise<void>` (rejects `unknown-input`, `select-failed`).

- [ ] **Step 1: Write the failing test** — in `test/nativeModules.test.ts`, rename the iOS test to `"iOS CoyoteAudioRoute reports routes and sets the preferred input; CoyoteRoutePicker wraps AVRoutePickerView; both are built"` and add after the existing `.m` expectations:

```ts
  expect(read("CoyoteAudioRoute.m")).toContain("selectInput:(NSString *)uid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject");
```

and after the Swift expectations:

```ts
  expect(swift).toContain("@objc(selectInput:resolver:rejecter:)");
  expect(swift).toContain("setPreferredInput");
  expect(swift).toContain("availableInputs");
```

(Keep the `not.toMatch(/setCategory|setMode|setActive|overrideOutputAudioPort/)` line.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest test/nativeModules.test.ts`
Expected: FAIL on the `selectInput` expectations.

- [ ] **Step 3: Implement.**

`CoyoteAudioRoute.m` — add inside the interface:

```objc
RCT_EXTERN_METHOD(selectInput:(NSString *)uid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
```

`CoyoteAudioRoute.swift` — update the header comment ("Reports the call's current audio output and the available microphones, and sets the preferred microphone. …"), add the method after `routes`:

```swift
  @objc(selectInput:resolver:rejecter:)
  func selectInput(_ uid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let session = AVAudioSession.sharedInstance()
    guard let port = session.availableInputs?.first(where: { $0.uid == uid }) else {
      reject("unknown-input", "No input \(uid)", nil)
      return
    }
    do {
      try session.setPreferredInput(port)
      resolve(nil)
    } catch {
      reject("select-failed", error.localizedDescription, error)
    }
  }
```

and replace `snapshot()` plus add `inputKind`:

```swift
  private static func snapshot() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let inputs: [[String: Any]] = (session.availableInputs ?? []).map {
      ["id": $0.uid, "kind": inputKind($0.portType), "name": $0.portName]
    }
    let input = session.currentRoute.inputs.first?.uid ?? ""
    guard let port = session.currentRoute.outputs.first else {
      return ["outputs": [], "selected": "", "inputs": inputs, "input": input]
    }
    let output: [String: Any] = ["id": port.uid, "kind": kind(port.portType), "name": port.portName]
    return ["outputs": [output], "selected": port.uid, "inputs": inputs, "input": input]
  }

  private static func inputKind(_ type: AVAudioSession.Port) -> String {
    switch type {
    case .usbAudio: return "usb"
    case .headsetMic, .lineIn: return "wired"
    case .bluetoothHFP, .bluetoothLE: return "bluetooth"
    default: return "builtin"
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest test/nativeModules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/Coyote/CoyoteAudioRoute.swift ios/Coyote/CoyoteAudioRoute.m test/nativeModules.test.ts
git commit -m "feat(ios): list microphones and set the preferred one"
```

---

### Task 6: The devices sheet

**Files:**
- Create: `src/ui/components/DevicesSheet.tsx`
- Delete: `src/ui/components/AudioRouteSheet.tsx`
- Modify: `src/ui/screens/Call.tsx`, `src/ui/components/Controls.tsx`, `src/native/RoutePicker.tsx`, any file `tsc` flags for `Routes` / `CallState` literals

**Interfaces:**
- Consumes: Tasks 1–5.

The repo has no component render tests (none use react-test-renderer); the sheet's logic lives in the pure functions tested in Tasks 1–3, and this task is verified by typecheck, lint, the full Jest suite and MANUAL-TEST.

- [ ] **Step 1: Create `src/ui/components/DevicesSheet.tsx`:**

```tsx
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { selectedOutput, sortInputs, sortOutputs, type InputKind, type OutputKind, type Pending, type Routes } from "../../core/audioRoutes";
import type { Camera } from "../../core/cameras";
import { RoutePicker } from "../../native/RoutePicker";
import { colors } from "../theme";
import { Sheet } from "./Sheet";

const OUTPUT_ICON: Record<OutputKind, string> = { earpiece: "📱", speaker: "🔊", wired: "🎧", bluetooth: "🎧", car: "🚗" };
const INPUT_ICON: Record<InputKind, string> = { builtin: "🎙", wired: "🎧", bluetooth: "🎧", usb: "🔌" };

function Row({ icon, name, on, busy, onPress }: { icon: string; name: string; on: boolean; busy: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on, busy }} accessibilityLabel={name} style={styles.row}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>{name}</Text>
      {busy ? <Text style={styles.check}>…</Text> : on ? <Text style={styles.check}>✓</Text> : null}
    </Pressable>
  );
}

// The call's devices: output, microphone, camera. Android lists every output; iOS
// shows the current one and opens Apple's picker from it. Picks keep the sheet open;
// "…" marks a switch the system hasn't confirmed yet.
export function DevicesSheet({ visible, onClose, routes, pending, cameras, cameraId, cameraBusy, onOutput, onInput, onCamera }: {
  visible: boolean; onClose(): void; routes: Routes; pending: Pending | null;
  cameras: Camera[]; cameraId: string | null; cameraBusy: string | null;
  onOutput(id: string): void; onInput(id: string): void; onCamera(c: Camera): void;
}) {
  const current = selectedOutput(routes);
  const currentName = current?.name ?? "Audio";
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.6}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.header}>Output</Text>
        {RoutePicker ? (
          // iOS: Apple's route picker over the row takes the tap and VoiceOver.
          <View>
            <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.icon}>{OUTPUT_ICON[current?.kind ?? "speaker"]}</Text>
              <Text style={styles.name} numberOfLines={1}>{currentName}</Text>
              <Text style={styles.change}>Change ›</Text>
            </View>
            <RoutePicker style={StyleSheet.absoluteFill} accessible accessibilityLabel={`Audio output: ${currentName}. Change`} />
          </View>
        ) : (
          <>
            {sortOutputs(routes.outputs).map((o) => (
              <Row key={o.id} icon={OUTPUT_ICON[o.kind]} name={o.name} on={o.id === routes.selected}
                busy={pending?.target === "output" && pending.id === o.id} onPress={() => onOutput(o.id)} />
            ))}
            {routes.outputs.length === 0 ? <Text style={styles.msg}>No audio outputs reported yet.</Text> : null}
          </>
        )}
        <Text style={styles.header}>Microphone</Text>
        {sortInputs(routes.inputs).map((i) => (
          <Row key={i.id} icon={INPUT_ICON[i.kind]} name={i.name} on={i.id === routes.input}
            busy={pending?.target === "input" && pending.id === i.id} onPress={() => onInput(i.id)} />
        ))}
        {routes.inputs.length === 0 ? <Text style={styles.msg}>No microphones reported yet.</Text> : null}
        {cameras.length > 0 ? (
          <>
            <Text style={styles.header}>Camera</Text>
            {cameras.map((c) => (
              <Row key={c.id} icon="📷" name={c.name} on={c.id === cameraId} busy={cameraBusy === c.id} onPress={() => onCamera(c)} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  header: { color: colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { fontSize: 20, width: 36 },
  name: { flex: 1, color: colors.text, fontSize: 17 },
  nameOn: { fontWeight: "700" },
  check: { color: colors.accent, fontSize: 18, fontWeight: "700", marginLeft: 8 },
  change: { color: colors.accent, fontSize: 17, marginLeft: 8 },
  msg: { color: colors.muted, marginTop: 12 },
});
```

Delete `src/ui/components/AudioRouteSheet.tsx` (`git rm`).

- [ ] **Step 2: Controls.** In `src/ui/components/Controls.tsx` remove the `RoutePicker` import, the iOS branch and the now-unused `hidden` prop of `Btn` (prop, default, and the two accessibility attributes). The audio button is always:

```tsx
      <Btn label={p.routeLabel} onPress={p.onRoute} fit a11y={p.routeA11y} />
```

`src/native/RoutePicker.tsx` comment: "iOS: Apple's output picker (CoyoteRoutePicker, an AVRoutePickerView with its icon hidden), laid over the devices sheet's Output row so a tap opens the system sheet. Android has no system equivalent: null, and the sheet lists outputs itself."

- [ ] **Step 3: Call screen.** In `src/ui/screens/Call.tsx`:
  - Imports: add `pickInput` to the audioRoutes import; `selectInput` to the audioRoute import; `import { listCameras } from "../../native/webrtc";`; `import { cameraFacing, type Camera } from "../../core/cameras";`; replace the `AudioRouteSheet` import with `import { DevicesSheet } from "../components/DevicesSheet";`.
  - State: `const [cameras, setCameras] = useState<Camera[]>([]);` and `const [cameraBusy, setCameraBusy] = useState<string | null>(null);`; the sheet union's `"audio"` becomes `"devices"`.
  - Pending effect comment: "A requested output or microphone switch: settled by the next report that selects it, failed when it vanishes, the platform rejects it, or 5 s pass."
  - `pickRoute` no longer calls `setSheet(null)`. Add after it:

```tsx
  const pickMic = (id: string) => {
    const p = pickInput(routes, id, Date.now());
    if (!p) return;
    setPending(p);
    selectInput(routes, id, state.camera).catch((e) => {
      console.warn("microphone failed", e);
      setPending((cur) => (cur === p ? { ...p, at: 0 } : cur));
    });
  };
  const pickCamera = (c: Camera) => {
    if (c.id === state.cameraId || cameraBusy) return;
    const p = call()?.selectCamera(c.id, cameraFacing(c.facing));
    if (!p) return;
    setCameraBusy(c.id);
    p.catch(warn("camera")).finally(() => setCameraBusy(null));
  };
```

  - Controls props: `routeA11y={`Audio and video devices. Output: ${current?.name ?? outputLabel(undefined)}`}` and

```tsx
          onRoute={() => {
            const open = sheet !== "devices";
            setSheet(open ? "devices" : null);
            if (open) listCameras().then(setCameras).catch(() => setCameras([]));
            call()?.chat.setOpen(false);
          }}
```

  - Replace the `AudioRouteSheet` element with:

```tsx
        <DevicesSheet
          visible={sheet === "devices"}
          onClose={() => setSheet(null)}
          routes={routes}
          pending={pending}
          cameras={cameras}
          cameraId={state.cameraId}
          cameraBusy={cameraBusy}
          onOutput={pickRoute}
          onInput={pickMic}
          onCamera={pickCamera}
        />
```

  - Remove the `Platform` import if nothing else in the file uses it.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint && npx jest`
Expected: typecheck clean (fix any remaining `Routes` literal missing `inputs`/`input`, or `CallState` literal missing `cameraId`, that it reports), lint clean, all suites pass.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "feat(mobile): devices sheet with output, microphone and camera"
```

---

### Task 7: Manual tests, version 1.7.0, Android build

**Files:**
- Modify: `MANUAL-TEST.md`, `ios/Coyote.xcodeproj/project.pbxproj`, `android/app/build.gradle`

- [ ] **Step 1: MANUAL-TEST.** Replace item 76 with:

```markdown
76. **iPhone output.** Tap the audio button: the devices sheet opens; its Output row
    shows the current output. Tap the row: Apple's output sheet opens and lists
    iPhone, Speaker, AirPods etc. Pick each: audio moves and the row and button
    follow. Switch from Control Centre: they follow too. Video calls still start on
    the speaker. VoiceOver reads "Audio and video devices. Output: <name>" on the
    button and "Audio output: <name>. Change" on the row.
```

Append:

```markdown
78. **Devices sheet (Android).** Tap the audio button: Output, Microphone and Camera
    sections; picking a row keeps the sheet open and moves the ✓ (with "…" briefly).
79. **Android microphones.** With Bluetooth earbuds connected: Microphone lists Phone
    microphone and the earbuds by name. Pick the earbuds' mic: output moves to them
    and the others hear you through them. Pick Phone microphone: output moves to the
    earpiece (audio-only call) or the speaker (video call). With a wired headset,
    "Headset microphone" appears and works the same way.
80. **Android cameras.** Camera lists every camera ("Front camera", "Back camera",
    "Back camera 2" …). Pick each with the camera on: the self-view and what others
    see switch live; a background effect stays on. Flip after a pick: the ✓ follows.
81. **iPhone microphones.** Microphone lists iPhone Microphone and, when connected,
    AirPods / a wired headset mic. Pick each: the others hear you through it; picking
    AirPods also moves the output to them.
82. **iPhone cameras.** Camera lists Front Camera, Back Camera and, where the phone has
    them, Back Ultra Wide / Telephoto. Pick each: switches live. Flip after a pick works.
83. **iPad USB devices.** Plug in a USB camera and a USB mic: both listed and
    selectable. Unplug the camera, turn the camera off and on: it falls back to the
    back camera.
84. **Camera picked while off.** Turn the camera off, pick another camera (the ✓
    moves, nothing turns on), turn the camera on: that camera is used.
```

- [ ] **Step 2: Bump the version.** In `ios/Coyote.xcodeproj/project.pbxproj` change all four `CURRENT_PROJECT_VERSION = 10;` to `11` and all four `MARKETING_VERSION = 1.6.0;` to `1.7.0`; in `android/app/build.gradle` `versionCode 11` and `versionName "1.7.0"`.

Run: `grep -c "CURRENT_PROJECT_VERSION = 11;\|MARKETING_VERSION = 1.7.0;" ios/Coyote.xcodeproj/project.pbxproj; grep -n "versionCode\|versionName" android/app/build.gradle`
Expected: `8`; `versionCode 11`, `versionName "1.7.0"`.

- [ ] **Step 3: Full verification and Android build**

Run: `npm run typecheck && npm run lint && npx jest && (cd android && ./gradlew :app:assembleDebug -q)`
Expected: all clean; Gradle `BUILD SUCCESSFUL` (or quiet success).

- [ ] **Step 4: Commit**

```bash
git add MANUAL-TEST.md ios/Coyote.xcodeproj/project.pbxproj android/app/build.gradle
git commit -m "chore(mobile): 1.7.0 (build 11), manual tests for device selection"
```
