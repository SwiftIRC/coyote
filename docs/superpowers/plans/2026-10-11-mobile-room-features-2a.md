# Mobile Room Features — Release 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship app 1.1.0 with chat (replay, tappable links), rename, screenshare viewing, join/leave/share chimes and a room timer.

**Architecture:** Small feature stores (`ChatLog`, `RoomClock`, `Chimes`) live beside `Call` in `mobile/src/core/`, each with `subscribe()`/`getSnapshot()`, fed by `Call` from signaling frames and reset on every `joined`. The UI reads them through `useSyncExternalStore` hooks, so chat never re-renders the video grid. Sound plays through a new in-house native module, `CoyoteSounds`, that never touches the audio session.

**Tech Stack:** React Native 0.87 (New Architecture), TypeScript, Jest, react-native-webrtc 124, Swift (iOS) and Kotlin (Android) for `CoyoteSounds`. Shared DOM-free web modules from `internal/web/assets/lib/`.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-room-features-design.md` (2a scope only; 2b — polls, soundboard, per-participant volume, Data saver, Hide self-view — gets its own plan).

## Global Constraints

- Wire protocol unchanged; no server change in 2a.
- No new third-party dependencies (JS or native). Sheets, sliders and pinch-zoom use `Animated` / `PanResponder`.
- `CoyoteSounds` must never set the audio category or mode and never activate the audio session.
- App stays portrait-locked.
- Chat: max 2000 characters, trimmed, empty not sent, no local echo, log capped at 500 entries, unread shows "99+" past 99.
- Rename: max 24 characters, trimmed, empty or unchanged not sent.
- Room timer counts from `joined.roomAge` (seconds) with the local clock; format via shared `formatDuration`; hidden if `roomAge` is absent.
- Chimes: `join` = `door_open.mp3`, `drop` = `sounds_drop.mp3`, `bloop` = `sounds_bloop.mp3`; join/leave via shared `Presence` keyed by `ref` (6 s deferred drop); no chime on reconnect or when joining a busy room; bloop when a participant's screen share first appears, not again after a rejoin.
- Every screen respects safe-area insets (Android 15+ edge-to-edge).
- Commit messages: Conventional Commits style as in `git log`; no Co-Authored-By trailer.
- Verification commands (run from `mobile/`): `npx jest`, `npm run -s typecheck`, `npx eslint src test`.
- Version for this release: 1.1.0, iOS build 4, Android versionCode 4.

## Review Focus

1. **Reconnect mid-call:** chat replay must not duplicate lines, chimes must stay silent, the screen-share bloop must not replay, the timer must re-anchor. (Tests in Tasks 3, 5, 6.)
2. **Sending while disconnected:** chat text and a rename attempted during "reconnecting" must not vanish silently — the user sees "Not connected — message not sent" and the text stays in the box. (Tests in Tasks 3 and 6.)
3. **Hostile or odd chat text:** `javascript:` links, URLs with trailing punctuation or parentheses, 2000-character lines, emoji and RTL text must render as plain text with only http(s)/www links tappable. (Test in Task 3 via shared `linkSegments`; Task 10 renders segments only.)
4. **Share stops while the full-screen viewer is open:** the viewer must close itself rather than show a frozen or black frame. (Logic test in Task 8: `screenFor` returns null once slots clear; Task 12 closes on null.)
5. **Self-rename echo and locked names:** your own `peer-renamed` updates the header/menu and saved name only after the server confirms; a name locked by an invite/token is never saved as your default. (Tests in Task 6.)

---

## File structure

**Create**
- `mobile/src/core/chat.ts` — `ChatLog` store: entries, unread, open flag, send validation.
- `mobile/src/core/chatText.ts` — `moderationText()` and `hhmm()` (ported from the DOM-bound `ui/chat.js`).
- `mobile/src/core/roomClock.ts` — `RoomClock` store.
- `mobile/src/core/chimes.ts` — `Chimes` (wraps shared `Presence`, screen-share bloop) and `ChimeName`.
- `mobile/src/core/tiles.ts` — `gridTiles()`, `screenFor()` pure helpers for the grid.
- `mobile/src/native/sounds.ts` — JS wrapper for `CoyoteSounds`.
- `mobile/src/native/volume.ts` — `setStreamVolume()` over react-native-webrtc `_setVolume`.
- `mobile/src/ui/hooks.ts` — `useStore`, `useChat`, `useRoomClock`, `useElapsed`.
- `mobile/src/ui/components/TopBar.tsx`, `ChatSheet.tsx`, `MoreSheet.tsx`, `ScreenTile.tsx`, `ScreenViewer.tsx`, `Slider.tsx`, `Sheet.tsx`.
- `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteSoundsModule.kt`, `CoyoteSoundsPackage.kt`.
- `mobile/android/app/src/main/res/raw/door_open.mp3`, `sounds_drop.mp3`, `sounds_bloop.mp3` (copies).
- `mobile/ios/Coyote/CoyoteSounds.swift`, `mobile/ios/Coyote/CoyoteSounds.m`.
- `mobile/ios/Coyote/Sounds/door_open.mp3`, `sounds_drop.mp3`, `sounds_bloop.mp3` (copies).
- Tests: `mobile/test/chat.test.ts`, `roomClock.test.ts`, `chimes.test.ts`, `tiles.test.ts`, `chimeFiles.test.ts`.

**Modify**
- `mobile/src/shared/web.ts`, `mobile/test/shared.test.ts` — new shared exports.
- `mobile/src/core/roster.ts`, `mobile/test/roster.test.ts` — screen slots, `refOf`.
- `mobile/src/core/call.ts`, `mobile/test/call.test.ts` — stores, routing, rename, `name` in state.
- `mobile/src/native/callFactory.ts` — new deps.
- `mobile/src/ui/CallContext.tsx` — save confirmed self-rename.
- `mobile/src/ui/screens/Call.tsx`, `components/Controls.tsx`, `components/SelfView.tsx`, `components/Banner.tsx`.
- `mobile/android/.../MainApplication.kt`, `mobile/ios/Coyote.xcodeproj/project.pbxproj`.
- `mobile/test/nativeModules.test.ts` — `CoyoteSounds` contract.
- `mobile/MANUAL-TEST.md`, `mobile/android/app/build.gradle`, `project.pbxproj` (version).
- `docs/superpowers/specs/2026-10-11-mobile-room-features-design.md` — two small corrections (Task 13).

---

### Task 1: Shared web modules for chat, timer and chimes

**Files:**
- Modify: `mobile/src/shared/web.ts`
- Test: `mobile/test/shared.test.ts`

**Interfaces:**
- Produces: `linkSegments(text: string): Array<{ text: string; href?: string }>`, `formatDuration(sec: number): string`, `Presence` class (`new Presence({ onJoinChime, onDropChime, graceMs, timers })`, methods `seed(peers)`, `joined(ref)`, `left(ref)`, `clear()`), all re-exported from `src/shared/web.ts`.

- [ ] **Step 1: Write the failing test** — append to `mobile/test/shared.test.ts`:

```ts
import { formatDuration, linkSegments, Presence } from "../src/shared/web";

test("room-feature modules load: linkify, duration, presence", () => {
  expect(linkSegments("see https://x.io/a). ok")).toEqual([
    { text: "see " }, { text: "https://x.io/a", href: "https://x.io/a" }, { text: "). ok" },
  ]);
  expect(linkSegments("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
  expect(linkSegments("www.example.com")).toEqual([{ text: "www.example.com", href: "https://www.example.com" }]);
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(3661)).toBe("1:01:01");
  let joins = 0;
  // presence.js defaults `timers` to globalThis, so allowJs infers that type; a plain
  // {setTimeout, clearTimeout} is all it uses.
  const p = new Presence({ onJoinChime: () => joins++, timers: { setTimeout, clearTimeout } as unknown as typeof globalThis });
  p.seed([{ ref: "a" }]);
  p.joined("a");
  expect(joins).toBe(0);
  p.joined("b");
  expect(joins).toBe(1);
  p.clear();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest test/shared.test.ts`
Expected: FAIL — `linkSegments` (and the others) are not exported from `../src/shared/web`.

- [ ] **Step 3: Add the exports** — append to `mobile/src/shared/web.ts`:

```ts
export { linkSegments } from "../../../internal/web/assets/lib/linkify.js";
export { formatDuration } from "../../../internal/web/assets/lib/duration.js";
export { Presence } from "../../../internal/web/assets/lib/presence.js";
```

- [ ] **Step 4: Run tests and type check**

Run: `cd mobile && npx jest test/shared.test.ts && npm run -s typecheck`
Expected: PASS, no type errors (`tsconfig.json` has `allowJs: true`, `checkJs: false`, so types are inferred from the JS, as for the existing re-exports).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/shared/web.ts mobile/test/shared.test.ts
git commit -m "feat(mobile): share linkify, duration and presence from the web client"
```

---

### Task 2: Roster screen slots and ref lookup

**Files:**
- Modify: `mobile/src/core/roster.ts`
- Test: `mobile/test/roster.test.ts`

**Interfaces:**
- Produces: `Participant` gains `screen: StreamLike | null` and `screenAudio: StreamLike | null`. `Roster.setStream(id, kind: "camera" | "mic" | "screen" | "screen-audio", stream)`. `Roster.refOf(id: string): string` (`""` if unknown). `Roster.get(id: string): Participant | undefined`.

- [ ] **Step 1: Write the failing tests** — append to `mobile/test/roster.test.ts`:

```ts
test("screen and screen-audio have their own slots, kept across upsert, dropped on seed", () => {
  const r = new Roster();
  r.upsert(info("a", { ref: "ra" }));
  const scr = new FakeStream([]);
  const sa = new FakeStream([]);
  r.setStream("a", "screen", scr);
  r.setStream("a", "screen-audio", sa);
  expect(r.list()[0]).toMatchObject({ screen: scr, screenAudio: sa, video: null, audio: null });
  r.upsert(info("a", { ref: "ra", name: "New" }));
  expect(r.list()[0]).toMatchObject({ screen: scr, screenAudio: sa });
  r.setStream("a", "screen", null);
  expect(r.list()[0].screen).toBeNull();
  r.seed([info("a")]);
  expect(r.list()[0]).toMatchObject({ screen: null, screenAudio: null });
});

test("refOf and get look participants up by id", () => {
  const r = new Roster();
  r.upsert(info("a", { ref: "ra" }));
  expect(r.refOf("a")).toBe("ra");
  expect(r.refOf("nope")).toBe("");
  expect(r.get("a")?.name).toBe("A");
  expect(r.get("nope")).toBeUndefined();
});

test("an early screen stream is attached when its participant arrives", () => {
  const r = new Roster();
  const scr = new FakeStream([]);
  r.setStream("late", "screen", scr);
  r.upsert(info("late"));
  expect(r.list()[0].screen).toBe(scr);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/roster.test.ts`
Expected: FAIL — type error / `screen` undefined / `refOf is not a function`.

- [ ] **Step 3: Implement** — in `mobile/src/core/roster.ts`:

Replace the `Participant` interface's last two fields and the slot helpers:

```ts
export interface Participant {
  id: string;
  name: string;
  role: string;
  mic: boolean;
  camera: boolean;
  ref: string;
  gravatar: string;
  video: StreamLike | null;
  audio: StreamLike | null;
  screen: StreamLike | null;
  screenAudio: StreamLike | null;
}

export type StreamKind = "camera" | "mic" | "screen" | "screen-audio";
type StreamSlot = "video" | "audio" | "screen" | "screenAudio";
const SLOT: Record<StreamKind, StreamSlot> = { camera: "video", mic: "audio", screen: "screen", "screen-audio": "screenAudio" };
```

Change `setStream` to use the map:

```ts
  setStream(id: string, kind: StreamKind, stream: StreamLike | null): void {
    const slot = SLOT[kind];
    const p = this.map.get(id);
    if (!p) {
      if (stream) this.early.set(id, { ...this.early.get(id), [slot]: stream });
      return;
    }
    this.map.set(id, { ...p, [slot]: stream });
    this.notify();
  }

  get(id: string): Participant | undefined {
    return this.map.get(id);
  }

  refOf(id: string): string {
    return this.map.get(id)?.ref || "";
  }
```

In `fromInfo`, add the two new slots after `audio`:

```ts
      screen: early?.screen ?? prev?.screen ?? null,
      screenAudio: early?.screenAudio ?? prev?.screenAudio ?? null,
```

- [ ] **Step 4: Run tests and type check**

Run: `cd mobile && npx jest test/roster.test.ts && npm run -s typecheck`
Expected: PASS. (Existing callers pass `"camera" | "mic"`, which is still valid.)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/roster.ts mobile/test/roster.test.ts
git commit -m "feat(mobile): roster slots for screen and screen-audio, refOf lookup"
```

---

### Task 3: ChatLog store

**Files:**
- Create: `mobile/src/core/chatText.ts`, `mobile/src/core/chat.ts`
- Test: `mobile/test/chat.test.ts`

**Interfaces:**
- Produces (`chatText.ts`): `moderationText(m: { actor?: string; action?: string; target?: string; kind?: string }): string`, `hhmm(tsSeconds: number, nowMs: number): string`.
- Produces (`chat.ts`):
  - `type Sender = (type: string, fields: Record<string, unknown>) => boolean` — returns false if not connected.
  - `type ChatEntry = { key: number; kind: "message"; from: string; text: string; ts: number } | { key: number; kind: "system"; text: string; ts: number }` (`ts` in unix seconds).
  - `interface ChatSnapshot { entries: ChatEntry[]; unread: number; open: boolean }`.
  - `type SendResult = "sent" | "empty" | "too-long" | "offline"`.
  - `const CHAT_MAX = 2000`, `const LOG_MAX = 500`.
  - `class ChatLog { constructor(send: Sender, nowMs: () => number); onChat(m: Frame): void; onModeration(m: Frame): void; notice(text: string): void; clear(): void; setOpen(open: boolean): void; send(text: string): SendResult; subscribe(fn: () => void): () => void; getSnapshot(): ChatSnapshot }`.
  - `unreadLabel(n: number): string` — `""` for 0, `"99+"` past 99.

- [ ] **Step 1: Write the failing tests** — create `mobile/test/chat.test.ts`:

```ts
import { ChatLog, CHAT_MAX, LOG_MAX, unreadLabel } from "../src/core/chat";
import { hhmm, moderationText } from "../src/core/chatText";

function make(connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const log = new ChatLog((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => 1_700_000_000_000);
  return { log, sent };
}

test("chat frames append in order; snapshot identity changes only on change", () => {
  const { log } = make();
  const s0 = log.getSnapshot();
  expect(log.getSnapshot()).toBe(s0);
  log.onChat({ type: "chat", from: "Alice", text: "hi", ts: 10 });
  log.onChat({ type: "chat", from: "Bob", text: "yo", ts: 11 });
  const s1 = log.getSnapshot();
  expect(s1).not.toBe(s0);
  expect(s1.entries.map((e) => (e.kind === "message" ? `${e.from}:${e.text}` : e.text))).toEqual(["Alice:hi", "Bob:yo"]);
  expect(new Set(s1.entries.map((e) => e.key)).size).toBe(2);
});

test("unread counts messages while closed, opening zeroes it, open keeps it at 0", () => {
  const { log } = make();
  log.onChat({ type: "chat", from: "A", text: "1", ts: 1 });
  log.onChat({ type: "chat", from: "A", text: "2", ts: 2 });
  expect(log.getSnapshot().unread).toBe(2);
  log.setOpen(true);
  expect(log.getSnapshot()).toMatchObject({ unread: 0, open: true });
  log.onChat({ type: "chat", from: "A", text: "3", ts: 3 });
  expect(log.getSnapshot().unread).toBe(0);
  log.setOpen(false);
  log.onModeration({ type: "moderation", actor: "Op", action: "lock" });
  log.notice("Something went wrong");
  expect(log.getSnapshot().unread).toBe(0); // system lines never count
});

test("system lines: moderation text and notices", () => {
  const { log } = make();
  log.onModeration({ type: "moderation", actor: "Op", action: "kick", target: "Bob" });
  log.notice("Room is full");
  const texts = log.getSnapshot().entries.map((e) => e.text);
  expect(texts).toEqual(["Op kicked Bob", "Room is full"]);
  expect(log.getSnapshot().entries.every((e) => e.kind === "system")).toBe(true);
});

test("the log keeps at most LOG_MAX entries, dropping the oldest", () => {
  const { log } = make();
  for (let i = 0; i < LOG_MAX + 5; i++) log.onChat({ type: "chat", from: "A", text: String(i), ts: i });
  const e = log.getSnapshot().entries;
  expect(e).toHaveLength(LOG_MAX);
  expect(e[0].text).toBe("5");
});

test("clear empties the log and unread (rejoin: the server replays history)", () => {
  const { log } = make();
  log.onChat({ type: "chat", from: "A", text: "x", ts: 1 });
  log.clear();
  expect(log.getSnapshot()).toMatchObject({ entries: [], unread: 0 });
  log.onChat({ type: "chat", from: "A", text: "x", ts: 1 }); // replay
  expect(log.getSnapshot().entries).toHaveLength(1);
});

test("send trims, refuses empty and over-long, reports offline, never echoes locally", () => {
  const { log, sent } = make();
  expect(log.send("   ")).toBe("empty");
  expect(log.send("x".repeat(CHAT_MAX + 1))).toBe("too-long");
  expect(log.send("  hello  ")).toBe("sent");
  expect(sent).toEqual([{ type: "chat", fields: { text: "hello" } }]);
  expect(log.getSnapshot().entries).toEqual([]);
  expect(log.send("😀".repeat(CHAT_MAX))).toBe("sent"); // counted in code points, like the server's runes
  const off = make(false);
  expect(off.log.send("hello")).toBe("offline");
});

test("hostile text stays plain: no non-http link is ever produced downstream", () => {
  const { log } = make();
  log.onChat({ type: "chat", from: "<b>x</b>", text: "javascript:alert(1) <script>", ts: 1 });
  const e = log.getSnapshot().entries[0];
  expect(e).toMatchObject({ kind: "message", from: "<b>x</b>", text: "javascript:alert(1) <script>" });
});

test("unreadLabel", () => {
  expect(unreadLabel(0)).toBe("");
  expect(unreadLabel(7)).toBe("7");
  expect(unreadLabel(100)).toBe("99+");
});

test("moderationText matches the web wording", () => {
  expect(moderationText({ actor: "Op", action: "mute", target: "Bob", kind: "camera" })).toBe("Op muted Bob (camera)");
  expect(moderationText({ actor: "Op", action: "quality", target: "camera", kind: "low" })).toBe("Op set camera quality to Low");
  expect(moderationText({ action: "unlock" })).toBe("someone unlocked the room");
  expect(moderationText({ actor: "Op", action: "poll-open" })).toBe("Op started a poll");
  expect(moderationText({ actor: "Op", action: "zap", target: "Bob" })).toBe("Op zap Bob");
});

test("hhmm formats local time and falls back to now for a missing ts", () => {
  const d = new Date(2026, 0, 2, 9, 5);
  expect(hhmm(d.getTime() / 1000, 0)).toBe("09:05");
  expect(hhmm(0, d.getTime())).toBe("09:05");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/chat.test.ts`
Expected: FAIL — cannot find module `../src/core/chat`.

- [ ] **Step 3: Implement `chatText.ts`** — create `mobile/src/core/chatText.ts`:

```ts
// Ported from internal/web/assets/ui/chat.js (DOM-bound there, so not importable).
// Keep the wording identical to the web client.

export function moderationText(m: { actor?: string; action?: string; target?: string; kind?: string }): string {
  const { actor, action, target, kind } = m;
  const who = actor || "someone";
  switch (action) {
    case "kick":
      return `${who} kicked ${target || "a participant"}`;
    case "ban":
      return `${who} banned ${target || "a participant"}`;
    case "mute":
      return kind ? `${who} muted ${target || "a participant"} (${kind})` : `${who} muted ${target || "a participant"}`;
    case "lock":
      return `${who} locked the room`;
    case "unlock":
      return `${who} unlocked the room`;
    case "op":
      return `${who} made ${target || "a participant"} an op`;
    case "quality": {
      const tier = !kind || kind === "auto" ? "Auto" : kind.charAt(0).toUpperCase() + kind.slice(1);
      return `${who} set ${target || "video"} quality to ${tier}`;
    }
    case "poll-open":
      return `${who} started a poll`;
    case "poll-close":
      return `${who} closed the poll`;
    default:
      return target ? `${who} ${action || "acted on"} ${target}` : `${who} ${action || "acted"}`;
  }
}

// Local HH:MM for a unix-seconds timestamp; a missing or zero ts uses nowMs.
export function hhmm(tsSeconds: number, nowMs: number): string {
  const d = Number.isFinite(tsSeconds) && tsSeconds > 0 ? new Date(tsSeconds * 1000) : new Date(nowMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Implement `chat.ts`** — create `mobile/src/core/chat.ts`:

```ts
// The call's chat log: messages (including the server's replay after `joined`),
// moderation lines and local notices. Unread counts messages only, and only while
// the sheet is closed. Snapshots are replaced on change so useSyncExternalStore can
// compare by identity.
import { moderationText } from "./chatText";
import type { Frame } from "./types";

export type Sender = (type: string, fields: Record<string, unknown>) => boolean;
export type ChatEntry =
  | { key: number; kind: "message"; from: string; text: string; ts: number }
  | { key: number; kind: "system"; text: string; ts: number };
export interface ChatSnapshot { entries: ChatEntry[]; unread: number; open: boolean }
export type SendResult = "sent" | "empty" | "too-long" | "offline";

export const CHAT_MAX = 2000; // server limit, in runes
export const LOG_MAX = 500;

export function unreadLabel(n: number): string {
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}

export class ChatLog {
  private snap: ChatSnapshot = { entries: [], unread: 0, open: false };
  private seq = 0;
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private nowMs: () => number) {}

  onChat(m: Frame): void {
    const entry: ChatEntry = { key: ++this.seq, kind: "message", from: String(m.from ?? ""), text: String(m.text ?? ""), ts: Number(m.ts) || 0 };
    this.push(entry, !this.snap.open);
  }

  onModeration(m: Frame): void {
    this.system(moderationText(m));
  }

  notice(text: string): void {
    this.system(text);
  }

  clear(): void {
    this.set({ ...this.snap, entries: [], unread: 0 });
  }

  setOpen(open: boolean): void {
    if (open === this.snap.open && (!open || this.snap.unread === 0)) return;
    this.set({ ...this.snap, open, unread: open ? 0 : this.snap.unread });
  }

  send(text: string): SendResult {
    const t = text.trim();
    if (!t) return "empty";
    if ([...t].length > CHAT_MAX) return "too-long";
    return this.sender("chat", { text: t }) ? "sent" : "offline";
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): ChatSnapshot => this.snap;

  private system(text: string) {
    this.push({ key: ++this.seq, kind: "system", text, ts: Math.floor(this.nowMs() / 1000) }, false);
  }

  private push(entry: ChatEntry, countUnread: boolean) {
    const entries = [...this.snap.entries, entry];
    if (entries.length > LOG_MAX) entries.splice(0, entries.length - LOG_MAX);
    this.set({ ...this.snap, entries, unread: this.snap.unread + (countUnread ? 1 : 0) });
  }

  private set(next: ChatSnapshot) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 5: Run tests, type check, lint**

Run: `cd mobile && npx jest test/chat.test.ts && npm run -s typecheck && npx eslint src/core test/chat.test.ts`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/chat.ts mobile/src/core/chatText.ts mobile/test/chat.test.ts
git commit -m "feat(mobile): chat log store with unread, system lines and send validation"
```

---

### Task 4: RoomClock store

**Files:**
- Create: `mobile/src/core/roomClock.ts`
- Test: `mobile/test/roomClock.test.ts`

**Interfaces:**
- Produces: `class RoomClock { anchor(roomAgeSec: number | undefined, nowMs: number): void; reset(): void; elapsed(nowMs: number): number | null; subscribe(fn): () => void; getSnapshot(): number | null }` — the snapshot is the room's start time in ms (or `null` when unknown).

- [ ] **Step 1: Write the failing test** — create `mobile/test/roomClock.test.ts`:

```ts
import { RoomClock } from "../src/core/roomClock";

test("anchors to roomAge and counts with the local clock", () => {
  const c = new RoomClock();
  expect(c.elapsed(1000)).toBeNull();
  c.anchor(90, 10_000);
  expect(c.getSnapshot()).toBe(10_000 - 90_000);
  expect(c.elapsed(10_000)).toBe(90);
  expect(c.elapsed(15_500)).toBe(95);
});

test("re-anchoring on rejoin replaces the start; missing roomAge hides the timer", () => {
  const c = new RoomClock();
  let n = 0;
  c.subscribe(() => n++);
  c.anchor(10, 0);
  c.anchor(20, 0);
  expect(c.elapsed(0)).toBe(20);
  c.anchor(undefined, 0);
  expect(c.elapsed(0)).toBeNull();
  c.reset();
  expect(n).toBe(3); // the reset after an absent anchor changes nothing
});

test("negative or non-numeric ages are treated as unknown", () => {
  const c = new RoomClock();
  c.anchor(-5, 0);
  expect(c.elapsed(0)).toBeNull();
  c.anchor(Number.NaN, 0);
  expect(c.elapsed(0)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/roomClock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `mobile/src/core/roomClock.ts`:

```ts
// The room timer: `joined.roomAge` is the seconds since the server created the room;
// we turn it into a start time and count up with the local clock, as the web does.
export class RoomClock {
  private startMs: number | null = null;
  private listeners = new Set<() => void>();

  anchor(roomAgeSec: number | undefined, nowMs: number): void {
    const ok = typeof roomAgeSec === "number" && Number.isFinite(roomAgeSec) && roomAgeSec >= 0;
    this.set(ok ? nowMs - roomAgeSec * 1000 : null);
  }

  reset(): void {
    this.set(null);
  }

  elapsed(nowMs: number): number | null {
    return this.startMs === null ? null : Math.max(0, Math.floor((nowMs - this.startMs) / 1000));
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number | null => this.startMs;

  private set(v: number | null) {
    if (v === this.startMs) return;
    this.startMs = v;
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd mobile && npx jest test/roomClock.test.ts && npm run -s typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/roomClock.ts mobile/test/roomClock.test.ts
git commit -m "feat(mobile): room clock anchored to joined.roomAge"
```

---

### Task 5: Chimes

**Files:**
- Create: `mobile/src/core/chimes.ts`
- Test: `mobile/test/chimes.test.ts`

**Interfaces:**
- Consumes: `Presence` (Task 1), `Timers` from `src/core/types.ts`.
- Produces: `type ChimeName = "join" | "drop" | "bloop"`; `class Chimes { constructor(play: (n: ChimeName) => void, timers: Timers); seed(peers: Array<{ ref?: string }>): void; joined(ref: string): void; left(ref: string): void; shareStarted(ref: string): void; shareStopped(ref: string): void; dispose(): void }`.
- Rule: `shareStarted` bloops only for a ref not already sharing; `seed` (a rejoin) does **not** clear the sharing set, so tracks re-arriving after a rejoin stay silent; `left(ref)` removes the ref from the sharing set.

- [ ] **Step 1: Write the failing tests** — create `mobile/test/chimes.test.ts`:

```ts
import { Chimes, type ChimeName } from "../src/core/chimes";
import { FakeTimers } from "./fakes";

function make() {
  const played: ChimeName[] = [];
  const timers = new FakeTimers();
  const c = new Chimes((n) => played.push(n), timers);
  return { c, played, timers };
}

test("seeding from joined.peers is silent; a new arrival chimes", () => {
  const { c, played } = make();
  c.seed([{ ref: "a" }, { ref: "b" }]);
  expect(played).toEqual([]);
  c.joined("z");
  expect(played).toEqual(["join"]);
});

test("a leave chimes after 6 s; a rejoin within the grace is silent", () => {
  const { c, played, timers } = make();
  c.seed([{ ref: "a" }]);
  c.left("a");
  timers.advance(5000);
  c.joined("a");
  timers.advance(10_000);
  expect(played).toEqual([]);
  c.left("a");
  timers.advance(6000);
  expect(played).toEqual(["drop"]);
});

test("share bloops once per share, not again after our own rejoin", () => {
  const { c, played } = make();
  c.seed([{ ref: "a" }]);
  c.shareStarted("a");
  c.shareStarted("a"); // screen-audio arriving after screen
  expect(played).toEqual(["bloop"]);
  c.seed([{ ref: "a" }]); // rejoin: tracks re-arrive
  c.shareStarted("a");
  expect(played).toEqual(["bloop"]);
  c.shareStopped("a");
  c.shareStarted("a");
  expect(played).toEqual(["bloop", "bloop"]);
});

test("a sharer leaving forgets their share; dispose cancels pending drops", () => {
  const { c, played, timers } = make();
  c.seed([{ ref: "a" }]);
  c.shareStarted("a");
  c.left("a");
  c.dispose();
  timers.advance(10_000);
  expect(played).toEqual(["bloop"]);
  c.joined("a");
  c.shareStarted("a");
  expect(played).toEqual(["bloop", "join", "bloop"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/chimes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `mobile/src/core/chimes.ts`:

```ts
// Join/leave/share chimes. Join and leave go through the web's Presence (by session
// ref), so a reconnect is silent and a leave waits 6 s for a quick rejoin. A share
// bloops when it first appears; the sharing set survives our own rejoin, so the
// share's tracks re-arriving on the new peer don't bloop again.
import { Presence } from "../shared/web";
import type { Timers } from "./types";

export type ChimeName = "join" | "drop" | "bloop";

export class Chimes {
  private presence: Presence;
  private sharing = new Set<string>();

  constructor(private play: (n: ChimeName) => void, timers: Timers) {
    this.presence = new Presence({
      onJoinChime: () => play("join"),
      onDropChime: () => play("drop"),
      // presence.js defaults `timers` to globalThis, so allowJs infers that type; it
      // only ever calls setTimeout/clearTimeout.
      timers: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } as unknown as typeof globalThis,
    });
  }

  seed(peers: Array<{ ref?: string }>): void {
    this.presence.seed(peers);
  }

  joined(ref: string): void {
    this.presence.joined(ref);
  }

  left(ref: string): void {
    if (ref) this.sharing.delete(ref);
    this.presence.left(ref);
  }

  shareStarted(ref: string): void {
    if (ref && this.sharing.has(ref)) return;
    if (ref) this.sharing.add(ref);
    this.play("bloop");
  }

  shareStopped(ref: string): void {
    this.sharing.delete(ref);
  }

  dispose(): void {
    this.presence.clear();
    this.sharing.clear();
  }
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd mobile && npx jest test/chimes.test.ts && npm run -s typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/chimes.ts mobile/test/chimes.test.ts
git commit -m "feat(mobile): reconnect-aware join, leave and share chimes"
```

---

### Task 6: Wire the stores, screen tracks and rename into Call

**Files:**
- Modify: `mobile/src/core/call.ts`, `mobile/src/native/callFactory.ts`
- Test: `mobile/test/call.test.ts`

**Interfaces:**
- Consumes: `ChatLog`, `Sender` (Task 3), `RoomClock` (Task 4), `Chimes`, `ChimeName` (Task 5), `Roster.refOf` / screen slots (Task 2).
- Produces:
  - `CallDeps` gains `timers: Timers`, `now(): number` (ms), `playChime(n: ChimeName): void`.
  - `CallEvents` gains optional `selfRenamed?(name: string): void` — fired only when the server confirms **our own** rename request.
  - `CallState` gains `name: string` (our current display name).
  - `Call` public: `readonly chat: ChatLog`, `readonly clock: RoomClock`, `rename(name: string): "sent" | "empty" | "unchanged" | "offline"`.
  - Constants: `NAME_MAX = 24`.

- [ ] **Step 1: Update the test harness** — in `mobile/test/call.test.ts`, inside `setup()`, add the new deps and capture chimes. Replace the `uuid: () => \`u${++ids}\`,` / `log: silentLog,` lines of the `Call` deps with:

```ts
    uuid: () => `u${++ids}`,
    log: silentLog,
    timers,
    now: () => timers.now,
    playChime: (n) => chimes.push(n),
  }, {
    change: (s) => states.push(s),
    end: (o) => ends.push(o),
    notice: (t) => notices.push(t),
    selfRenamed: (n) => renames.push(n),
  });
  return { call, timers, peers, system, notices, ends, states, mics, cams, ctl, chimes, renames };
```

and declare at the top of `setup()` (next to `const notices: string[] = [];`):

```ts
  const chimes: string[] = [];
  const renames: string[] = [];
```

(Remove the old `}, { change..., notice... });` and `return {...}` lines this replaces.)

- [ ] **Step 2: Write the failing tests** — append to `mobile/test/call.test.ts`:

```ts
test("chat: frames reach the log; send goes out only while in-call and connected", async () => {
  const { call } = await inCall();
  sock().receive({ type: "chat", from: "Alice", text: "hi", ts: 5 });
  sock().receive({ type: "moderation", actor: "Alice", action: "lock" });
  expect(call.chat.getSnapshot().entries.map((e) => e.text)).toEqual(["hi", "Alice locked the room"]);
  expect(call.chat.send("hello")).toBe("sent");
  expect(framesOf("chat")).toEqual([{ type: "chat", text: "hello" }]);
  sock().drop();
  expect(call.chat.send("lost?")).toBe("offline");
  expect(framesOf("chat")).toHaveLength(1);
});

test("rejoin clears chat before the server's replay, re-anchors the clock, stays silent", async () => {
  const { call, timers, chimes } = await inCall();
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 });
  sock().drop();
  timers.advance(500);
  sock().open();
  timers.now = 50_000;
  sock().receive(joined({ roomAge: 30, peers: [{ id: "p9", name: "Alice", role: "op", mic: true, camera: false, ref: "r1" }] }));
  sock().receive({ type: "chat", from: "Alice", text: "old", ts: 1 }); // replay
  await flush();
  expect(call.chat.getSnapshot().entries.map((e) => e.text)).toEqual(["old"]);
  expect(call.clock.elapsed(50_000)).toBe(30);
  expect(chimes).toEqual([]);
});

test("in-call server errors also land in chat as notices", async () => {
  const { call, notices } = await inCall();
  sock().receive({ type: "error", code: "rate", message: "Slow down" });
  expect(notices).toHaveLength(1);
  expect(call.chat.getSnapshot().entries.map((e) => e.text)).toEqual([notices[0]]);
});

test("chimes: arrivals and departures by ref, not on the initial roster", async () => {
  const { timers, chimes } = await inCall();
  expect(chimes).toEqual([]);
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" });
  sock().receive({ type: "peer-left", id: "p2" });
  timers.advance(6000);
  expect(chimes).toEqual(["join", "drop"]);
});

test("screen tracks go to the roster's screen slots and bloop once", async () => {
  const { call, peers, chimes } = await inCall();
  sock().receive({ type: "peer-joined", id: "p2", name: "Bob", role: "user", mic: true, camera: true, ref: "rb" });
  const scr = new FakeStream([]);
  const sa = new FakeStream([]);
  peers[0].events.remoteTrack({ participantId: "p2", kind: "screen", stream: scr });
  peers[0].events.remoteTrack({ participantId: "p2", kind: "screen-audio", stream: sa });
  const bob = call.getState().participants.find((p) => p.id === "p2")!;
  expect(bob).toMatchObject({ screen: scr, screenAudio: sa });
  expect(chimes.filter((c) => c === "bloop")).toHaveLength(1);
  peers[0].events.peerGone({ participantId: "p2", kind: "screen" });
  peers[0].events.peerGone({ participantId: "p2", kind: "screen-audio" });
  expect(call.getState().participants.find((p) => p.id === "p2")).toMatchObject({ screen: null, screenAudio: null });
});

test("rename: validates, sends, updates state and saves only on our own confirmed echo", async () => {
  const { call, renames } = await inCall();
  expect(call.getState().name).toBe("Ryan");
  expect(call.rename("   ")).toBe("empty");
  expect(call.rename("Ryan")).toBe("unchanged");
  expect(call.rename("  " + "x".repeat(30) + "  ")).toBe("sent");
  expect(framesOf("rename")).toEqual([{ type: "rename", name: "x".repeat(24) }]);
  expect(call.getState().name).toBe("Ryan"); // not until the server confirms
  sock().receive({ type: "peer-renamed", id: "me", name: "x".repeat(24) });
  expect(call.getState().name).toBe("x".repeat(24));
  expect(renames).toEqual(["x".repeat(24)]);
  sock().receive({ type: "peer-renamed", id: "me", name: "ServerSide" }); // not our request
  expect(call.getState().name).toBe("ServerSide");
  expect(renames).toHaveLength(1);
  sock().drop();
  expect(call.rename("Offline")).toBe("offline");
});

test("rename echo for another participant only patches the roster", async () => {
  const { call, renames } = await inCall();
  sock().receive({ type: "peer-renamed", id: "p1", name: "Alicia" });
  expect(call.getState().participants[0].name).toBe("Alicia");
  expect(renames).toEqual([]);
});
```

Add `FakeStream` to the existing `./fakes` import at the top of the file if it is not already there (it is — `FakeStream` is imported).

- [ ] **Step 3: Run to verify failure**

Run: `cd mobile && npx jest test/call.test.ts`
Expected: FAIL — type errors on `timers`/`now`/`playChime`/`selfRenamed`, `call.chat` undefined.

- [ ] **Step 4: Implement in `mobile/src/core/call.ts`**

Imports — add:

```ts
import { ChatLog } from "./chat";
import { Chimes, type ChimeName } from "./chimes";
import { RoomClock } from "./roomClock";
```

and extend the types import to `import type { Frame, Kind, Logger, StreamLike, Timers, TrackLike } from "./types";`.

`CallDeps` — add three fields:

```ts
  timers: Timers;
  now(): number; // ms, wall clock
  playChime(n: ChimeName): void;
```

`CallState` — add `name: string;` after `role: string;`, and add `name: ""` to the initial `state` object.

`CallEvents` — add `selfRenamed?(name: string): void;`.

Add the constant above the class: `export const NAME_MAX = 24;`

Inside the class, add fields after `private roster = new Roster();`:

```ts
  readonly clock = new RoomClock();
  readonly chat: ChatLog;
  private chimes: Chimes;
  private pendingRename: string | null = null;
```

Constructor becomes:

```ts
  constructor(private deps: CallDeps, private events: CallEvents) {
    this.roster.subscribe(() => this.update({ participants: this.roster.list() }));
    this.chat = new ChatLog((type, fields) => this.trySend(type, fields), () => deps.now());
    this.chimes = new Chimes((n) => deps.playChime(n), deps.timers);
  }
```

In `join()`, change the first `update` to include the name: `this.update({ phase: "connecting", slug: req.link.slug, name: req.name });`

In `join()`, replace the `peer-joined` and `peer-left` handlers and add chat/moderation:

```ts
    sig.on("peer-joined", (m) => {
      this.roster.upsert(m as unknown as PeerInfo);
      this.chimes.joined(String(m.ref || ""));
    });
    sig.on("peer-left", (m) => {
      const ref = this.roster.refOf(m.id);
      this.roster.remove(m.id);
      this.chimes.left(ref);
    });
    sig.on("chat", (m) => this.chat.onChat(m));
    sig.on("moderation", (m) => this.chat.onModeration(m));
```

Add the public `rename` method after `leave()`:

```ts
  rename(name: string): "sent" | "empty" | "unchanged" | "offline" {
    const n = [...name.trim()].slice(0, NAME_MAX).join("").trim();
    if (!n) return "empty";
    if (n === this.state.name) return "unchanged";
    if (!this.trySend("rename", { name: n })) return "offline";
    this.pendingRename = n;
    return "sent";
  }
```

Replace `onJoined` with:

```ts
  private onJoined(m: Frame) {
    this.awaitingJoined = false;
    const first = !this.joinedOnce;
    this.joinedOnce = true;
    if (m.quality) this.quality = { camera: m.quality.camera || "auto", screen: m.quality.screen || "auto" };
    // Reset before the server's chat replay, which follows this frame.
    this.chat.clear();
    this.clock.anchor(m.roomAge, this.deps.now());
    this.chimes.seed(m.peers || []);
    this.roster.seed((m.peers || []) as PeerInfo[]);
    this.update({ phase: "in-call", banner: "", selfId: m.selfId, role: m.role || "" });
    if (first) this.deps.system.connected(this.callId);
    this.rebuildPeer();
  }
```

In `onServerError`, add the notice to chat as well — replace the final line:

```ts
    const text = inCallErrorText(m.code || "", m.message || "");
    this.events.notice(text);
    this.chat.notice(text);
```

Replace `onRenamed` with:

```ts
  private onRenamed(m: Frame) {
    if (m.id === this.state.selfId) {
      if (this.req) this.req = { ...this.req, name: m.name }; // the next join must carry it
      this.update({ name: m.name });
      if (this.pendingRename !== null && m.name === this.pendingRename) this.events.selfRenamed?.(m.name);
      this.pendingRename = null;
      return;
    }
    this.roster.patch(m.id, { name: m.name });
  }
```

In `rebuildPeer()`, replace the `remoteTrack` and `peerGone` handlers:

```ts
      remoteTrack: (e) => {
        if (e.kind === "camera" || e.kind === "mic" || e.kind === "screen" || e.kind === "screen-audio") {
          this.roster.setStream(e.participantId, e.kind, e.stream);
        }
        if (e.kind === "screen" || e.kind === "screen-audio") this.chimes.shareStarted(this.roster.refOf(e.participantId));
      },
      peerGone: (e) => {
        if (!e.participantId) return;
        if (e.kind === "camera" || e.kind === "mic" || e.kind === "screen" || e.kind === "screen-audio") {
          this.roster.setStream(e.participantId, e.kind, null);
        }
        const p = this.roster.get(e.participantId);
        if (p && !p.screen && !p.screenAudio) this.chimes.shareStopped(p.ref);
      },
```

Add the private sender next to `sendMediaState`:

```ts
  // Sends only when the server can receive it; Signaling drops frames sent while
  // reconnecting, so callers must be told rather than lose the user's input.
  private trySend(type: string, fields: Record<string, unknown>): boolean {
    if (this.state.phase !== "in-call" || !this.sig?.isOpen) return false;
    this.sig.send(type, fields);
    return true;
  }
```

In `finish()`, after `this.releaseTracks();` add `this.chimes.dispose();`.

- [ ] **Step 5: Supply the deps in `mobile/src/native/callFactory.ts`**

Add the import `import { playChime } from "./sounds";` (created in Task 7 — to keep this task green on its own, create `mobile/src/native/sounds.ts` now with only this stub, which Task 7 replaces):

```ts
import type { ChimeName } from "../core/chimes";

export function playChime(_n: ChimeName): void {}
```

and add to the `new Call({...})` deps object:

```ts
    timers,
    now: () => Date.now(),
    playChime,
```

- [ ] **Step 6: Run the full suite, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`
Expected: all PASS (the existing call tests still pass with the new harness).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/core/call.ts mobile/src/native/callFactory.ts mobile/src/native/sounds.ts mobile/test/call.test.ts
git commit -m "feat(mobile): wire chat, room clock, chimes, screen tracks and rename into Call"
```

---

### Task 7: CoyoteSounds native module and bundled chimes

**Files:**
- Create: `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteSoundsModule.kt`, `CoyoteSoundsPackage.kt`
- Create: `mobile/android/app/src/main/res/raw/door_open.mp3`, `sounds_drop.mp3`, `sounds_bloop.mp3`
- Create: `mobile/ios/Coyote/CoyoteSounds.swift`, `mobile/ios/Coyote/CoyoteSounds.m`
- Create: `mobile/ios/Coyote/Sounds/door_open.mp3`, `sounds_drop.mp3`, `sounds_bloop.mp3`
- Modify: `mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt`, `mobile/ios/Coyote.xcodeproj/project.pbxproj`, `mobile/src/native/sounds.ts` (replace the Task 6 stub)
- Test: `mobile/test/nativeModules.test.ts`, `mobile/test/chimeFiles.test.ts`

**Interfaces:**
- Native module name `CoyoteSounds`, methods `preload(id: string, uri: string)`, `play(id: string)`, `stop(id: string)`, event `CoyoteSoundEnded` with body `{ id }`. `uri` is `asset:<name>` for a bundled sound or a `file://` / `https://` URL.
- JS (`src/native/sounds.ts`): `playChime(n: ChimeName): void`, `onSoundEnded(fn: (id: string) => void): () => void`.

- [ ] **Step 1: Copy the chime files**

```bash
cd /home/rohara/Workspace/webrtc-chat
mkdir -p mobile/android/app/src/main/res/raw mobile/ios/Coyote/Sounds
for f in door_open sounds_drop sounds_bloop; do
  cp internal/web/assets/$f.mp3 mobile/android/app/src/main/res/raw/$f.mp3
  cp internal/web/assets/$f.mp3 mobile/ios/Coyote/Sounds/$f.mp3
done
```

- [ ] **Step 2: Write the failing tests**

Create `mobile/test/chimeFiles.test.ts`:

```ts
/// <reference types="node" />
import * as fs from "fs";
import * as path from "path";

// The chimes are bundled copies of the web client's files; they must not drift.
const root = path.join(__dirname, "..", "..");
const names = ["door_open", "sounds_drop", "sounds_bloop"];

test.each(names)("%s.mp3 is byte-identical in the web assets, Android res/raw and the iOS bundle", (n) => {
  const web = fs.readFileSync(path.join(root, "internal", "web", "assets", `${n}.mp3`));
  const android = fs.readFileSync(path.join(root, "mobile", "android", "app", "src", "main", "res", "raw", `${n}.mp3`));
  const ios = fs.readFileSync(path.join(root, "mobile", "ios", "Coyote", "Sounds", `${n}.mp3`));
  expect(android.equals(web)).toBe(true);
  expect(ios.equals(web)).toBe(true);
});

test("the iOS project bundles the chimes and compiles the module", () => {
  const pbx = fs.readFileSync(path.join(root, "mobile", "ios", "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  for (const n of names) expect(pbx).toContain(`${n}.mp3 in Resources`);
  expect(pbx).toContain("CoyoteSounds.swift in Sources");
  expect(pbx).toContain("CoyoteSounds.m in Sources");
});
```

Append to `mobile/test/nativeModules.test.ts`:

```ts
test("CoyoteSounds exports preload/play/stop on both platforms and never touches the audio session", () => {
  const app = path.join(__dirname, "..");
  const kt = fs.readFileSync(path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "CoyoteSoundsModule.kt"), "utf8");
  expect(exportedNames(kt).sort()).toEqual(["addListener", "play", "preload", "removeListeners", "stop"]);
  const m = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.m"), "utf8");
  for (const sig of ["preload:(NSString *)id uri:(NSString *)uri", "play:(NSString *)id", "stop:(NSString *)id"]) expect(m).toContain(sig);
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.swift"), "utf8");
  expect(swift).not.toMatch(/setCategory|setMode|setActive/);
  expect(kt).not.toMatch(/setMode\(|requestAudioFocus|setSpeakerphoneOn/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd mobile && npx jest test/chimeFiles.test.ts test/nativeModules.test.ts`
Expected: FAIL — module sources and pbxproj entries missing (the byte-equality test passes already).

- [ ] **Step 4: Android module** — create `CoyoteSoundsModule.kt`:

```kotlin
package net.swiftirc.coyote

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Plays chimes and soundboard clips inside the call's audio. It never changes the
// audio mode, focus or route: those belong to the call (InCallManager / Telecom).
class CoyoteSoundsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteSounds"

  private val players = HashMap<String, MediaPlayer>()

  // Explicit R.raw references, so release resource shrinking keeps the files.
  private val bundled = mapOf(
    "door_open" to R.raw.door_open,
    "sounds_drop" to R.raw.sounds_drop,
    "sounds_bloop" to R.raw.sounds_bloop,
  )

  @ReactMethod
  fun preload(id: String, uri: String) {
    players.remove(id)?.release()
    val p = MediaPlayer()
    try {
      p.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      if (uri.startsWith("asset:")) {
        val res = bundled[uri.removePrefix("asset:")] ?: run { p.release(); return }
        ctx.resources.openRawResourceFd(res).use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
      } else {
        p.setDataSource(ctx, Uri.parse(uri))
      }
      p.setOnCompletionListener { emitEnded(id) }
      p.prepare()
      players[id] = p
    } catch (e: Exception) {
      Log.w("CoyoteSounds", "preload $id failed", e)
      p.release()
    }
  }

  @ReactMethod
  fun play(id: String) {
    val p = players[id] ?: return
    p.seekTo(0)
    if (!p.isPlaying) p.start()
  }

  @ReactMethod
  fun stop(id: String) {
    val p = players[id] ?: return
    if (p.isPlaying) p.pause()
    p.seekTo(0)
  }

  private fun emitEnded(id: String) {
    val body = Arguments.createMap().apply { putString("id", id) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteSoundEnded", body)
  }

  // Required by NativeEventEmitter on Android.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  override fun invalidate() {
    players.values.forEach { it.release() }
    players.clear()
    super.invalidate()
  }
}
```

Create `CoyoteSoundsPackage.kt`:

```kotlin
package net.swiftirc.coyote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CoyoteSoundsPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CoyoteSoundsModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
```

In `MainApplication.kt`, after `add(CallServicePackage())` add `add(CoyoteSoundsPackage())`.

- [ ] **Step 5: iOS module** — create `mobile/ios/Coyote/CoyoteSounds.swift`:

```swift
import AVFoundation
import React

// Plays chimes and soundboard clips inside the call's existing audio session.
// It must never set the category or mode or activate the session: CallKit and
// WebRTC own those, and changing them mid-call breaks call audio.
@objc(CoyoteSounds)
class CoyoteSounds: RCTEventEmitter, AVAudioPlayerDelegate {
  private var players: [String: AVAudioPlayer] = [:]
  private var listening = false

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteSoundEnded"] }
  override func startObserving() { listening = true }
  override func stopObserving() { listening = false }

  @objc(preload:uri:)
  func preload(_ id: String, uri: String) {
    guard let url = resolve(uri), let p = try? AVAudioPlayer(contentsOf: url) else { return }
    p.delegate = self
    p.prepareToPlay()
    players[id] = p
  }

  @objc(play:)
  func play(_ id: String) {
    guard let p = players[id] else { return }
    p.currentTime = 0
    p.play()
  }

  @objc(stop:)
  func stop(_ id: String) {
    guard let p = players[id] else { return }
    p.stop()
    p.currentTime = 0
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    // Delegate callbacks arrive on the main thread; the players map lives on the
    // module's method queue.
    methodQueue.async { [weak self] in
      guard let self = self, self.listening,
            let id = self.players.first(where: { $0.value === player })?.key else { return }
      self.sendEvent(withName: "CoyoteSoundEnded", body: ["id": id])
    }
  }

  private func resolve(_ uri: String) -> URL? {
    if uri.hasPrefix("asset:") {
      return Bundle.main.url(forResource: String(uri.dropFirst("asset:".count)), withExtension: "mp3")
    }
    return URL(string: uri)
  }
}
```

Create `mobile/ios/Coyote/CoyoteSounds.m`:

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(CoyoteSounds, RCTEventEmitter)
RCT_EXTERN_METHOD(preload:(NSString *)id uri:(NSString *)uri)
RCT_EXTERN_METHOD(play:(NSString *)id)
RCT_EXTERN_METHOD(stop:(NSString *)id)
@end
```

- [ ] **Step 6: Register the iOS files in `project.pbxproj`**

Use these new object IDs (confirm each is unused first: `grep -c <ID> mobile/ios/Coyote.xcodeproj/project.pbxproj` → 0):

| File | PBXFileReference | PBXBuildFile |
|---|---|---|
| CoyoteSounds.swift | `761780F02CA45674006654EE` | `761780F12CA45674006654EE` |
| CoyoteSounds.m | `761780F22CA45674006654EE` | `761780F32CA45674006654EE` |
| door_open.mp3 | `761780F42CA45674006654EE` | `761780F52CA45674006654EE` |
| sounds_drop.mp3 | `761780F62CA45674006654EE` | `761780F72CA45674006654EE` |
| sounds_bloop.mp3 | `761780F82CA45674006654EE` | `761780F92CA45674006654EE` |

In `/* Begin PBXBuildFile section */` add (after the `SceneDelegate.swift in Sources` line):

```
		761780F12CA45674006654EE /* CoyoteSounds.swift in Sources */ = {isa = PBXBuildFile; fileRef = 761780F02CA45674006654EE /* CoyoteSounds.swift */; };
		761780F32CA45674006654EE /* CoyoteSounds.m in Sources */ = {isa = PBXBuildFile; fileRef = 761780F22CA45674006654EE /* CoyoteSounds.m */; };
		761780F52CA45674006654EE /* door_open.mp3 in Resources */ = {isa = PBXBuildFile; fileRef = 761780F42CA45674006654EE /* door_open.mp3 */; };
		761780F72CA45674006654EE /* sounds_drop.mp3 in Resources */ = {isa = PBXBuildFile; fileRef = 761780F62CA45674006654EE /* sounds_drop.mp3 */; };
		761780F92CA45674006654EE /* sounds_bloop.mp3 in Resources */ = {isa = PBXBuildFile; fileRef = 761780F82CA45674006654EE /* sounds_bloop.mp3 */; };
```

In `/* Begin PBXFileReference section */` add (after the `SceneDelegate.swift` reference):

```
		761780F02CA45674006654EE /* CoyoteSounds.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = CoyoteSounds.swift; path = Coyote/CoyoteSounds.swift; sourceTree = "<group>"; };
		761780F22CA45674006654EE /* CoyoteSounds.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = CoyoteSounds.m; path = Coyote/CoyoteSounds.m; sourceTree = "<group>"; };
		761780F42CA45674006654EE /* door_open.mp3 */ = {isa = PBXFileReference; lastKnownFileType = audio.mp3; name = door_open.mp3; path = Coyote/Sounds/door_open.mp3; sourceTree = "<group>"; };
		761780F62CA45674006654EE /* sounds_drop.mp3 */ = {isa = PBXFileReference; lastKnownFileType = audio.mp3; name = sounds_drop.mp3; path = Coyote/Sounds/sounds_drop.mp3; sourceTree = "<group>"; };
		761780F82CA45674006654EE /* sounds_bloop.mp3 */ = {isa = PBXFileReference; lastKnownFileType = audio.mp3; name = sounds_bloop.mp3; path = Coyote/Sounds/sounds_bloop.mp3; sourceTree = "<group>"; };
```

In the `Coyote` PBXGroup's `children` (after `SceneDelegate.swift`) add the five file reference IDs with their comments. In the Sources build phase `files` (after `SceneDelegate.swift in Sources`) add the two `in Sources` build-file IDs. In the Resources build phase `files` (after `Images.xcassets in Resources`) add the three `in Resources` build-file IDs.

The Swift file uses `RCTEventEmitter` through `import React`, which `AppDelegate.swift` already does; no bridging header is needed because the `.m` file only uses the `RCT_EXTERN_*` macros.

- [ ] **Step 7: JS wrapper** — replace `mobile/src/native/sounds.ts`:

```ts
import { NativeEventEmitter, NativeModules } from "react-native";
import type { ChimeName } from "../core/chimes";

const { CoyoteSounds } = NativeModules;

const CHIME_FILES: Record<ChimeName, string> = { join: "door_open", drop: "sounds_drop", bloop: "sounds_bloop" };
let chimesLoaded = false;

function preloadChimes(): void {
  if (chimesLoaded || !CoyoteSounds) return;
  chimesLoaded = true;
  for (const [name, file] of Object.entries(CHIME_FILES)) CoyoteSounds.preload(`chime:${name}`, `asset:${file}`);
}

// Best-effort: a missing chime never affects the call.
export function playChime(n: ChimeName): void {
  if (!CoyoteSounds) return;
  try {
    preloadChimes();
    CoyoteSounds.play(`chime:${n}`);
  } catch (e) {
    console.warn("chime failed", e);
  }
}

// For the soundboard (2b): fires when a clip finishes on its own.
export function onSoundEnded(fn: (id: string) => void): () => void {
  if (!CoyoteSounds) return () => {};
  const sub = new NativeEventEmitter(CoyoteSounds).addListener("CoyoteSoundEnded", (e: { id: string }) => fn(e.id));
  return () => sub.remove();
}
```

- [ ] **Step 8: Run tests, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`
Expected: all PASS.

- [ ] **Step 9: Android compile check (here, if the SDK is set up)**

Run: `cd mobile/android && source ./env.sh 2>/dev/null; ./gradlew :app:compileDebugKotlin -q`
Expected: BUILD SUCCESSFUL. If the Android SDK is unavailable in this environment, note it in the task report; the maintainer's Mac build verifies it.

- [ ] **Step 10: Commit**

```bash
git add mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteSounds*.kt \
  mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt \
  mobile/android/app/src/main/res/raw mobile/ios/Coyote/CoyoteSounds.swift mobile/ios/Coyote/CoyoteSounds.m \
  mobile/ios/Coyote/Sounds mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/src/native/sounds.ts \
  mobile/test/chimeFiles.test.ts mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): CoyoteSounds native module and bundled chimes"
```

---

### Task 8: Hooks, grid tiles and saving a confirmed rename

**Files:**
- Create: `mobile/src/core/tiles.ts`, `mobile/src/ui/hooks.ts`
- Modify: `mobile/src/ui/CallContext.tsx`
- Test: `mobile/test/tiles.test.ts`

**Interfaces:**
- Consumes: `Participant` with screen slots (Task 2); `Call.chat`, `Call.clock` (Task 6); `formatDuration` (Task 1).
- Produces:
  - `type GridTile = { kind: "person"; key: string; p: Participant } | { kind: "screen"; key: string; p: Participant }` and `gridTiles(people: Participant[]): GridTile[]` — each person, followed by a screen tile if they have `screen` or `screenAudio`.
  - `screenFor(people: Participant[], id: string): Participant | null` — the participant if they are still sharing, else `null`.
  - Hooks: `useStore<T>(store: { subscribe(fn: () => void): () => void; getSnapshot(): T } | null, fallback: T): T`, `useChat(): ChatSnapshot`, `useElapsed(): string | null` (formatted room time, ticking every second).

- [ ] **Step 1: Write the failing test** — create `mobile/test/tiles.test.ts`:

```ts
import { gridTiles, screenFor } from "../src/core/tiles";
import type { Participant } from "../src/core/roster";
import { FakeStream } from "./fakes";

const person = (id: string, over: Partial<Participant> = {}): Participant => ({
  id, name: id, role: "user", mic: true, camera: true, ref: "", gravatar: "",
  video: null, audio: null, screen: null, screenAudio: null, ...over,
});

test("a sharer gets a screen tile right after their own tile; audio-only shares count", () => {
  const s = new FakeStream([]);
  const tiles = gridTiles([person("a", { screen: s }), person("b"), person("c", { screenAudio: s })]);
  expect(tiles.map((t) => t.key)).toEqual(["a", "a:screen", "b", "c", "c:screen"]);
  expect(tiles[1].kind).toBe("screen");
});

test("screenFor returns the sharer only while they still share", () => {
  const s = new FakeStream([]);
  expect(screenFor([person("a", { screen: s })], "a")?.id).toBe("a");
  expect(screenFor([person("a")], "a")).toBeNull();
  expect(screenFor([], "a")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/tiles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tiles.ts`** — create `mobile/src/core/tiles.ts`:

```ts
import type { Participant } from "./roster";

export type GridTile =
  | { kind: "person"; key: string; p: Participant }
  | { kind: "screen"; key: string; p: Participant };

const sharing = (p: Participant) => !!(p.screen || p.screenAudio);

// One tile per person, plus a screen tile right after anyone who is sharing.
export function gridTiles(people: Participant[]): GridTile[] {
  const out: GridTile[] = [];
  for (const p of people) {
    out.push({ kind: "person", key: p.id, p });
    if (sharing(p)) out.push({ kind: "screen", key: `${p.id}:screen`, p });
  }
  return out;
}

export function screenFor(people: Participant[], id: string): Participant | null {
  const p = people.find((x) => x.id === id);
  return p && sharing(p) ? p : null;
}
```

- [ ] **Step 4: Implement `hooks.ts`** — create `mobile/src/ui/hooks.ts`:

```ts
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatSnapshot } from "../core/chat";
import { formatDuration } from "../shared/web";
import { useCall } from "./CallContext";

type Store<T> = { subscribe(fn: () => void): () => void; getSnapshot(): T };
const noopSubscribe = () => () => {};

export function useStore<T>(store: Store<T> | null, fallback: T): T {
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => fallback);
}

const EMPTY_CHAT: ChatSnapshot = { entries: [], unread: 0, open: false };

export function useChat(): ChatSnapshot {
  const { call, state } = useCall();
  void state; // re-read the active call whenever call state changes (a new call)
  return useStore(call()?.chat ?? null, EMPTY_CHAT);
}

// The room timer as "m:ss" / "h:mm:ss", or null when the server didn't send roomAge.
export function useElapsed(): string | null {
  const { call, state } = useCall();
  void state;
  const clock = call()?.clock ?? null;
  const start = useStore(clock, null as number | null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [start]);
  return start === null ? null : formatDuration((now - start) / 1000);
}
```

- [ ] **Step 5: Save a confirmed self-rename** — in `mobile/src/ui/CallContext.tsx`:

Add the import `import { loadPrefs, savePrefs } from "../native/storage";`.

In `join`, add a `selfRenamed` handler to the `createCall({...})` events object, after `notice`:

```ts
      selfRenamed: (name) => {
        if (active.current !== made) return;
        loadPrefs().then((p) => savePrefs({ ...p, name })).catch((e) => console.warn("saving renamed name failed", e));
      },
```

(Only a rename the user asked for fires this — `Call` filters out names imposed by the server or a token/invite, so a locked name is never saved.)

- [ ] **Step 6: Run tests, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/core/tiles.ts mobile/src/ui/hooks.ts mobile/src/ui/CallContext.tsx mobile/test/tiles.test.ts
git commit -m "feat(mobile): store hooks, grid tiles with screenshares, save confirmed renames"
```

---

### Task 9: Controls bar, top bar and flip on the self-view

**Files:**
- Create: `mobile/src/ui/components/TopBar.tsx`
- Modify: `mobile/src/ui/components/Controls.tsx`, `mobile/src/ui/components/SelfView.tsx`, `mobile/src/ui/components/Banner.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `useChat`, `useElapsed` (Task 8), `unreadLabel` (Task 3).
- Produces: `Controls` props become `{ mic, camera, routeLabel, unread: number, onMic, onCamera, onRoute, onChat, onMore, onLeave }` (no `onFlip`). `SelfView` props become `{ stream, onFlip(): void }`. `TopBar` props `{ slug: string }`. `Call.tsx` holds `const [sheet, setSheet] = useState<"chat" | "more" | null>(null)` used by Tasks 10–11.

- [ ] **Step 1: Controls** — in `mobile/src/ui/components/Controls.tsx`, change the props interface and buttons. Replace the flip button line and add chat/more so the row reads:

```tsx
      <Btn label={p.mic ? "🎙" : "🔇"} onPress={p.onMic} active={p.mic} a11y={p.mic ? "Mute microphone" : "Unmute microphone"} />
      <Btn label={p.camera ? "📷" : "🚫"} onPress={p.onCamera} active={p.camera} a11y={p.camera ? "Turn camera off" : "Turn camera on"} />
      <Btn label={p.routeLabel} onPress={p.onRoute} a11y={`Audio output: ${p.routeLabel}`} />
      <View>
        <Btn label="💬" onPress={p.onChat} a11y={p.unread ? `Chat, ${unreadLabel(p.unread)} unread` : "Chat"} />
        {p.unread > 0 ? <Text style={styles.badge} pointerEvents="none">{unreadLabel(p.unread)}</Text> : null}
      </View>
      <Btn label="☰" onPress={p.onMore} a11y="More" />
      <Btn label="Leave" onPress={p.onLeave} danger a11y="Leave call" />
```

Update the props type: remove `onFlip`, add `unread: number; onChat(): void; onMore(): void;`. Import `unreadLabel` from `../../core/chat`. Add the style:

```ts
  badge: { position: "absolute", top: -4, right: -4, minWidth: 20, paddingHorizontal: 5, borderRadius: 10, overflow: "hidden", backgroundColor: colors.accent, color: "#000", fontSize: 12, fontWeight: "700", textAlign: "center" },
```

If the row no longer fits at 360 pt width, reduce `btn.paddingHorizontal` from 12 to 8 (six buttons × 52 pt plus gaps must fit 360 pt).

- [ ] **Step 2: SelfView flip button** — in `mobile/src/ui/components/SelfView.tsx`, accept `onFlip` and render a small button inside the PiP, after the `RTCView`:

```tsx
export function SelfView({ stream, onFlip }: { stream: StreamLike | null; onFlip(): void }) {
```

```tsx
      <Pressable onPress={onFlip} style={styles.flip} accessibilityRole="button" accessibilityLabel="Switch camera" hitSlop={8}>
        <Text style={styles.flipText}>⟳</Text>
      </Pressable>
```

Add `Pressable, Text` to the `react-native` import and the styles:

```ts
  flip: { position: "absolute", right: 4, bottom: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  flipText: { color: colors.text, fontSize: 16 },
```

- [ ] **Step 3: TopBar** — create `mobile/src/ui/components/TopBar.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useElapsed } from "../hooks";
import { colors } from "../theme";

// "#room · 12:34" — the room timer counts from when the server created the room.
export function TopBar({ slug }: { slug: string }) {
  const elapsed = useElapsed();
  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>#{slug}{elapsed ? ` · ${elapsed}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 8, left: 12, right: 120 },
  text: { alignSelf: "flex-start", color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", fontVariant: ["tabular-nums"] },
});
```

In `Banner.tsx`, move the banner below the top bar: change `wrap` `top: 12` to `top: 40`.

- [ ] **Step 4: Call screen wiring** — in `mobile/src/ui/screens/Call.tsx`:

Add imports: `import { useChat } from "../hooks";`, `import { TopBar } from "../components/TopBar";`, and `useState` is already imported.

Inside `Call()`, after the existing hooks, add:

```tsx
  const chat = useChat();
  const [sheet, setSheet] = useState<"chat" | "more" | null>(null);
  const toggleChat = () => {
    const open = sheet !== "chat";
    setSheet(open ? "chat" : null);
    call()?.chat.setOpen(open);
  };
```

Note: hooks must stay above the early `if (!state)` return — place these with the other hooks at the top of the component.

Render `<TopBar slug={state.slug} />` right after the grid `View`, change `<SelfView ... />` to pass `onFlip={() => { call()?.flipCamera().catch(warn("flip camera")); }}`, and update `<Controls>`: remove `onFlip`, add

```tsx
          unread={chat.unread}
          onChat={toggleChat}
          onMore={() => { setSheet(sheet === "more" ? null : "more"); call()?.chat.setOpen(false); }}
```

- [ ] **Step 5: Type check and lint**

Run: `cd mobile && npm run -s typecheck && npx eslint src && npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui/components/Controls.tsx mobile/src/ui/components/SelfView.tsx mobile/src/ui/components/TopBar.tsx mobile/src/ui/components/Banner.tsx mobile/src/ui/screens/Call.tsx
git commit -m "feat(mobile): chat and more buttons, room timer, flip on the self-view"
```

---

### Task 10: Chat sheet

**Files:**
- Create: `mobile/src/ui/components/Sheet.tsx`, `mobile/src/ui/components/ChatSheet.tsx`
- Modify: `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `useChat` (Task 8), `ChatEntry`, `SendResult`, `CHAT_MAX` (Task 3), `hhmm` (Task 3), `linkSegments` (Task 1).
- Produces: `Sheet` props `{ visible: boolean; onClose(): void; heightFraction?: number; children }` — an animated bottom sheet with a drag handle, closed by dragging down or tapping the backdrop above it. `ChatSheet` props `{ visible: boolean; onClose(): void; send(text: string): SendResult }`.

- [ ] **Step 1: Sheet** — create `mobile/src/ui/components/Sheet.tsx`:

```tsx
import React, { useEffect, useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";

// Bottom sheet over the call. The area above it stays visible; tapping it, or
// dragging the handle down, closes the sheet. No gesture/animation libraries.
export function Sheet({ visible, onClose, heightFraction = 0.55, children }: {
  visible: boolean; onClose(): void; heightFraction?: number; children: React.ReactNode;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const height = Math.round(win.height * heightFraction);
  const y = useRef(new Animated.Value(height)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    Animated.timing(y, { toValue: visible ? 0 : height, duration: 200, useNativeDriver: true }).start();
  }, [visible, height, y]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 80 || g.vy > 0.8) onCloseRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "box-none" : "none"}>
      {visible ? <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" /> : null}
      <Animated.View style={[styles.sheet, { height: height + insets.bottom, paddingBottom: insets.bottom, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: radius, borderTopRightRadius: radius, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  handleArea: { alignItems: "center", paddingVertical: 10 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
});
```

- [ ] **Step 2: ChatSheet** — create `mobile/src/ui/components/ChatSheet.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CHAT_MAX, type ChatEntry, type SendResult } from "../../core/chat";
import { hhmm } from "../../core/chatText";
import { linkSegments } from "../../shared/web";
import { useChat } from "../hooks";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";

const ERRORS: Partial<Record<SendResult, string>> = {
  offline: "Not connected — message not sent.",
  "too-long": `Messages are limited to ${CHAT_MAX} characters.`,
};

function Line({ e }: { e: ChatEntry }) {
  const time = hhmm(e.ts, Date.now());
  if (e.kind === "system") return <Text style={styles.system}>{time} {e.text}</Text>;
  return (
    <Text style={styles.line} selectable>
      <Text style={styles.time}>{time} </Text>
      <Text style={styles.from}>{e.from}: </Text>
      {linkSegments(e.text).map((s, i) =>
        s.href ? (
          <Text key={i} style={styles.link} onPress={() => { Linking.openURL(s.href!).catch(() => {}); }} accessibilityRole="link">{s.text}</Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </Text>
  );
}

export function ChatSheet({ visible, onClose, send }: { visible: boolean; onClose(): void; send(text: string): SendResult }) {
  const chat = useChat();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const list = useRef<FlatList<ChatEntry>>(null);
  const atBottom = useRef(true);

  const submit = () => {
    const r = send(text);
    if (r === "sent") {
      setText("");
      setError("");
      atBottom.current = true;
    } else if (r !== "empty") setError(ERRORS[r] || "");
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={list}
          data={chat.entries}
          keyExtractor={(e) => String(e.key)}
          renderItem={({ item }) => <Line e={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.system}>No messages yet.</Text>}
          onScroll={(ev) => {
            const { contentOffset, contentSize, layoutMeasurement } = ev.nativeEvent;
            atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => { if (atBottom.current) list.current?.scrollToEnd({ animated: false }); }}
          keyboardShouldPersistTaps="handled"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(t) => { setText(t); if (error) setError(""); }}
            placeholder="Message"
            placeholderTextColor={colors.muted}
            maxLength={CHAT_MAX}
            multiline
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={submit}
          />
          <Pressable onPress={submit} style={styles.send} accessibilityRole="button" accessibilityLabel="Send">
            <Text style={styles.sendText}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  line: { color: colors.text, fontSize: 15 },
  time: { color: colors.muted, fontSize: 12 },
  from: { fontWeight: "700" },
  link: { color: colors.accent, textDecorationLine: "underline" },
  system: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
  error: { color: colors.danger, paddingHorizontal: 12, paddingBottom: 6 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  input: { flex: 1, maxHeight: 120, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  send: { height: 44, width: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#000", fontSize: 18, fontWeight: "700" },
});
```

- [ ] **Step 3: Mount it** — in `Call.tsx`, inside the `styles.area` view after `<Controls ... />`:

```tsx
        <ChatSheet
          visible={sheet === "chat"}
          onClose={() => { setSheet(null); call()?.chat.setOpen(false); }}
          send={(t) => call()?.chat.send(t) ?? "offline"}
        />
```

and import `ChatSheet` from `../components/ChatSheet`.

- [ ] **Step 4: Type check, lint, tests**

Run: `cd mobile && npm run -s typecheck && npx eslint src && npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/ui/components/Sheet.tsx mobile/src/ui/components/ChatSheet.tsx mobile/src/ui/screens/Call.tsx
git commit -m "feat(mobile): chat bottom sheet with tappable links"
```

---

### Task 11: More sheet with rename

**Files:**
- Create: `mobile/src/ui/components/MoreSheet.tsx`
- Modify: `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `Sheet` (Task 10), `Call.rename` / `NAME_MAX` / `CallState.name` (Task 6).
- Produces: `MoreSheet` props `{ visible: boolean; onClose(): void; name: string; rename(n: string): "sent" | "empty" | "unchanged" | "offline" }`. 2b adds rows to this component.

- [ ] **Step 1: Create `MoreSheet.tsx`**:

```tsx
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { NAME_MAX } from "../../core/call";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";

type RenameResult = "sent" | "empty" | "unchanged" | "offline";
const MESSAGES: Partial<Record<RenameResult, string>> = {
  empty: "Enter a name.",
  offline: "Not connected — name not changed.",
};

export function MoreSheet({ visible, onClose, name, rename }: {
  visible: boolean; onClose(): void; name: string; rename(n: string): RenameResult;
}) {
  const [draft, setDraft] = useState(name);
  const [msg, setMsg] = useState("");
  // Follow the confirmed name (our own or one the server imposed) when not editing.
  useEffect(() => { setDraft(name); setMsg(""); }, [name, visible]);

  const submit = () => {
    const r = rename(draft);
    if (r === "sent") setMsg("Renaming…");
    else setMsg(MESSAGES[r] || "");
  };

  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.35}>
      <View style={styles.body}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          maxLength={NAME_MAX}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          onBlur={() => { if (draft.trim() !== name) submit(); }}
        />
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 8 },
  label: { color: colors.muted, textTransform: "uppercase", fontSize: 12 },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 12, fontSize: 16 },
  msg: { color: colors.muted },
});
```

- [ ] **Step 2: Mount it** — in `Call.tsx`, after `<ChatSheet ... />`:

```tsx
        <MoreSheet
          visible={sheet === "more"}
          onClose={() => setSheet(null)}
          name={state.name}
          rename={(n) => call()?.rename(n) ?? "offline"}
        />
```

and import `MoreSheet`.

- [ ] **Step 3: Type check, lint, tests**

Run: `cd mobile && npm run -s typecheck && npx eslint src && npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/ui/components/MoreSheet.tsx mobile/src/ui/screens/Call.tsx
git commit -m "feat(mobile): more sheet with in-call rename"
```

---

### Task 12: Screenshare tile, full-screen viewer and volume slider

**Files:**
- Create: `mobile/src/ui/components/ScreenTile.tsx`, `ScreenViewer.tsx`, `Slider.tsx`, `mobile/src/native/volume.ts`
- Modify: `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `gridTiles`, `screenFor`, `GridTile` (Task 8), `Participant.screen/screenAudio` (Task 2).
- Produces: `setStreamVolume(stream: StreamLike | null, volume: number): void` (0–2, 1 = 100%). `Slider` props `{ value: number; min: number; max: number; step: number; onChange(v: number): void; accessibilityLabel: string }` (reused by 2b's per-participant volume). `ScreenTile` props `{ p: Participant; width: number; height: number; onOpen(): void }`. `ScreenViewer` props `{ p: Participant | null; onClose(): void }`.

- [ ] **Step 1: Volume helper** — create `mobile/src/native/volume.ts`:

```ts
import type { StreamLike } from "../core/types";

// libwebrtc per-track gain (react-native-webrtc `_setVolume`, native on both
// platforms). 1 = 100%; we allow up to 2 (200%), as the web does.
export function setStreamVolume(stream: StreamLike | null, volume: number): void {
  const v = Math.max(0, Math.min(2, volume));
  for (const t of stream?.getTracks() ?? []) {
    const fn = (t as unknown as { _setVolume?: (v: number) => void })._setVolume;
    if (typeof fn === "function") fn.call(t, v);
  }
}
```

- [ ] **Step 2: Slider** — create `mobile/src/ui/components/Slider.tsx`:

```tsx
import React, { useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { colors } from "../theme";

// A minimal horizontal slider (no native dependency). Tap or drag anywhere on it.
export function Slider({ value, min, max, step, onChange, accessibilityLabel }: {
  value: number; min: number; max: number; step: number; onChange(v: number): void; accessibilityLabel: string;
}) {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  widthRef.current = width;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const toValue = (x: number) => {
    const raw = min + (Math.max(0, Math.min(widthRef.current, x)) / widthRef.current) * (max - min);
    return Math.round(raw / step) * step;
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => onChangeRef.current(toValue(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => onChangeRef.current(toValue(e.nativeEvent.locationX)),
  })).current;
  const frac = (value - min) / (max - min);
  return (
    <View
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onChange(Math.min(max, value + step));
        if (e.nativeEvent.actionName === "decrement") onChange(Math.max(min, value - step));
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      {...pan.panHandlers}
    >
      <View style={styles.rail} pointerEvents="none" />
      <View style={[styles.fill, { width: `${frac * 100}%` }]} pointerEvents="none" />
      <View style={[styles.thumb, { left: frac * width - 12 }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 40, justifyContent: "center" },
  rail: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  fill: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: colors.accent },
  thumb: { position: "absolute", width: 24, height: 24, borderRadius: 12, backgroundColor: colors.text },
});
```

- [ ] **Step 3: ScreenTile** — create `mobile/src/ui/components/ScreenTile.tsx`:

```tsx
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { Participant } from "../../core/roster";
import { colors } from "../theme";

export const ScreenTile = memo(function ScreenTileView({ p, width, height, onOpen }: {
  p: Participant; width: number; height: number; onOpen(): void;
}) {
  return (
    <Pressable style={[styles.tile, { width, height }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${p.name}'s screen, open full screen`}>
      {p.screen?.toURL ? (
        <RTCView streamURL={p.screen.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
      ) : (
        <Text style={styles.audioOnly}>🔊 Sharing audio</Text>
      )}
      <View style={styles.label}>
        <Text style={styles.name} numberOfLines={1}>🖥 {p.name} (screen)</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: "#000", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.bg },
  audioOnly: { color: colors.muted },
  label: { position: "absolute", left: 6, bottom: 6, right: 6 },
  name: { alignSelf: "flex-start", color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
});
```

- [ ] **Step 4: ScreenViewer** — create `mobile/src/ui/components/ScreenViewer.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Participant } from "../../core/roster";
import { setStreamVolume } from "../../native/volume";
import { colors } from "../theme";
import { Slider } from "./Slider";

const MAX_ZOOM = 5;
const dist = (t: ReadonlyArray<{ pageX: number; pageY: number }>) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

// Full-screen share: pinch to zoom, drag to pan, ⟲ rotates 90° (the app is
// portrait-locked), and a volume slider when the share has audio.
export function ScreenViewer({ p, onClose }: { p: Participant | null; onClose(): void }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rotated, setRotated] = useState(false);
  const [volume, setVolume] = useState(1);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const g = useRef({ scale: 1, x: 0, y: 0, startDist: 0, startScale: 1, startX: 0, startY: 0 }).current;

  const reset = () => {
    Object.assign(g, { scale: 1, x: 0, y: 0 });
    scale.setValue(1);
    tx.setValue(0);
    ty.setValue(0);
  };

  // The share ended (or a new one opened): close, or start fresh.
  useEffect(() => {
    if (!p) return;
    reset();
    setRotated(false);
    setVolume(1);
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setStreamVolume(p?.screenAudio ?? null, volume);
  }, [p?.screenAudio, volume]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches;
      g.startDist = t.length >= 2 ? dist(t) : 0;
      g.startScale = g.scale;
      g.startX = g.x;
      g.startY = g.y;
    },
    onPanResponderMove: (e, gs) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        if (!g.startDist) { g.startDist = dist(t); g.startScale = g.scale; return; }
        g.scale = Math.max(1, Math.min(MAX_ZOOM, g.startScale * (dist(t) / g.startDist)));
        scale.setValue(g.scale);
      } else if (g.scale > 1) {
        g.x = g.startX + gs.dx;
        g.y = g.startY + gs.dy;
        tx.setValue(g.x);
        ty.setValue(g.y);
      }
    },
    onPanResponderRelease: () => {
      if (g.scale <= 1.01) reset();
    },
  })).current;

  if (!p) return null;
  const w = rotated ? win.height : win.width;
  const h = rotated ? win.width : win.height;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait"]} statusBarTranslucent>
      <View style={styles.root} {...pan.panHandlers}>
        <Animated.View style={{ width: w, height: h, transform: [{ rotate: rotated ? "90deg" : "0deg" }, { translateX: tx }, { translateY: ty }, { scale }] }}>
          {p.screen?.toURL ? (
            <RTCView streamURL={p.screen.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
          ) : (
            <Text style={styles.audioOnly}>🔊 {p.name} is sharing audio</Text>
          )}
        </Animated.View>
      </View>
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <Pressable onPress={onClose} style={styles.btn} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.btnText}>✕</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{p.name} (screen)</Text>
        <Pressable onPress={() => { setRotated((r) => !r); reset(); }} style={styles.btn} accessibilityRole="button" accessibilityLabel="Rotate"><Text style={styles.btnText}>⟲</Text></Pressable>
      </View>
      {p.screenAudio ? (
        <View style={[styles.bottom, { bottom: insets.bottom + 12 }]}>
          <Text style={styles.vol}>Volume {Math.round(volume * 100)}%</Text>
          <Slider value={volume} min={0} max={2} step={0.05} onChange={setVolume} accessibilityLabel="Screen share volume" />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  audioOnly: { color: colors.muted, textAlign: "center", marginTop: "50%" },
  top: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, color: colors.text, textAlign: "center" },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  btnText: { color: colors.text, fontSize: 20 },
  bottom: { position: "absolute", left: 20, right: 20, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, padding: 12 },
  vol: { color: colors.text, marginBottom: 4 },
});
```

- [ ] **Step 5: Grid and viewer in `Call.tsx`**

Imports: `import { gridTiles, screenFor } from "../../core/tiles";`, `ScreenTile`, `ScreenViewer`.

Add state with the other hooks at the top: `const [viewing, setViewing] = useState<string | null>(null);`

Replace the tile layout computation and grid rendering:

```tsx
  const people = state.participants;
  const tiles = gridTiles(people);
  const gridH = height - CONTROLS_H;
  const cols = gridColumns(width, gridH, tiles.length);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(gridH / rows);
  const viewed = viewing ? screenFor(people, viewing) : null;
```

```tsx
          {tiles.length === 0 ? (
            <Text style={styles.waiting}>{state.phase === "connecting" ? "Connecting…" : `Waiting for others in #${state.slug}…`}</Text>
          ) : (
            tiles.map((t) => t.kind === "screen"
              ? <ScreenTile key={t.key} p={t.p} width={tileW} height={tileH} onOpen={() => setViewing(t.p.id)} />
              : <Tile key={t.key} p={t.p} width={tileW} height={tileH} />)
          )}
```

After `<MoreSheet ... />` add `<ScreenViewer p={viewed} onClose={() => setViewing(null)} />`. Because `viewed` becomes `null` as soon as the share's slots clear, the viewer closes itself when the share ends; also add an effect so a stale id doesn't linger:

```tsx
  useEffect(() => {
    if (viewing && state && !screenFor(state.participants, viewing)) setViewing(null);
  }, [viewing, state]);
```

(Place this effect with the other hooks, above the early return.)

- [ ] **Step 6: Type check, lint, tests**

Run: `cd mobile && npm run -s typecheck && npx eslint src && npx jest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/native/volume.ts mobile/src/ui/components/Slider.tsx mobile/src/ui/components/ScreenTile.tsx mobile/src/ui/components/ScreenViewer.tsx mobile/src/ui/screens/Call.tsx
git commit -m "feat(mobile): screenshare tiles and a full-screen viewer with zoom, rotate and volume"
```

---

### Task 13: Manual test checklist, version 1.1.0 and spec corrections

**Files:**
- Modify: `mobile/MANUAL-TEST.md`, `mobile/android/app/build.gradle`, `mobile/ios/Coyote.xcodeproj/project.pbxproj`, `docs/superpowers/specs/2026-10-11-mobile-room-features-design.md`

- [ ] **Step 1: Manual checklist** — append a section to `mobile/MANUAL-TEST.md` (continue the existing numbering; replace `N` with the next number):

```markdown
## Room features (2a)

Solo setup: the phone plus a browser on a computer **with headphones** (prevents
feedback), both in the same room.

N. **Chat.** Open chat (💬). The history sent before you joined is there once, in
   order. Send a message from each side; each appears on both. Close the sheet, send
   from the browser: the badge counts up; open: it clears. A link such as
   `https://example.com/a_(b).` opens the browser at `https://example.com/a_(b)`;
   `javascript:alert(1)` is plain text.
N+1. **Chat while reconnecting.** Turn on airplane mode for 5 s, type a message, send:
   "Not connected — message not sent", text kept. Reconnect: the history is not
   duplicated.
N+2. **Rename.** ☰ → Name → change it. The browser shows the new name; leave and
   rejoin: the lobby has the new name. With an invite link that locks the name,
   renaming does not change your saved default.
N+3. **Room timer.** The top bar shows `#room · m:ss`, matching the browser's timer.
N+4. **Chimes.** Browser joins: door chime on the phone. Browser leaves: drop chime
   ~6 s later. Browser reloads quickly: no chimes. Chimes follow the current audio
   route (earpiece / speaker / Bluetooth). iOS: the Xcode console shows no new
   `AVAudioSession` warnings.
N+5. **Screenshare.** Browser shares a tab with audio: a "Name (screen)" tile appears
   with a bloop. Tap it: full screen; pinch to zoom, drag to pan, ⟲ rotates, the
   volume slider changes the shared tab's audio (0–200%). Stop sharing in the
   browser: the viewer closes and the tile goes. Lock the phone during a share and
   unlock: no second bloop.
N+6. **Flip camera** from the ⟳ on the self-view tile.
```

- [ ] **Step 2: Version 1.1.0** — in `mobile/android/app/build.gradle` set `versionCode 4` and `versionName "1.1.0"`; in `project.pbxproj` set both `CURRENT_PROJECT_VERSION = 4;` and both `MARKETING_VERSION = 1.1.0;`.

```bash
cd mobile && sed -i 's/versionCode 3/versionCode 4/; s/versionName "1.0.2"/versionName "1.1.0"/' android/app/build.gradle
sed -i 's/CURRENT_PROJECT_VERSION = 3;/CURRENT_PROJECT_VERSION = 4;/; s/MARKETING_VERSION = 1.0.2;/MARKETING_VERSION = 1.1.0;/' ios/Coyote.xcodeproj/project.pbxproj
grep -n "versionCode\|versionName" android/app/build.gradle; grep -n "MARKETING_VERSION\|CURRENT_PROJECT_VERSION" ios/Coyote.xcodeproj/project.pbxproj
```

Expected: `versionCode 4`, `versionName "1.1.0"`, two `CURRENT_PROJECT_VERSION = 4;`, two `MARKETING_VERSION = 1.1.0;`.

- [ ] **Step 3: Spec corrections** — in the spec, make two edits so it matches the implementation:
  - In "Wiring", replace "`CallState` gains no new fields." with "`CallState` gains only `name` (your confirmed display name, for the ☰ Name row); chat and other room traffic stay out of it."
  - In "Sound playback", replace "`SoundPool` for the short chimes and `MediaPlayer` for board clips" with "`MediaPlayer` for both chimes and board clips".

- [ ] **Step 4: Full verification**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/MANUAL-TEST.md mobile/android/app/build.gradle mobile/ios/Coyote.xcodeproj/project.pbxproj docs/superpowers/specs/2026-10-11-mobile-room-features-design.md
git commit -m "chore(mobile): 1.1.0 (build 4) with the Room features 2a manual checklist"
```
