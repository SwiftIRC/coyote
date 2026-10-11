# Mobile Screenshare Sending (4a, 1.4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a phone in a Coyote call share its screen (video only) — iOS through a ReplayKit broadcast extension, Android through MediaProjection — stoppable by the user, the system UI, an op, or leaving.

**Architecture:** A pure-TS `ScreenShare` store beside `Call` (the `Moderation`/`Polls` pattern) owns the share's state and track and talks to the call through a small host interface; `Call` publishes the track as kind `screen` on the existing `Peer`. A `src/native/screenCapture.ts` wrapper turns react-native-webrtc's `getDisplayMedia` into one `start()` on both platforms; on iOS it also opens the system broadcast sheet through a new in-house `CoyoteScreenShare` module and waits for the extension's "started" Darwin notification. A new `CoyoteBroadcast` Broadcast Upload Extension streams JPEG frames to react-native-webrtc's App Group socket.

**Tech Stack:** React Native 0.87 + TypeScript (`mobile/`), Jest, react-native-webrtc 124 (existing), Swift/ObjC (iOS app module + extension), Android manifest.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-heavy-sending-design.md` (sections "Decisions" and "4a — Screenshare sending").

## Global Constraints

- Commit messages: **no `Co-Authored-By` trailer.** Conventional style as in `git log` (`feat(mobile): …`, `chore(mobile): …`).
- Do not push, do not merge. Work on branch `feat/mobile-screenshare-send`.
- No new third-party dependencies (npm, CocoaPods, Gradle). No server or wire-protocol change.
- Layering: `mobile/src/core/` imports nothing from React Native or react-native-webrtc.
- Verification (in `mobile/`): `npx jest`, `npm run typecheck`, `npm run lint`. All must pass at the end of every task. Swift cannot be compiled on Linux — the user builds on the Mac; keep Swift simple and stick to the APIs shown here.
- Identifiers (verbatim): App Group `group.net.swiftirc.coyote`; extension bundle id `net.swiftirc.coyote.broadcast`; extension target/product `CoyoteBroadcast`; Darwin notification `net.swiftirc.coyote.broadcast.started`; RN event `CoyoteBroadcastStarted`; socket file name `rtc_SSFD` (react-native-webrtc's constant).
- Copy (verbatim):
  - ☰ rows: `Share screen` / `Starting…` (disabled) / `Stop sharing`.
  - Pill: `Sharing your screen · Stop`, accessibility label `Stop sharing your screen`.
  - Own tile: `You're sharing your screen`.
  - Notices: `Couldn't start screen sharing.` and `An op stopped your screen share.`
  - Extension, when no call is listening: `Start screen sharing from a Coyote call.`
- Version 1.4.0: iOS `MARKETING_VERSION = 1.4.0`, `CURRENT_PROJECT_VERSION = 7` (app **and** extension, Debug and Release); Android `versionName "1.4.0"`, `versionCode 7`.
- iOS share confirmation timeout: 30 s (`BROADCAST_WAIT_MS = 30000`).

## Review Focus

1. **Leaving (or being kicked) while the share is still `starting`** — the capture that resolves afterwards must be stopped, not published, and the state must stay `idle` (Task 1 test "a capture that resolves after stop is released").
2. **Starting twice** (double tap on ☰ row, or ☰ then the pill race) — exactly one capture request (Task 1 test "start while not idle does nothing").
3. **A reconnect mid-share** — the rebuilt peer must publish the screen track again; a share ended while offline must not be republished (Task 2 tests).
4. **Op stop-share when not sharing** (stale `muted{kind:"screen"}`) — no notice, no error (Task 1 test "stop when idle is silent").
5. **Publishing fails** (peer rejects) — the user must not be left with a "sharing" pill for a share nobody sees: stop and show the failure notice (Task 1 test "a publish failure stops the share").

---

### Task 1: `ScreenShare` store (`mobile/src/core/screenShare.ts`)

**Files:**
- Create: `mobile/src/core/screenShare.ts`
- Test: `mobile/test/screenShare.test.ts`

**Interfaces:**
- Consumes: `TrackLike`, `Logger` from `mobile/src/core/types.ts`.
- Produces (used by Tasks 2, 3, 5):
  - `type ShareStatus = "idle" | "starting" | "sharing"`
  - `type StopReason = "user" | "ended" | "op" | "leave"`
  - `interface ShareSnapshot { status: ShareStatus }`
  - `interface ScreenCapturePort { start(): Promise<TrackLike> }` — rejects with an `Error` whose `name === "CaptureCancelled"` when the user declined.
  - `interface ShareHost { publish(track: TrackLike): Promise<void>; unpublish(): void; notice(text: string): void; canShare(): boolean }`
  - `const SHARE_TEXT = { failed: "Couldn't start screen sharing.", op: "An op stopped your screen share." }`
  - `function captureCancelled(): Error` (name `"CaptureCancelled"`)
  - `class ScreenShare { constructor(capture: ScreenCapturePort, host: ShareHost, log: Logger); start(): Promise<void>; stop(reason: StopReason): void; liveTrack(): TrackLike | null; subscribe(fn): () => void; getSnapshot(): ShareSnapshot }`

- [ ] **Step 1: Write the failing tests** — create `mobile/test/screenShare.test.ts`:

```ts
import { captureCancelled, ScreenShare, SHARE_TEXT, type ShareHost } from "../src/core/screenShare";
import type { TrackLike } from "../src/core/types";
import { FakeTrack, flush, silentLog } from "./fakes";

function setup(opts: { canShare?: boolean; publishFails?: boolean } = {}) {
  const calls: string[] = [];
  const notices: string[] = [];
  const waits: Array<{ resolve(t: TrackLike): void; reject(e: unknown): void }> = [];
  const host: ShareHost = {
    publish: async (t) => {
      calls.push(`publish ${t.id}`);
      if (opts.publishFails) throw new Error("nope");
    },
    unpublish: () => calls.push("unpublish"),
    notice: (t) => notices.push(t),
    canShare: () => opts.canShare ?? true,
  };
  const share = new ScreenShare({ start: () => new Promise((resolve, reject) => waits.push({ resolve, reject })) }, host, silentLog);
  const statuses: string[] = [];
  share.subscribe(() => statuses.push(share.getSnapshot().status));
  return { share, calls, notices, waits, statuses };
}

async function sharing() {
  const t = setup();
  const track = new FakeTrack("video");
  const p = t.share.start();
  t.waits[0].resolve(track);
  await p;
  return { ...t, track };
}

test("start: idle → starting → sharing, and the track is published", async () => {
  const { share, calls, statuses, track } = await sharing();
  expect(statuses).toEqual(["starting", "sharing"]);
  expect(share.getSnapshot()).toEqual({ status: "sharing" });
  expect(calls).toEqual([`publish ${track.id}`]);
  expect(share.liveTrack()).toBe(track);
});

test("a cancelled capture returns to idle without a notice", async () => {
  const { share, waits, notices, statuses } = setup();
  const p = share.start();
  waits[0].reject(captureCancelled());
  await p;
  expect(statuses).toEqual(["starting", "idle"]);
  expect(notices).toEqual([]);
});

test("a failed capture returns to idle with the failure notice", async () => {
  const { share, waits, notices } = setup();
  const p = share.start();
  waits[0].reject(new Error("boom"));
  await p;
  expect(share.getSnapshot().status).toBe("idle");
  expect(notices).toEqual([SHARE_TEXT.failed]);
});

test("start while not idle does nothing", async () => {
  const { share, waits } = setup();
  const p = share.start();
  await share.start();
  expect(waits.length).toBe(1);
  waits[0].resolve(new FakeTrack("video"));
  await p;
  await share.start();
  expect(waits.length).toBe(1);
});

test("start is refused when the host cannot share (not in call)", async () => {
  const { share, waits, statuses } = setup({ canShare: false });
  await share.start();
  expect(waits.length).toBe(0);
  expect(statuses).toEqual([]);
});

test("stop(user): unpublishes, stops the track, back to idle, no notice", async () => {
  const { share, calls, notices, track } = await sharing();
  share.stop("user");
  expect(calls.at(-1)).toBe("unpublish");
  expect(track.stopped).toBe(true);
  expect(share.getSnapshot().status).toBe("idle");
  expect(share.liveTrack()).toBeNull();
  expect(notices).toEqual([]);
});

test("the system ending the track stops the share", async () => {
  const { share, calls, track } = await sharing();
  track.end();
  expect(share.getSnapshot().status).toBe("idle");
  expect(calls.at(-1)).toBe("unpublish");
});

test("stop(op) shows the op notice; stop(leave) does not", async () => {
  const a = await sharing();
  a.share.stop("op");
  expect(a.notices).toEqual([SHARE_TEXT.op]);
  const b = await sharing();
  b.share.stop("leave");
  expect(b.notices).toEqual([]);
});

test("stop when idle is silent", () => {
  const { share, calls, notices, statuses } = setup();
  share.stop("op");
  expect(calls).toEqual([]);
  expect(notices).toEqual([]);
  expect(statuses).toEqual([]);
});

test("a capture that resolves after stop is released", async () => {
  const { share, waits, calls } = setup();
  const p = share.start();
  share.stop("leave");
  expect(share.getSnapshot().status).toBe("idle");
  const late = new FakeTrack("video");
  waits[0].resolve(late);
  await p;
  expect(late.stopped).toBe(true);
  expect(calls).toEqual([]);
  expect(share.getSnapshot().status).toBe("idle");
});

test("a stale ended event from an old track does not stop a newer share", async () => {
  const { share, waits, track } = await sharing();
  share.stop("user");
  const p = share.start();
  const next = new FakeTrack("video");
  waits[1].resolve(next);
  await p;
  track.end();
  expect(share.getSnapshot().status).toBe("sharing");
  expect(share.liveTrack()).toBe(next);
});

test("a publish failure stops the share and shows the failure notice", async () => {
  const { share, waits, notices, calls } = setup({ publishFails: true });
  const track = new FakeTrack("video");
  const p = share.start();
  waits[0].resolve(track);
  await p;
  await flush();
  expect(share.getSnapshot().status).toBe("idle");
  expect(track.stopped).toBe(true);
  expect(calls.at(-1)).toBe("unpublish");
  expect(notices).toEqual([SHARE_TEXT.failed]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `mobile/`): `npx jest test/screenShare.test.ts`
Expected: FAIL — `Cannot find module '../src/core/screenShare'`.

- [ ] **Step 3: Write the implementation** — create `mobile/src/core/screenShare.ts`:

```ts
// Sending a screenshare: the share's state and track, and the four ways it ends
// (the user, the system UI ending the track, an op's stop-share, leaving). The
// capture itself is a native port; publishing goes through the call's host.
// Snapshots are replaced on change for useSyncExternalStore.
import type { Logger, TrackLike } from "./types";

export type ShareStatus = "idle" | "starting" | "sharing";
export type StopReason = "user" | "ended" | "op" | "leave";
export interface ShareSnapshot {
  status: ShareStatus;
}

export interface ScreenCapturePort {
  // Resolves with a live video track once capture runs; rejects with
  // captureCancelled() when the user dismissed the system sheet or prompt.
  start(): Promise<TrackLike>;
}

export interface ShareHost {
  publish(track: TrackLike): Promise<void>;
  unpublish(): void;
  notice(text: string): void;
  canShare(): boolean;
}

export const SHARE_TEXT = {
  failed: "Couldn't start screen sharing.",
  op: "An op stopped your screen share.",
};

export function captureCancelled(): Error {
  const e = new Error("screen capture cancelled");
  e.name = "CaptureCancelled";
  return e;
}

const isCancelled = (e: unknown) => !!e && (e as { name?: unknown }).name === "CaptureCancelled";

export class ScreenShare {
  private snap: ShareSnapshot = { status: "idle" };
  private track: TrackLike | null = null;
  // Bumped by every stop(); a capture that resolves under an older generation was
  // abandoned while starting and is released, not published.
  private gen = 0;
  private listeners = new Set<() => void>();

  constructor(
    private capture: ScreenCapturePort,
    private host: ShareHost,
    private log: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.snap.status !== "idle" || !this.host.canShare()) return;
    const gen = this.gen;
    this.set("starting");
    let track: TrackLike;
    try {
      track = await this.capture.start();
    } catch (e) {
      if (gen !== this.gen) return;
      this.set("idle");
      if (!isCancelled(e)) {
        this.log.warn("[share] capture failed", e);
        this.host.notice(SHARE_TEXT.failed);
      }
      return;
    }
    if (gen !== this.gen) {
      track.stop();
      return;
    }
    this.track = track;
    track.addEventListener?.("ended", () => {
      if (this.track === track) this.stop("ended");
    });
    this.set("sharing");
    try {
      await this.host.publish(track);
    } catch (e) {
      if (this.track !== track) return;
      this.log.warn("[share] publish failed", e);
      this.stop("ended");
      this.host.notice(SHARE_TEXT.failed);
    }
  }

  stop(reason: StopReason): void {
    if (this.snap.status === "idle") return;
    this.gen++;
    const track = this.track;
    this.track = null;
    if (track) {
      this.host.unpublish();
      track.stop();
    }
    this.set("idle");
    if (reason === "op" && track) this.host.notice(SHARE_TEXT.op);
  }

  // The track a rebuilt peer must republish, or null.
  liveTrack(): TrackLike | null {
    return this.snap.status === "sharing" ? this.track : null;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ShareSnapshot => this.snap;

  private set(status: ShareStatus) {
    this.snap = { status };
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest test/screenShare.test.ts` — Expected: PASS (12 tests). Then `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/screenShare.ts mobile/test/screenShare.test.ts
git commit -m "feat(mobile): ScreenShare store for sending a screenshare"
```

---

### Task 2: Wire `ScreenShare` into `Call`; own-share grid tile

**Files:**
- Modify: `mobile/src/core/call.ts` (imports; `PeerLike` line 21; `CallDeps` ~line 37; fields ~line 101; constructor ~line 136; `onForceMuted` ~line 464; `rebuildPeer` ~line 504; `finish` ~line 546)
- Modify: `mobile/src/core/tiles.ts`
- Test: `mobile/test/call.test.ts`, `mobile/test/tiles.test.ts`

**Interfaces:**
- Consumes (Task 1): `ScreenShare`, `ScreenCapturePort`.
- Produces: `Call.screenShare: ScreenShare` (readonly); `CallDeps.screen: ScreenCapturePort`; `PeerLike` now includes `unpublish`; `GridTile` gains `{ kind: "own-screen"; key: "self:screen" }`; `gridTiles(people: Participant[], selfSharing = false): GridTile[]`.

- [ ] **Step 1: Write the failing tests**

In `mobile/test/call.test.ts`:

1. Add to `class FakePeer` (after `replaced`):

```ts
  unpublished: Kind[] = [];
```

and the method (after `replaceTrack`):

```ts
  unpublish(k: Kind) {
    this.unpublished.push(k);
    this.senders.delete(k);
  }
```

2. In `setup()`, add `const screens: FakeTrack[] = [];` beside `cams`, add this dep after `fetchBoard`:

```ts
    screen: {
      start: async () => {
        const t = new FakeTrack("video");
        screens.push(t);
        return t;
      },
    },
```

and add `screens` to the returned object.

3. Append the tests:

```ts
test("screenshare: start publishes kind screen; stop unpublishes", async () => {
  const { call, peers, screens } = await inCall();
  await call.screenShare.start();
  expect(peers[0].published).toContainEqual(["screen", screens[0]]);
  call.screenShare.stop("user");
  expect(peers[0].unpublished).toEqual(["screen"]);
  expect(screens[0].stopped).toBe(true);
});

test("screenshare: an op's muted{screen} stops the share with a notice", async () => {
  const { call, peers, notices, screens } = await inCall();
  await call.screenShare.start();
  sock().receive({ type: "muted", kind: "screen" });
  await flush();
  expect(call.screenShare.getSnapshot().status).toBe("idle");
  expect(peers[0].unpublished).toEqual(["screen"]);
  expect(screens[0].stopped).toBe(true);
  expect(notices).toContain("An op stopped your screen share.");
});

test("screenshare: a reconnect republishes a live share on the rebuilt peer", async () => {
  const { call, timers, peers, screens, mics, cams } = await inCall();
  await call.screenShare.start();
  sock().drop();
  timers.advance(500); // reconnect backoff
  sock().open();
  sock().receive(joined());
  await flush();
  expect(peers[1].started).toEqual([
    { track: mics[0], kind: "mic" }, { track: cams[0], kind: "camera" }, { track: screens[0], kind: "screen" },
  ]);
});

test("screenshare: a share ended while offline is not republished", async () => {
  const { call, timers, peers, screens } = await inCall();
  await call.screenShare.start();
  sock().drop();
  screens[0].end();
  timers.advance(500); // reconnect backoff
  sock().open();
  sock().receive(joined());
  await flush();
  expect(peers[1].started?.some((l) => l.kind === "screen")).toBe(false);
});

test("screenshare: leaving stops the share", async () => {
  const { call, screens } = await inCall();
  await call.screenShare.start();
  call.leave();
  expect(screens[0].stopped).toBe(true);
  expect(call.screenShare.getSnapshot().status).toBe("idle");
});

test("screenshare: cannot start before the call is up", async () => {
  const t = setup();
  await t.call.join(req());
  await t.call.screenShare.start();
  expect(t.screens).toEqual([]);
});
```


In `mobile/test/tiles.test.ts`, append:

```ts
test("your own share is the first tile, only while sharing", () => {
  expect(gridTiles([person("a")], true).map((t) => t.key)).toEqual(["self:screen", "a"]);
  expect(gridTiles([person("a")], true)[0].kind).toBe("own-screen");
  expect(gridTiles([person("a")]).map((t) => t.key)).toEqual(["a"]);
  expect(gridTiles([], true).map((t) => t.key)).toEqual(["self:screen"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest test/call.test.ts test/tiles.test.ts`
Expected: FAIL — `call.screenShare` is undefined / typecheck errors on `screen` dep and `gridTiles` arity.

- [ ] **Step 3: Implement**

In `mobile/src/core/call.ts`:

- Import: `import { ScreenShare, type ScreenCapturePort } from "./screenShare";`
- `PeerLike`: `Pick<Peer, "start" | "publish" | "replaceTrack" | "unpublish" | "setQuality" | "close">`.
- `CallDeps`: add `screen: ScreenCapturePort;` after `fetchBoard`.
- Field after `readonly soundboard: Soundboard;`: `readonly screenShare: ScreenShare;`
- Constructor, after the soundboard line:

```ts
    this.screenShare = new ScreenShare(deps.screen, {
      publish: async (t) => {
        if (this.peer) await this.peer.publish(t, "screen");
      },
      unpublish: () => this.peer?.unpublish("screen"),
      notice: (text) => this.events.notice(text),
      canShare: () => this.state.phase === "in-call",
    }, deps.log);
```

- `onForceMuted`:

```ts
  private async onForceMuted(kind: string) {
    if (kind === "mic") await this.setMic(false);
    else if (kind === "camera") await this.setCamera(false);
    else if (kind === "screen") this.screenShare.stop("op");
  }
```

- `rebuildPeer`, after the camera push:

```ts
    const screen = this.screenShare.liveTrack();
    if (screen) local.push({ track: screen, kind: "screen" });
```

- `finish`, first line after the `ended` guard (before `this.sig?.stop()`):

```ts
    this.screenShare.stop("leave");
```

In `mobile/src/native/callFactory.ts` add a temporary dep so the app still typechecks (Task 3 replaces it):

```ts
    screen: { start: () => Promise.reject(new Error("screen capture not wired")) },
```

In `mobile/src/core/tiles.ts`:

```ts
export type GridTile =
  | { kind: "person"; key: string; p: Participant }
  | { kind: "screen"; key: string; p: Participant }
  | { kind: "own-screen"; key: string };

const sharing = (p: Participant) => !!(p.screen || p.screenAudio);

// Your own share first (while sharing), then one tile per person, plus a screen
// tile right after anyone who is sharing.
export function gridTiles(people: Participant[], selfSharing = false): GridTile[] {
  const out: GridTile[] = selfSharing ? [{ kind: "own-screen", key: "self:screen" }] : [];
  for (const p of people) {
    out.push({ kind: "person", key: p.id, p });
    if (sharing(p)) out.push({ kind: "screen", key: `${p.id}:screen`, p });
  }
  return out;
}
```

`mobile/src/ui/screens/Call.tsx` will now fail typecheck where it maps tiles (`t.p` on `own-screen`). Make the minimal compile fix there — render nothing for that kind until Task 5:

```tsx
            tiles.map((t) => t.kind === "own-screen" ? null : t.kind === "screen"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/call.ts mobile/src/core/tiles.ts mobile/src/native/callFactory.ts mobile/src/ui/screens/Call.tsx mobile/test/call.test.ts mobile/test/tiles.test.ts
git commit -m "feat(mobile): publish a screenshare from the call; op stop-share and leave end it"
```

---

### Task 3: Native capture — JS wrapper, Android permission, iOS `CoyoteScreenShare` module

**Files:**
- Create: `mobile/src/native/screenCapture.ts`
- Create: `mobile/ios/Coyote/CoyoteScreenShare.swift`, `mobile/ios/Coyote/CoyoteScreenShare.m`
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (add the two files to the Coyote group and Sources phase)
- Modify: `mobile/src/native/callFactory.ts` (replace the Task 2 placeholder)
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Consumes (Task 1): `ScreenCapturePort`, `captureCancelled()`.
- Produces: `export const screenCapture: ScreenCapturePort` and `export const BROADCAST_WAIT_MS = 30000` from `src/native/screenCapture.ts`. iOS native module `CoyoteScreenShare` with method `showPicker()` and event `CoyoteBroadcastStarted` (fired when the extension posts the Darwin notification `net.swiftirc.coyote.broadcast.started`, i.e. once its socket is connected and frames flow). Task 4's extension posts that notification.

How the platforms behave (react-native-webrtc 124, read from `node_modules`):
- **Android:** `mediaDevices.getDisplayMedia()` shows the system consent prompt and starts the library's own `MediaProjectionService` (declared in its manifest, type `mediaProjection`). Denial rejects with a `MediaStreamError` whose `message` is `"NotAllowedError"`. The track fires `ended` when the projection stops (notification "Stop", system UI).
- **iOS:** `getDisplayMedia()` resolves at once with a live-but-idle track and opens a Unix socket server at `<App Group container>/rtc_SSFD` (group from Info.plist `RTCAppGroupIdentifier`, added in Task 4). Frames arrive only once the broadcast extension connects. When the extension disconnects, the track fires `ended`. Stopping the track closes the socket, which makes the extension finish the broadcast.

- [ ] **Step 1: Write the failing guard tests** — append to `mobile/test/nativeModules.test.ts`:

```ts
test("Android declares the media-projection foreground-service permission (Android 14+)", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');
});

test("CoyoteScreenShare exports showPicker and relays the extension's started notification", () => {
  const app = path.join(__dirname, "..");
  const m = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteScreenShare.m"), "utf8");
  expect(m).toContain("RCT_EXTERN_MODULE(CoyoteScreenShare, RCTEventEmitter)");
  expect(m).toContain("RCT_EXTERN_METHOD(showPicker)");
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteScreenShare.swift"), "utf8");
  expect(swift).toContain('"net.swiftirc.coyote.broadcast.started"');
  expect(swift).toContain('"CoyoteBroadcastStarted"');
  expect(swift).toContain("RPSystemBroadcastPickerView");
  const pbx = fs.readFileSync(path.join(app, "ios", "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  expect(pbx).toContain("CoyoteScreenShare.swift in Sources");
  expect(pbx).toContain("CoyoteScreenShare.m in Sources");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/nativeModules.test.ts` — Expected: the two new tests FAIL (missing permission / files).

- [ ] **Step 3: Android permission** — in `AndroidManifest.xml`, after the `FOREGROUND_SERVICE_MICROPHONE` line:

```xml
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
```

- [ ] **Step 4: iOS module** — create `mobile/ios/Coyote/CoyoteScreenShare.m`:

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CoyoteScreenShare, RCTEventEmitter)
RCT_EXTERN_METHOD(showPicker)
@end
```

Create `mobile/ios/Coyote/CoyoteScreenShare.swift`:

```swift
import React
import ReplayKit
import UIKit

// Opens the system "Start Broadcast" sheet with our CoyoteBroadcast extension
// preselected, and tells JS when the extension has connected to
// react-native-webrtc's screen-capture socket (the extension posts a Darwin
// notification then). The picker is a hidden RPSystemBroadcastPickerView whose
// button we tap programmatically — the only public way to open that sheet.
@objc(CoyoteScreenShare)
class CoyoteScreenShare: RCTEventEmitter {
  private static let startedName = "net.swiftirc.coyote.broadcast.started"
  private var picker: RPSystemBroadcastPickerView?
  private var listening = false

  override init() {
    super.init()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), observer,
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let me = Unmanaged<CoyoteScreenShare>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async { me.broadcastStarted() }
      },
      CoyoteScreenShare.startedName as CFString, nil, .deliverImmediately)
  }

  deinit {
    CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteBroadcastStarted"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  @objc(showPicker)
  func showPicker() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let picker = self.picker ?? self.makePicker() else { return }
      guard let button = picker.subviews.compactMap({ $0 as? UIButton }).first else {
        NSLog("[CoyoteScreenShare] broadcast picker button not found")
        return
      }
      button.sendActions(for: .touchUpInside)
    }
  }

  private func broadcastStarted() {
    if listening { sendEvent(withName: "CoyoteBroadcastStarted", body: nil) }
  }

  // Lives, invisible, in the key window: the picker presents its sheet from there.
  private func makePicker() -> RPSystemBroadcastPickerView? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    guard let window = window else { return nil }
    let p = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    p.preferredExtension = Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") as? String
    p.showsMicrophoneButton = false
    p.alpha = 0
    p.isUserInteractionEnabled = false
    window.addSubview(p)
    picker = p
    return p
  }
}
```

- [ ] **Step 5: Add both files to the Xcode project** — in `mobile/ios/Coyote.xcodeproj/project.pbxproj` (tabs for indentation, as the file uses):

PBXBuildFile section, after the `CoyoteSounds.m in Sources` line:

```
		C0B0AD112E00000000000001 /* CoyoteScreenShare.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AD012E00000000000001 /* CoyoteScreenShare.swift */; };
		C0B0AD122E00000000000001 /* CoyoteScreenShare.m in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AD022E00000000000001 /* CoyoteScreenShare.m */; };
```

PBXFileReference section, after the `CoyoteSounds.m` file reference:

```
		C0B0AD012E00000000000001 /* CoyoteScreenShare.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = CoyoteScreenShare.swift; path = Coyote/CoyoteScreenShare.swift; sourceTree = "<group>"; };
		C0B0AD022E00000000000001 /* CoyoteScreenShare.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = CoyoteScreenShare.m; path = Coyote/CoyoteScreenShare.m; sourceTree = "<group>"; };
```

The `Coyote` PBXGroup's `children`, after `CoyoteSounds.m`:

```
				C0B0AD012E00000000000001 /* CoyoteScreenShare.swift */,
				C0B0AD022E00000000000001 /* CoyoteScreenShare.m */,
```

The app's PBXSourcesBuildPhase (`13B07F871A680F5B00A75B9A`) `files`, after `CoyoteSounds.m in Sources`:

```
				C0B0AD112E00000000000001 /* CoyoteScreenShare.swift in Sources */,
				C0B0AD122E00000000000001 /* CoyoteScreenShare.m in Sources */,
```

- [ ] **Step 6: JS wrapper** — create `mobile/src/native/screenCapture.ts`:

```ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { mediaDevices } from "react-native-webrtc";
import { captureCancelled, type ScreenCapturePort } from "../core/screenShare";
import type { TrackLike } from "../core/types";

const { CoyoteScreenShare } = NativeModules;

// How long iOS waits for the broadcast extension to connect after opening the
// system sheet; no connection by then means the sheet was dismissed.
export const BROADCAST_WAIT_MS = 30000;

async function displayTrack(): Promise<TrackLike> {
  const stream = await mediaDevices.getDisplayMedia({ video: true } as any);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("no screen track");
  return track as unknown as TrackLike;
}

async function startAndroid(): Promise<TrackLike> {
  try {
    return await displayTrack();
  } catch (e) {
    if (String((e as { message?: unknown })?.message ?? "").includes("NotAllowedError")) throw captureCancelled();
    throw e;
  }
}

// getDisplayMedia opens react-native-webrtc's socket server first; the extension
// connects to it once the user taps Start Broadcast, and announces that.
async function startIos(): Promise<TrackLike> {
  if (!CoyoteScreenShare) throw new Error("CoyoteScreenShare native module missing");
  const track = await displayTrack();
  const emitter = new NativeEventEmitter(CoyoteScreenShare);
  return new Promise<TrackLike>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = emitter.addListener("CoyoteBroadcastStarted", () => finish(true));
    function finish(ok: boolean) {
      if (timer) clearTimeout(timer);
      sub.remove();
      if (ok) {
        resolve(track);
      } else {
        track.stop();
        reject(captureCancelled());
      }
    }
    timer = setTimeout(() => finish(false), BROADCAST_WAIT_MS);
    CoyoteScreenShare.showPicker();
  });
}

export const screenCapture: ScreenCapturePort = {
  start: () => (Platform.OS === "ios" ? startIos() : startAndroid()),
};
```

- [ ] **Step 7: Wire it** — in `mobile/src/native/callFactory.ts` add `import { screenCapture } from "./screenCapture";` and replace the Task 2 placeholder with `screen: screenCapture,`.

- [ ] **Step 8: Verify**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/native/screenCapture.ts mobile/src/native/callFactory.ts mobile/ios/Coyote/CoyoteScreenShare.swift mobile/ios/Coyote/CoyoteScreenShare.m mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/android/app/src/main/AndroidManifest.xml mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): native screen capture — Android MediaProjection, iOS broadcast picker"
```

---

### Task 4: iOS broadcast extension `CoyoteBroadcast`

**Files:**
- Create: `mobile/ios/CoyoteBroadcast/SampleHandler.swift`, `SocketConnection.swift`, `SampleUploader.swift`, `Info.plist`, `CoyoteBroadcast.entitlements`
- Modify: `mobile/ios/Coyote/Info.plist` (two keys), `mobile/ios/Coyote/Coyote.entitlements` (App Group)
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (new target, embed phase, dependency)
- Modify: `THIRD-PARTY-NOTICES.md`
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Consumes: react-native-webrtc's socket protocol (`ScreenCapturer.m`): each frame is a serialized HTTP response message whose headers carry `Content-Length`, `Buffer-Width`, `Buffer-Height`, `Buffer-Orientation` (a `CGImagePropertyOrientation` raw value) and whose body is the JPEG image. Task 3's app module listens for the Darwin notification `net.swiftirc.coyote.broadcast.started`.
- Produces: the `CoyoteBroadcast` app extension, embedded in Coyote.app.

The extension code follows the Jitsi Meet react-native-webrtc screen-sharing sample (Apache-2.0); it is rewritten here in reduced form (no `Atomic` wrapper, no stop notification) with two behaviour changes: "started" is posted only once the socket is connected, and the extension gives up after 5 s if no call is listening.

- [ ] **Step 1: Write the failing guard tests** — append to `mobile/test/nativeModules.test.ts`:

```ts
describe("iOS broadcast extension", () => {
  const ios = path.join(__dirname, "..", "ios");
  const read = (...p: string[]) => fs.readFileSync(path.join(ios, ...p), "utf8");
  const GROUP = "group.net.swiftirc.coyote";

  test("the app points react-native-webrtc at the App Group and the extension", () => {
    const plist = read("Coyote", "Info.plist");
    expect(plist).toMatch(/<key>RTCAppGroupIdentifier<\/key>\s*<string>group\.net\.swiftirc\.coyote<\/string>/);
    expect(plist).toMatch(/<key>RTCScreenSharingExtension<\/key>\s*<string>net\.swiftirc\.coyote\.broadcast<\/string>/);
  });

  test("app and extension share the App Group", () => {
    for (const f of [["Coyote", "Coyote.entitlements"], ["CoyoteBroadcast", "CoyoteBroadcast.entitlements"]]) {
      const e = read(...f);
      expect(e).toContain("com.apple.security.application-groups");
      expect(e).toContain(`<string>${GROUP}</string>`);
    }
    expect(read("CoyoteBroadcast", "SampleHandler.swift")).toContain(`"${GROUP}"`);
  });

  test("the extension is a sample-buffer broadcast upload extension", () => {
    const plist = read("CoyoteBroadcast", "Info.plist");
    expect(plist).toContain("com.apple.broadcast-services-upload");
    expect(plist).toContain("RPBroadcastProcessModeSampleBuffer");
    expect(plist).toContain("$(PRODUCT_MODULE_NAME).SampleHandler");
  });

  test("the extension speaks react-native-webrtc's socket protocol and posts started", () => {
    const up = read("CoyoteBroadcast", "SampleUploader.swift");
    for (const h of ["Content-Length", "Buffer-Width", "Buffer-Height", "Buffer-Orientation"]) expect(up).toContain(`"${h}"`);
    const sh = read("CoyoteBroadcast", "SampleHandler.swift");
    expect(sh).toContain('"rtc_SSFD"');
    expect(sh).toContain('"net.swiftirc.coyote.broadcast.started"');
  });

  test("the project builds, embeds and versions the extension with the app", () => {
    const pbx = read("Coyote.xcodeproj", "project.pbxproj");
    expect(pbx).toContain('productType = "com.apple.product-type.app-extension"');
    expect(pbx).toContain("PRODUCT_BUNDLE_IDENTIFIER = net.swiftirc.coyote.broadcast;");
    expect(pbx).toContain("CoyoteBroadcast.appex in Embed Foundation Extensions");
    expect(pbx).toContain("isa = PBXTargetDependency;");
    const versions = [...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((m) => m[1]);
    const builds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => m[1]);
    expect(versions.length).toBe(4);
    expect(new Set(versions).size).toBe(1);
    expect(builds.length).toBe(4);
    expect(new Set(builds).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/nativeModules.test.ts` — Expected: the five new tests FAIL.

- [ ] **Step 3: Extension sources**

Create `mobile/ios/CoyoteBroadcast/SocketConnection.swift`:

```swift
import Foundation

// Client end of react-native-webrtc's screen-capture Unix socket in the App Group
// container. Based on the Jitsi Meet broadcast extension sample (Apache-2.0).
final class SocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var streamHasSpaceAvailable: (() -> Void)?

  private let filePath: String
  private var socketHandle: Int32 = -1
  private var address: sockaddr_un?
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var networkQueue: DispatchQueue?
  private var shouldKeepRunning = false

  init?(filePath path: String) {
    filePath = path
    socketHandle = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socketHandle != -1 else { return nil }
    super.init()
  }

  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath), setupAddress(), connectSocket() else { return false }
    setupStreams()
    inputStream?.open()
    outputStream?.open()
    return true
  }

  func close() {
    unscheduleStreams()
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
  }

  func writeToStream(buffer: UnsafePointer<UInt8>, maxLength length: Int) -> Int {
    outputStream?.write(buffer, maxLength: length) ?? 0
  }
}

extension SocketConnection: StreamDelegate {
  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .openCompleted:
      if aStream == outputStream { didOpen?() }
    case .hasBytesAvailable:
      if aStream == inputStream {
        var buffer: UInt8 = 0
        let n = inputStream?.read(&buffer, maxLength: 1) ?? 0
        if n == 0 && inputStream?.streamStatus == .atEnd {
          close()
          didClose?(nil)
        }
      }
    case .hasSpaceAvailable:
      if aStream == outputStream { streamHasSpaceAvailable?() }
    case .errorOccurred:
      close()
      didClose?(aStream.streamError)
    default:
      break
    }
  }
}

private extension SocketConnection {
  func setupAddress() -> Bool {
    var addr = sockaddr_un()
    guard filePath.count < MemoryLayout.size(ofValue: addr.sun_path) else { return false }
    addr.sun_family = sa_family_t(AF_UNIX)
    _ = withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
      filePath.withCString { strncpy(ptr, $0, filePath.count) }
    }
    address = addr
    return true
  }

  func connectSocket() -> Bool {
    guard var addr = address else { return false }
    let status = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    return status == noErr
  }

  func setupStreams() {
    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &readStream, &writeStream)
    inputStream = readStream?.takeRetainedValue()
    inputStream?.delegate = self
    inputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    outputStream = writeStream?.takeRetainedValue()
    outputStream?.delegate = self
    outputStream?.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    scheduleStreams()
  }

  func scheduleStreams() {
    shouldKeepRunning = true
    networkQueue = DispatchQueue.global(qos: .userInitiated)
    networkQueue?.async { [weak self] in
      self?.inputStream?.schedule(in: .current, forMode: .common)
      self?.outputStream?.schedule(in: .current, forMode: .common)
      RunLoop.current.run()
      var isRunning = false
      repeat {
        isRunning = (self?.shouldKeepRunning ?? false) && RunLoop.current.run(mode: .default, before: .distantFuture)
      } while isRunning
    }
  }

  func unscheduleStreams() {
    networkQueue?.sync { [weak self] in
      self?.inputStream?.remove(from: .current, forMode: .common)
      self?.outputStream?.remove(from: .current, forMode: .common)
    }
    shouldKeepRunning = false
  }
}
```

Create `mobile/ios/CoyoteBroadcast/SampleUploader.swift`:

```swift
import CoreImage
import Foundation
import ReplayKit

// Encodes each video sample as a half-size JPEG framed as an HTTP message and
// writes it to the socket in chunks. One frame in flight at a time: frames that
// arrive while one is still being written are dropped. Half size and JPEG keep the
// extension under its 50 MB memory limit. Based on the Jitsi Meet sample (Apache-2.0).
final class SampleUploader {
  private static let chunkSize = 10240
  private static let imageContext = CIContext(options: nil)

  private let connection: SocketConnection
  private let queue = DispatchQueue(label: "net.swiftirc.coyote.broadcast.uploader")
  private let lock = NSLock()
  private var ready = false
  private var dataToSend: Data?
  private var byteIndex = 0

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.setReady(true) }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.queue.async {
        guard let self = self else { return }
        let sent = self.sendChunk()
        self.setReady(!sent)
      }
    }
  }

  @discardableResult
  func send(sample buffer: CMSampleBuffer) -> Bool {
    lock.lock()
    guard ready else {
      lock.unlock()
      return false
    }
    ready = false
    lock.unlock()
    let data = prepare(sample: buffer)
    queue.async { [weak self] in
      guard let self = self else { return }
      self.dataToSend = data
      self.byteIndex = 0
      if !self.sendChunk() { self.setReady(true) }
    }
    return true
  }

  private func setReady(_ value: Bool) {
    lock.lock()
    ready = value
    lock.unlock()
  }

  // Writes the next chunk; false when there was nothing (left) to send.
  private func sendChunk() -> Bool {
    guard let data = dataToSend else { return false }
    let left = data.count - byteIndex
    let length = min(left, SampleUploader.chunkSize)
    let written = data[byteIndex..<(byteIndex + length)].withUnsafeBytes { raw -> Int in
      guard let ptr = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
      return connection.writeToStream(buffer: ptr, maxLength: length)
    }
    if written > 0 {
      byteIndex += written
      if byteIndex >= data.count {
        dataToSend = nil
        byteIndex = 0
      }
    }
    return true
  }

  private func prepare(sample buffer: CMSampleBuffer) -> Data? {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }
    let scale: CGFloat = 0.5
    let width = Int(CGFloat(CVPixelBufferGetWidth(imageBuffer)) * scale)
    let height = Int(CGFloat(CVPixelBufferGetHeight(imageBuffer)) * scale)
    let orientation = (CMGetAttachment(buffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 0
    let image = CIImage(cvPixelBuffer: imageBuffer).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let colorSpace = image.colorSpace,
          let jpeg = SampleUploader.imageContext.jpegRepresentation(
            of: image, colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8])
    else { return nil }
    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }
}
```

Create `mobile/ios/CoyoteBroadcast/SampleHandler.swift`:

```swift
import ReplayKit

// The broadcast extension: connects to the Coyote app's screen-capture socket and
// streams every third video frame to it. Posts "started" once connected (the app
// waits for that to confirm the share); gives up after 5 s if no call is listening.
// Based on the Jitsi Meet sample (Apache-2.0).
class SampleHandler: RPBroadcastSampleHandler {
  private static let appGroup = "group.net.swiftirc.coyote"
  private static let startedNotification = "net.swiftirc.coyote.broadcast.started"
  private static let connectAttempts = 50 // × 100 ms

  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0
  private var connectTimer: DispatchSourceTimer?

  private var socketPath: String {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SampleHandler.appGroup)?
      .appendingPathComponent("rtc_SSFD").path ?? ""
  }

  override init() {
    super.init()
    if let c = SocketConnection(filePath: socketPath) {
      connection = c
      uploader = SampleUploader(connection: c)
      c.didClose = { [weak self] error in
        self?.finish(error?.localizedDescription ?? "Screen sharing stopped")
      }
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    var attempts = 0
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "net.swiftirc.coyote.broadcast.connect"))
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(50))
    timer.setEventHandler { [weak self] in
      guard let self = self else { return }
      attempts += 1
      if self.connection?.open() == true {
        timer.cancel()
        CFNotificationCenterPostNotification(
          CFNotificationCenterGetDarwinNotifyCenter(),
          CFNotificationName(SampleHandler.startedNotification as CFString), nil, nil, true)
      } else if attempts >= SampleHandler.connectAttempts {
        timer.cancel()
        self.finish("Start screen sharing from a Coyote call.")
      }
    }
    connectTimer = timer
    timer.resume()
  }

  override func broadcastFinished() {
    connectTimer?.cancel()
    connection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return } // video only: app and mic audio are ignored
    frameCount += 1
    if frameCount % 3 == 0 { uploader?.send(sample: sampleBuffer) }
  }

  private func finish(_ message: String) {
    finishBroadcastWithError(NSError(domain: RPRecordingErrorDomain, code: 10001, userInfo: [NSLocalizedDescriptionKey: message]))
  }
}
```

Create `mobile/ios/CoyoteBroadcast/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Coyote</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.broadcast-services-upload</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).SampleHandler</string>
		<key>RPBroadcastProcessMode</key>
		<string>RPBroadcastProcessModeSampleBuffer</string>
	</dict>
</dict>
</plist>
```

Create `mobile/ios/CoyoteBroadcast/CoyoteBroadcast.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.net.swiftirc.coyote</string>
	</array>
</dict>
</plist>
```

- [ ] **Step 4: App plist and entitlements**

In `mobile/ios/Coyote/Coyote.entitlements`, inside the top `<dict>` after the associated-domains array:

```xml
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.net.swiftirc.coyote</string>
	</array>
```

In `mobile/ios/Coyote/Info.plist`, inside the top-level `<dict>` (alphabetical position is not required; put them just before `UIBackgroundModes`):

```xml
	<key>RTCAppGroupIdentifier</key>
	<string>group.net.swiftirc.coyote</string>
	<key>RTCScreenSharingExtension</key>
	<string>net.swiftirc.coyote.broadcast</string>
```

- [ ] **Step 5: Add the target to `project.pbxproj`** (tabs for indentation). Object IDs below are fixed — use them verbatim.

PBXBuildFile section (append before `/* End PBXBuildFile section */`):

```
		C0B0AD132E00000000000001 /* CoyoteBroadcast.appex in Embed Foundation Extensions */ = {isa = PBXBuildFile; fileRef = C0B0AD032E00000000000001 /* CoyoteBroadcast.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };
		C0B0AD142E00000000000001 /* SampleHandler.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AD042E00000000000001 /* SampleHandler.swift */; };
		C0B0AD152E00000000000001 /* SocketConnection.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AD052E00000000000001 /* SocketConnection.swift */; };
		C0B0AD162E00000000000001 /* SampleUploader.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AD062E00000000000001 /* SampleUploader.swift */; };
```

A new section after `/* End PBXBuildFile section */`:

```
/* Begin PBXContainerItemProxy section */
		C0B0AD322E00000000000001 /* PBXContainerItemProxy */ = {
			isa = PBXContainerItemProxy;
			containerPortal = 83CBB9F71A601CBA00E9B192 /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = C0B0AD312E00000000000001;
			remoteInfo = CoyoteBroadcast;
		};
/* End PBXContainerItemProxy section */

/* Begin PBXCopyFilesBuildPhase section */
		C0B0AD242E00000000000001 /* Embed Foundation Extensions */ = {
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				C0B0AD132E00000000000001 /* CoyoteBroadcast.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXCopyFilesBuildPhase section */
```

PBXFileReference section (append before its End marker):

```
		C0B0AD032E00000000000001 /* CoyoteBroadcast.appex */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = CoyoteBroadcast.appex; sourceTree = BUILT_PRODUCTS_DIR; };
		C0B0AD042E00000000000001 /* SampleHandler.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SampleHandler.swift; sourceTree = "<group>"; };
		C0B0AD052E00000000000001 /* SocketConnection.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SocketConnection.swift; sourceTree = "<group>"; };
		C0B0AD062E00000000000001 /* SampleUploader.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SampleUploader.swift; sourceTree = "<group>"; };
		C0B0AD092E00000000000001 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
		C0B0AD0A2E00000000000001 /* CoyoteBroadcast.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = CoyoteBroadcast.entitlements; sourceTree = "<group>"; };
```

PBXFrameworksBuildPhase section (append):

```
		C0B0AD222E00000000000001 /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
```

PBXGroup section — a new group (append):

```
		C0B0AD512E00000000000001 /* CoyoteBroadcast */ = {
			isa = PBXGroup;
			children = (
				C0B0AD042E00000000000001 /* SampleHandler.swift */,
				C0B0AD052E00000000000001 /* SocketConnection.swift */,
				C0B0AD062E00000000000001 /* SampleUploader.swift */,
				C0B0AD092E00000000000001 /* Info.plist */,
				C0B0AD0A2E00000000000001 /* CoyoteBroadcast.entitlements */,
			);
			path = CoyoteBroadcast;
			sourceTree = "<group>";
		};
```

and in the main group `83CBB9F61A601CBA00E9B192` `children`, after `13B07FAE1A68108700A75B9A /* Coyote */,`:

```
				C0B0AD512E00000000000001 /* CoyoteBroadcast */,
```

and in the `Products` group children, after `Coyote.app`:

```
				C0B0AD032E00000000000001 /* CoyoteBroadcast.appex */,
```

PBXNativeTarget section — in the Coyote target, insert into `buildPhases` right after `13B07F8E1A680F5B00A75B9A /* Resources */,` (before the script phases, which avoids Xcode's "Cycle inside Coyote" error):

```
				C0B0AD242E00000000000001 /* Embed Foundation Extensions */,
```

and set its `dependencies`:

```
			dependencies = (
				C0B0AD332E00000000000001 /* PBXTargetDependency */,
			);
```

Then append the new target before `/* End PBXNativeTarget section */`:

```
		C0B0AD312E00000000000001 /* CoyoteBroadcast */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = C0B0AD432E00000000000001 /* Build configuration list for PBXNativeTarget "CoyoteBroadcast" */;
			buildPhases = (
				C0B0AD212E00000000000001 /* Sources */,
				C0B0AD222E00000000000001 /* Frameworks */,
				C0B0AD232E00000000000001 /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = CoyoteBroadcast;
			productName = CoyoteBroadcast;
			productReference = C0B0AD032E00000000000001 /* CoyoteBroadcast.appex */;
			productType = "com.apple.product-type.app-extension";
		};
```

PBXProject: in `TargetAttributes` add

```
					C0B0AD312E00000000000001 = {
						CreatedOnToolsVersion = 16.0;
					};
```

and in `targets` add `C0B0AD312E00000000000001 /* CoyoteBroadcast */,` after the Coyote entry.

PBXResourcesBuildPhase section (append):

```
		C0B0AD232E00000000000001 /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
```

PBXSourcesBuildPhase section (append):

```
		C0B0AD212E00000000000001 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				C0B0AD142E00000000000001 /* SampleHandler.swift in Sources */,
				C0B0AD152E00000000000001 /* SocketConnection.swift in Sources */,
				C0B0AD162E00000000000001 /* SampleUploader.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
```

A new section after `/* End PBXSourcesBuildPhase section */`:

```
/* Begin PBXTargetDependency section */
		C0B0AD332E00000000000001 /* PBXTargetDependency */ = {
			isa = PBXTargetDependency;
			target = C0B0AD312E00000000000001 /* CoyoteBroadcast */;
			targetProxy = C0B0AD322E00000000000001 /* PBXContainerItemProxy */;
		};
/* End PBXTargetDependency section */
```

XCBuildConfiguration section (append two):

```
		C0B0AD412E00000000000001 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				APPLICATION_EXTENSION_API_ONLY = YES;
				CLANG_ENABLE_MODULES = YES;
				CODE_SIGN_ENTITLEMENTS = CoyoteBroadcast/CoyoteBroadcast.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 6;
				INFOPLIST_FILE = CoyoteBroadcast/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.3.0;
				PRODUCT_BUNDLE_IDENTIFIER = net.swiftirc.coyote.broadcast;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
				VERSIONING_SYSTEM = "apple-generic";
			};
			name = Debug;
		};
		C0B0AD422E00000000000001 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				APPLICATION_EXTENSION_API_ONLY = YES;
				CLANG_ENABLE_MODULES = YES;
				CODE_SIGN_ENTITLEMENTS = CoyoteBroadcast/CoyoteBroadcast.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 6;
				INFOPLIST_FILE = CoyoteBroadcast/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.3.0;
				PRODUCT_BUNDLE_IDENTIFIER = net.swiftirc.coyote.broadcast;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
				VERSIONING_SYSTEM = "apple-generic";
			};
			name = Release;
		};
```

(Versions match the app's current 1.3.0 / 6 here; Task 6 bumps all four configurations together.)

XCConfigurationList section (append):

```
		C0B0AD432E00000000000001 /* Build configuration list for PBXNativeTarget "CoyoteBroadcast" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				C0B0AD412E00000000000001 /* Debug */,
				C0B0AD422E00000000000001 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
```

Sanity-check the file: every `C0B0AD…` ID referenced is defined exactly once:

```bash
cd mobile/ios && for id in $(grep -o 'C0B0AD[0-9A-F]\{18\}' Coyote.xcodeproj/project.pbxproj | sort -u); do n=$(grep -c "^\s*$id .*= {" Coyote.xcodeproj/project.pbxproj); [ "$n" = 1 ] || echo "BAD $id defined $n times"; done; echo checked
```

Expected: only `checked`. Also confirm braces balance: `python3 -c "s=open('Coyote.xcodeproj/project.pbxproj').read(); print(s.count('{')-s.count('}'), s.count('(')-s.count(')'))"` → `0 0`.

- [ ] **Step 6: Notices** — in `THIRD-PARTY-NOTICES.md`, under "## Bundled in the repository, and therefore in every binary", add after the MediaPipe entry:

```markdown
### Screen-sharing broadcast extension — `mobile/ios/CoyoteBroadcast/`

`SampleHandler.swift`, `SocketConnection.swift` and `SampleUploader.swift` are adapted
from the screen-sharing broadcast extension sample in Jitsi Meet
(<https://github.com/jitsi/jitsi-meet>, `ios/broadcast-extension/`), Copyright © 8x8,
Inc., licensed under the Apache License 2.0
(<https://www.apache.org/licenses/LICENSE-2.0>). Changes: reduced to video only,
"started" posted once the socket connects, gives up when no call is listening, no
`Atomic` helper.
```

- [ ] **Step 7: Verify**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint` — Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/ios/CoyoteBroadcast mobile/ios/Coyote/Info.plist mobile/ios/Coyote/Coyote.entitlements mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/test/nativeModules.test.ts THIRD-PARTY-NOTICES.md
git commit -m "feat(mobile): iOS CoyoteBroadcast extension streams the screen to the call"
```

---

### Task 5: UI — ☰ row, sharing pill, own-share tile

**Files:**
- Create: `mobile/src/ui/components/SharingPill.tsx`, `mobile/src/ui/components/OwnShareTile.tsx`
- Modify: `mobile/src/ui/hooks.ts`, `mobile/src/ui/components/MoreSheet.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `call.screenShare` (Task 2), `ShareSnapshot`/`ShareStatus` (Task 1), `GridTile` `own-screen` (Task 2).
- Produces: `useScreenShare(): ShareSnapshot`; `MoreSheet` props `share: ShareStatus; onShare(): void; onStopShare(): void`.

There is no component-test harness in this project (tests cover `core/` only); this task is verified by typecheck, lint and the manual checklist (Task 6). Keep the components small.

- [ ] **Step 1: Hook** — in `mobile/src/ui/hooks.ts` add `import type { ShareSnapshot } from "../core/screenShare";` and:

```ts
const EMPTY_SHARE: ShareSnapshot = { status: "idle" };

export function useScreenShare(): ShareSnapshot {
  const { call } = useCall();
  return useStore(call()?.screenShare ?? null, EMPTY_SHARE);
}
```

- [ ] **Step 2: Pill** — create `mobile/src/ui/components/SharingPill.tsx`:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme";

// Always-visible way to stop your own screenshare, just above the controls.
export function SharingPill({ bottom, onStop }: { bottom: number; onStop(): void }) {
  return (
    <Pressable
      onPress={onStop}
      accessibilityRole="button"
      accessibilityLabel="Stop sharing your screen"
      style={[styles.pill, { bottom }]}
    >
      <Text style={styles.text}>Sharing your screen · Stop</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { position: "absolute", alignSelf: "center", backgroundColor: colors.danger, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18 },
  text: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
```

- [ ] **Step 3: Own tile** — create `mobile/src/ui/components/OwnShareTile.tsx`:

```tsx
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

// Stands in for your own screenshare: a preview would show the call inside itself.
export const OwnShareTile = memo(function OwnShareTileView({ width, height }: { width: number; height: number }) {
  return (
    <View style={[styles.tile, { width, height }]} accessible accessibilityLabel="You're sharing your screen">
      <Text style={styles.text}>📱 You're sharing your screen</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: "#000", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.bg, padding: 8 },
  text: { color: colors.muted, textAlign: "center" },
});
```

- [ ] **Step 4: ☰ row** — in `mobile/src/ui/components/MoreSheet.tsx`:

- `import type { ShareStatus } from "../../core/screenShare";`
- Add `share, onShare, onStopShare` to the destructured props and `share: ShareStatus; onShare(): void; onStopShare(): void;` to the props type.
- In the main view, right after the `Hide self-view` `<Toggle … />` and before `{isOp ? (`:

```tsx
        <Pressable
          onPress={share === "sharing" ? onStopShare : onShare}
          disabled={share === "starting"}
          accessibilityRole="button"
          accessibilityState={{ disabled: share === "starting" }}
          style={styles.row2}
        >
          <Text style={[styles.saveText, share === "starting" && { color: colors.muted }]}>
            {share === "sharing" ? "Stop sharing" : share === "starting" ? "Starting…" : "Share screen"}
          </Text>
        </Pressable>
```

- [ ] **Step 5: Call screen** — in `mobile/src/ui/screens/Call.tsx`:

- Imports: add `useScreenShare` to the `../hooks` import; `import { SharingPill } from "../components/SharingPill";` and `import { OwnShareTile } from "../components/OwnShareTile";`.
- After `const mod = useModeration();`: `const share = useScreenShare();`
- `const tiles = gridTiles(people, share.status === "sharing");`
- Replace the Task 2 `t.kind === "own-screen" ? null` with `<OwnShareTile key={t.key} width={tileW} height={tileH} />`:

```tsx
            tiles.map((t) => t.kind === "own-screen"
              ? <OwnShareTile key={t.key} width={tileW} height={tileH} />
              : t.kind === "screen"
```

- Right after `<Banner … />`:

```tsx
        {share.status === "sharing" ? (
          <SharingPill bottom={CONTROLS_H + 8} onStop={() => call()?.screenShare.stop("user")} />
        ) : null}
```

- `MoreSheet` gets:

```tsx
          share={share.status}
          onShare={() => { setSheet(null); call()?.screenShare.start().catch(warn("screen share")); }}
          onStopShare={() => { setSheet(null); call()?.screenShare.stop("user"); }}
```

- [ ] **Step 6: Verify**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): share screen from ☰, a stop pill and your own share tile"
```

---

### Task 6: 1.4.0 version bump, release notes, manual checklist

**Files:**
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (four configurations)
- Modify: `mobile/android/app/build.gradle`
- Modify: `mobile/RELEASE.md`, `mobile/MANUAL-TEST.md`

- [ ] **Step 1: Bump** — in `project.pbxproj` change every `MARKETING_VERSION = 1.3.0;` to `MARKETING_VERSION = 1.4.0;` and every `CURRENT_PROJECT_VERSION = 6;` to `CURRENT_PROJECT_VERSION = 7;` (four each: app Debug/Release, extension Debug/Release). In `android/app/build.gradle`: `versionCode 7`, `versionName "1.4.0"`.

```bash
cd mobile && sed -i 's/MARKETING_VERSION = 1\.3\.0;/MARKETING_VERSION = 1.4.0;/; s/CURRENT_PROJECT_VERSION = 6;/CURRENT_PROJECT_VERSION = 7;/' ios/Coyote.xcodeproj/project.pbxproj && grep -c "MARKETING_VERSION = 1.4.0;" ios/Coyote.xcodeproj/project.pbxproj
```

Expected: `4`.

- [ ] **Step 2: RELEASE.md** — in "One-time setup (Mac)", replace the Apple Developer bullet with:

```markdown
- Apple Developer team with:
  - the App ID `net.swiftirc.coyote` and these capabilities: Associated Domains,
    Background Modes (Audio; Voice over IP), **App Groups** (`group.net.swiftirc.coyote`);
  - the App ID `net.swiftirc.coyote.broadcast` (the screen-sharing extension) with
    **App Groups** (`group.net.swiftirc.coyote`);
  - the App Group `group.net.swiftirc.coyote` itself (Identifiers → App Groups).
  With automatic signing, Xcode creates both provisioning profiles once you select your
  team on **both** the Coyote and CoyoteBroadcast targets.
```

In "## Version", change the iOS line to:

```markdown
- iOS: `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `ios/Coyote.xcodeproj/project.pbxproj`
  — four places each (Coyote and CoyoteBroadcast, Debug and Release); they must match.
```

In "## iOS → TestFlight", change "Select your team on the Coyote target" to "Select your team on the Coyote and CoyoteBroadcast targets".

- [ ] **Step 3: MANUAL-TEST.md** — append:

```markdown
## Screenshare sending (1.4.0)

Run with the phone in a call with a browser (and a second phone if available).

46. **iOS share.** ☰ → Share screen: the system "Screen Broadcast" sheet opens with
    Coyote selected. Start Broadcast; after the countdown the red pill "Sharing your
    screen · Stop" shows and a "You're sharing your screen" tile appears first in the
    grid. The browser shows the phone's screen tile within a few seconds. Switch to
    another app: the browser follows it; the phone's camera turns off while away and
    comes back on return.
47. **iOS cancel.** ☰ → Share screen, then dismiss the sheet: within 30 s the ☰ row
    reads "Share screen" again, and no error notice appears.
48. **iOS stop from the system.** While sharing, stop via Control Center (or the red
    status-bar pill): the phone's pill and tile disappear; the browser's tile goes.
49. **Stop from the app.** Tap the pill: the share ends everywhere (iOS shows its
    "Screen sharing stopped" alert). Repeat from ☰ → Stop sharing.
50. **Android share.** ☰ → Share screen: the "Start recording or casting?" prompt;
    Start → pill, own tile and the browser sees the screen; a "screen sharing"
    notification is shown. On Android 15+, choose "A single app" and confirm only
    that app is shared.
51. **Android denied.** ☰ → Share screen → Cancel: back to "Share screen", no notice.
52. **Android stop from the system.** Stop from the notification / status-bar chip:
    the share ends in the app and the browser.
53. **Op stops the share.** The browser op stops the phone's share: the phone shows
    "An op stopped your screen share." and the share ends.
54. **Reconnect mid-share.** While sharing, airplane mode for ~10 s, then off: the
    phone rejoins and the browser sees the screen again without re-sharing.
55. **Quality.** A browser op sets Screen quality to Low: the phone's share visibly
    drops; back to Auto.
56. **Leave while sharing.** Leave the call: the share ends (iOS broadcast stops,
    Android notification goes).
57. **Extension without a call (iOS).** Start a broadcast to Coyote from Control
    Center with no call open: it ends within ~5 s with "Start screen sharing from a
    Coyote call."
```

- [ ] **Step 4: Verify**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint` — Expected: all PASS (the version guard from Task 4 sees four matching 1.4.0 / 7 pairs).

- [ ] **Step 5: Commit**

```bash
git add mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/android/app/build.gradle mobile/RELEASE.md mobile/MANUAL-TEST.md
git commit -m "chore(mobile): 1.4.0 (build 7) with the screenshare checklist and App Group setup"
```
