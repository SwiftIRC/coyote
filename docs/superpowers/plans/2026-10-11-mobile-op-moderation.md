# Mobile Op Moderation (1.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an op in the Coyote mobile app kick, ban, mute, stop a share, make op, lock/unlock and set room quality, and make a room lock survive members' reconnects on the server.

**Architecture:** A server change (admitted session refs bypass the room password; `joined.locked`), a pure-TS `Moderation` store beside `Call` (same pattern as `Polls`), and UI in the existing long-press sheet, the screenshare viewer, the ☰ More sheet and the top bar.

**Tech Stack:** Go (server, `internal/room`, `internal/signal`), vanilla JS (web, `internal/web/assets/app.js`), React Native + TypeScript (`mobile/`), Jest.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-op-moderation-design.md`

## Global Constraints

- Commit messages: **no `Co-Authored-By` trailer.** Conventional style as in `git log` (`feat(mobile): …`, `fix(server): …`).
- Do not push, do not merge. Work on branch `feat/mobile-op-moderation`.
- No new third-party dependencies (npm or Go). No native (Swift/Kotlin) changes.
- Wire protocol: only addition is `joined.locked` (always present, not `omitempty`).
- Layering: `mobile/src/core/` imports nothing from React Native.
- Verification commands — Go: `go test ./...` (repo root). Mobile (in `mobile/`): `npx jest`, `npm run typecheck`, `npm run lint`. All must pass at the end of every task.
- Copy (verbatim):
  - Kick confirm: title `Kick <name>?`, message `They'll be removed from the call.`, button `Kick` (destructive).
  - Ban confirm: title `Ban <name>?`, message `They'll be removed and blocked from rejoining.`, button `Ban` (destructive).
  - Make op confirm: title `Make <name> an op?`, message `They'll be able to kick, ban and mute anyone. This can't be undone.`, button `Make op`.
  - Locked-while-away: `The room was locked while you were reconnecting. Enter the password to rejoin.`
  - not-op in call: `That needs op, and the server says you don't have it. Rejoining will pick it back up.`
  - Result notices: offline `Not connected — try again.`; not-op `Only ops can do that.`
- Version 1.3.0: iOS `MARKETING_VERSION = 1.3.0`, `CURRENT_PROJECT_VERSION = 6`; Android `versionName "1.3.0"`, `versionCode 6`.

## Review Focus

1. **Kicked person while locked** — a kicked participant reconnecting with their old session must be refused even though their ref was once admitted (Task 1 test).
2. **Ref is empty** (client without a session nonce) — must never be stored or bypass the lock (Task 1 test).
3. **Old server, no `joined.locked`** — a rejoin must not reset `locked` to the peek value from before the call (Task 2 test).
4. **A first-join `bad-password`** must keep its old wording; only a rejoin gets locked-while-away (Task 3 test).
5. **Role changes while a sheet is open** — becoming op mid-call must reveal the actions without reopening; the PersonSheet reads `isOp` from live state (Task 4, reviewed by reading `Call.tsx`).

---

### Task 1: Server — admitted refs survive a lock; `joined.locked`; web reads it

**Files:**
- Modify: `internal/room/room.go` (struct ~line 99, `New` ~line 150, `Join` ~174-226, `Kick` ~410, `Ban` ~432)
- Modify: `internal/signal/messages.go:148-155` (`Joined`)
- Modify: `internal/web/assets/app.js` (`onJoined`, ~line 259)
- Test: `internal/room/room_test.go`

**Interfaces:**
- Produces: `signal.Joined.Locked bool` → JSON `"locked"` (always present). Later mobile tasks read `joined.locked`.

- [ ] **Step 1: Write the failing tests** — append to `internal/room/room_test.go`:

```go
// A member admitted before the lock rejoins (same session ref) with the password it
// joined with — "" — and must get back in; anyone new still needs the password.
func TestLockAdmitsKnownRefOnRejoin(t *testing.T) {
	r := New(Config{Slug: "s", Adhoc: true})
	op, _ := member("p1", "op", RoleUser)
	op.Ref = "rop"
	if err := r.Join(op, ""); err != nil {
		t.Fatal(err)
	}
	bob, _ := member("p2", "bob", RoleUser)
	bob.Ref = "rbob"
	if err := r.Join(bob, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.SetLock("p1", "sesame"); err != nil {
		t.Fatal(err)
	}
	r.Leave("p2") // bob's connection drops
	bob2, _ := member("p3", "bob", RoleUser)
	bob2.Ref = "rbob"
	if err := r.Join(bob2, ""); err != nil {
		t.Errorf("known ref rejoin while locked: %v", err)
	}
	eve, _ := member("p4", "eve", RoleUser)
	eve.Ref = "reve"
	if err := r.Join(eve, ""); err != ErrBadPassword {
		t.Errorf("new ref without password: %v, want ErrBadPassword", err)
	}
	if err := r.Join(eve, "sesame"); err != nil {
		t.Errorf("new ref with password: %v", err)
	}
}

// An empty ref is never remembered, so ref-less joiners can't share a bypass.
func TestLockEmptyRefNeverBypasses(t *testing.T) {
	r := New(Config{Slug: "s", Adhoc: true})
	op, _ := member("p1", "op", RoleUser)
	r.Join(op, "")
	anon, _ := member("p2", "anon", RoleUser) // Ref ""
	r.Join(anon, "")
	r.SetLock("p1", "sesame")
	anon2, _ := member("p3", "anon2", RoleUser)
	if err := r.Join(anon2, ""); err != ErrBadPassword {
		t.Errorf("empty ref while locked: %v, want ErrBadPassword", err)
	}
}

// Kick and ban forget the target's ref, so the old session can't slip past a lock.
func TestLockKickedOrBannedRefRefused(t *testing.T) {
	for _, action := range []string{"kick", "ban"} {
		r := New(Config{Slug: "s", Adhoc: true})
		op, _ := member("p1", "op", RoleUser)
		op.Ref = "rop"
		r.Join(op, "")
		bob, _ := member("p2", "bob", RoleUser)
		bob.Ref = "rbob"
		bob.IP = "198.51.100.7"
		r.Join(bob, "")
		var err error
		if action == "kick" {
			err = r.Kick("p1", "p2")
		} else {
			err = r.Ban("p1", "p2")
		}
		if err != nil {
			t.Fatal(err)
		}
		r.SetLock("p1", "sesame")
		bob2, _ := member("p3", "bob", RoleUser)
		bob2.Ref = "rbob"
		bob2.IP = "198.51.100.7"
		if err := r.Join(bob2, ""); err != ErrBadPassword {
			t.Errorf("%s: rejoin while locked = %v, want ErrBadPassword", action, err)
		}
	}
}

func TestJoinedCarriesLocked(t *testing.T) {
	r := New(Config{Slug: "s", Adhoc: true})
	op, _ := member("p1", "op", RoleUser)
	r.Join(op, "")
	early, ec := member("p2", "early", RoleUser)
	r.Join(early, "")
	if j := ec.msgs[0].(signal.Joined); j.Locked {
		t.Error("joined.locked true before lock")
	}
	r.SetLock("p1", "sesame")
	late, lc := member("p3", "late", RoleUser)
	if err := r.Join(late, "sesame"); err != nil {
		t.Fatal(err)
	}
	if j := lc.msgs[0].(signal.Joined); !j.Locked {
		t.Error("joined.locked false for a joiner of a locked room")
	}
}
```

Also add to `internal/signal/messages_test.go` (or the file there that tests JSON encoding — check with `grep -n "Joined" internal/signal/*_test.go`; if none, add this test to `messages_test.go`):

```go
func TestJoinedLockedAlwaysEncoded(t *testing.T) {
	b, err := json.Marshal(Joined{SelfID: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"locked":false`) {
		t.Errorf("joined JSON %s lacks \"locked\":false — it must not be omitempty", b)
	}
}
```

(Add `encoding/json` / `strings` imports if the file lacks them. If `Joined` is normally encoded through a wrapper that adds `type`, still marshal the bare struct here.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/room/ ./internal/signal/`
Expected: FAIL — `j.Locked undefined` (compile error) first.

- [ ] **Step 3: Implement**

`internal/signal/messages.go`, in `Joined` after `Poll`:

```go
	Locked     bool          `json:"locked"`            // room is password-locked; never omitempty so "false" is distinguishable from an older server
```

`internal/room/room.go`:

1. In `Room` struct, after the `opRefs` field (keep its comment block intact), add:

```go
	// admittedRefs are the session refs of everyone this room has let in. A rejoin
	// carrying one skips the password check, so locking a room mid-call doesn't lock
	// out its own members on their next reconnect (they rejoin with the password they
	// typed before the lock). Kick and Ban forget the target's ref.
	admittedRefs map[string]struct{}
```

2. In `New`, add `admittedRefs: map[string]struct{}{},` beside `opRefs`.

3. In `Join`, replace the password check:

```go
	if r.locked && subtle.ConstantTimeCompare([]byte(password), []byte(r.password)) != 1 {
```

with:

```go
	_, admitted := r.admittedRefs[p.Ref]
	if r.locked && !(p.Ref != "" && admitted) && subtle.ConstantTimeCompare([]byte(password), []byte(r.password)) != 1 {
```

4. In `Join`, right after `r.hasBeenJoined = true`, add:

```go
	if p.Ref != "" {
		r.admittedRefs[p.Ref] = struct{}{}
	}
```

5. In `Join`, capture `locked := r.locked` beside `quality := ...` (before `r.mu.Unlock()`), and add `Locked: locked` to the `signal.Joined{...}` literal.

6. In `Kick`, after the `r.target(targetID)` error check, add:

```go
	r.forgetRef(tgt.Ref)
```

In `Ban`, inside the existing `r.mu.Lock()` … `r.mu.Unlock()` block that records the ban, add `delete(r.admittedRefs, tgt.Ref)` before the unlock (do not call `forgetRef` there — the lock is held).

7. Add the helper after `rememberOp`:

```go
// forgetRef drops a removed participant's session ref from admittedRefs, so the old
// session can't rejoin past a lock.
func (r *Room) forgetRef(ref string) {
	r.mu.Lock()
	delete(r.admittedRefs, ref)
	r.mu.Unlock()
}
```

`internal/web/assets/app.js`, in `onJoined` directly after the `if (msg.quality) sessionQuality = …` line:

```js
  // A late joiner (or a reconnect) learns the lock from joined, not only from broadcasts.
  controls.onLock(!!msg.locked);
```

Check first that `controls` exists at that point on the FIRST join (it may be built later in `onJoined`). If it is null on first join, instead place the call (a) inside the `if (grid) { … }` reconnect branch before its `return`, and (b) right after `controls` is constructed in the first-join path. Run `grep -n "controls = " internal/web/assets/app.js` to find the construction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./...`
Expected: PASS (all packages). If an existing golden/JSON test for `Joined` now fails because of the new `"locked":false`, update its expected JSON — that change is intended.

Run: `node --check internal/web/assets/app.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add internal/room/room.go internal/room/room_test.go internal/signal/ internal/web/assets/app.js
git commit -m "fix(server): members survive a room lock on reconnect; joined carries locked"
```

---

### Task 2: `Moderation` store (`mobile/src/core/moderation.ts`)

**Files:**
- Create: `mobile/src/core/moderation.ts`
- Test: `mobile/test/moderation.test.ts`

**Interfaces:**
- Consumes: `Sender` type from `mobile/src/core/chat.ts` (`(type: string, fields: Record<string, unknown>) => boolean`), `Frame` from `./types`, `QUALITY_TIERS` from `../shared/web`.
- Produces:
  ```ts
  export type ModResult = "sent" | "offline" | "not-op" | "invalid";
  export type QualityTarget = "camera" | "screen";
  export interface ModSnapshot { locked: boolean; quality: { camera: string; screen: string } }
  export const MOD_RESULT_TEXT: Partial<Record<ModResult, string>>;
  export class Moderation {
    constructor(sender: Sender, isOp: () => boolean);
    seed(joined: Frame, peekLocked: boolean, first: boolean): void;
    onLocked(locked: boolean): void;
    onQuality(m: Frame): void;
    muteMic(id: string): ModResult; stopShare(id: string): ModResult; grantOp(id: string): ModResult;
    kick(id: string): ModResult; ban(id: string): ModResult;
    lock(password: string): ModResult; unlock(): ModResult;
    setQuality(target: QualityTarget, tier: string): ModResult;
    subscribe(fn: () => void): () => void; getSnapshot(): ModSnapshot;
  }
  ```

- [ ] **Step 1: Write the failing test** — `mobile/test/moderation.test.ts`:

```ts
import { MOD_RESULT_TEXT, Moderation } from "../src/core/moderation";

function make(op = true, connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const mod = new Moderation((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => op);
  return { mod, sent };
}
const joined = (over = {}) => ({ type: "joined", quality: { camera: "low", screen: "" }, ...over });

test("seeds locked and quality from joined; empty tier is auto", () => {
  const { mod } = make();
  mod.seed(joined({ locked: true }), false, true);
  expect(mod.getSnapshot()).toEqual({ locked: true, quality: { camera: "low", screen: "auto" } });
  mod.seed(joined({ locked: false }), true, false);
  expect(mod.getSnapshot().locked).toBe(false); // the server's value wins over the peek
});

test("older server (no joined.locked): first join uses the peek, a rejoin keeps the current value", () => {
  const { mod } = make();
  mod.seed(joined(), true, true);
  expect(mod.getSnapshot().locked).toBe(true);
  mod.onLocked(false);
  mod.seed(joined(), true, false); // stale pre-call peek must not resurrect the lock
  expect(mod.getSnapshot().locked).toBe(false);
});

test("lock, unlock and quality broadcasts update the snapshot; identity changes only on change", () => {
  const { mod } = make();
  mod.seed(joined({ locked: false }), false, true);
  const s0 = mod.getSnapshot();
  expect(mod.getSnapshot()).toBe(s0);
  let calls = 0;
  const off = mod.subscribe(() => calls++);
  mod.onLocked(true);
  expect(mod.getSnapshot().locked).toBe(true);
  mod.onQuality({ type: "quality", camera: "high", screen: "" });
  expect(mod.getSnapshot().quality).toEqual({ camera: "high", screen: "auto" });
  expect(calls).toBe(2);
  off();
  mod.onLocked(false);
  expect(calls).toBe(2);
});

test("each action sends the exact frame", () => {
  const { mod, sent } = make();
  expect(mod.muteMic("p2")).toBe("sent");
  expect(mod.stopShare("p2")).toBe("sent");
  expect(mod.grantOp("p2")).toBe("sent");
  expect(mod.kick("p2")).toBe("sent");
  expect(mod.ban("p2")).toBe("sent");
  expect(mod.lock("  sesame ")).toBe("sent");
  expect(mod.unlock()).toBe("sent");
  expect(mod.setQuality("camera", "low")).toBe("sent");
  expect(mod.setQuality("screen", "auto")).toBe("sent");
  expect(sent).toEqual([
    { type: "mute-peer", fields: { id: "p2", kind: "mic" } },
    { type: "mute-peer", fields: { id: "p2", kind: "screen" } },
    { type: "grant-op", fields: { id: "p2" } },
    { type: "kick", fields: { id: "p2" } },
    { type: "ban", fields: { id: "p2" } },
    { type: "set-lock", fields: { password: "sesame" } },
    { type: "set-lock", fields: {} },
    { type: "set-quality", fields: { target: "camera", tier: "low" } },
    { type: "set-quality", fields: { target: "screen", tier: "auto" } },
  ]);
});

test("sending never changes state; only broadcasts do", () => {
  const { mod } = make();
  mod.seed(joined({ locked: false }), false, true);
  const s0 = mod.getSnapshot();
  mod.lock("x");
  mod.setQuality("camera", "high");
  expect(mod.getSnapshot()).toBe(s0);
});

test("refusals: not-op first, then invalid, then offline; nothing is sent", () => {
  const nonOp = make(false);
  expect(nonOp.mod.kick("p2")).toBe("not-op");
  expect(nonOp.mod.lock("")).toBe("not-op");
  expect(nonOp.sent).toEqual([]);
  const { mod, sent } = make();
  expect(mod.lock("   ")).toBe("invalid");
  expect(mod.setQuality("camera", "potato")).toBe("invalid");
  expect(mod.setQuality("mic" as never, "low")).toBe("invalid");
  expect(mod.kick("")).toBe("invalid");
  expect(sent).toEqual([]);
  const off = make(true, false);
  expect(off.mod.kick("p2")).toBe("offline");
  expect(off.mod.lock("x")).toBe("offline");
});

test("result notices", () => {
  expect(MOD_RESULT_TEXT.offline).toBe("Not connected — try again.");
  expect(MOD_RESULT_TEXT["not-op"]).toBe("Only ops can do that.");
  expect(MOD_RESULT_TEXT.sent).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `mobile/`): `npx jest test/moderation.test.ts`
Expected: FAIL — cannot find module `../src/core/moderation`.

- [ ] **Step 3: Implement** — `mobile/src/core/moderation.ts`:

```ts
// Op moderation: the room's lock and quality as the server last announced them, and
// the op commands. Nothing changes on send — the display follows the server's
// broadcasts, as on the web. Snapshots are replaced on change for useSyncExternalStore.
import { QUALITY_TIERS } from "../shared/web";
import type { Sender } from "./chat";
import type { Frame } from "./types";

export type ModResult = "sent" | "offline" | "not-op" | "invalid";
export type QualityTarget = "camera" | "screen";
export interface ModSnapshot {
  locked: boolean;
  quality: { camera: string; screen: string };
}

export const MOD_RESULT_TEXT: Partial<Record<ModResult, string>> = {
  offline: "Not connected — try again.",
  "not-op": "Only ops can do that.",
};

const TIERS = new Set<string>(QUALITY_TIERS.map((t: { id: string }) => t.id));
const tierOf = (v: unknown) => (typeof v === "string" && v !== "" ? v : "auto");

export class Moderation {
  private snap: ModSnapshot = { locked: false, quality: { camera: "auto", screen: "auto" } };
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private isOp: () => boolean) {}

  // On every joined. An older server omits `locked`: the first join falls back to
  // PreJoin's peek; a rejoin keeps what the broadcasts already told us.
  seed(joined: Frame, peekLocked: boolean, first: boolean): void {
    const locked = typeof joined.locked === "boolean" ? joined.locked : first ? peekLocked : this.snap.locked;
    const q = joined.quality || {};
    this.set({ locked, quality: { camera: tierOf(q.camera), screen: tierOf(q.screen) } });
  }

  onLocked(locked: boolean): void {
    if (locked !== this.snap.locked) this.set({ ...this.snap, locked });
  }

  onQuality(m: Frame): void {
    this.set({ ...this.snap, quality: { camera: tierOf(m.camera), screen: tierOf(m.screen) } });
  }

  muteMic(id: string): ModResult { return this.toPeer("mute-peer", id, { kind: "mic" }); }
  stopShare(id: string): ModResult { return this.toPeer("mute-peer", id, { kind: "screen" }); }
  grantOp(id: string): ModResult { return this.toPeer("grant-op", id); }
  kick(id: string): ModResult { return this.toPeer("kick", id); }
  ban(id: string): ModResult { return this.toPeer("ban", id); }

  lock(password: string): ModResult {
    if (!this.isOp()) return "not-op";
    const pw = password.trim();
    if (!pw) return "invalid";
    return this.send("set-lock", { password: pw });
  }

  unlock(): ModResult {
    if (!this.isOp()) return "not-op";
    return this.send("set-lock", {});
  }

  setQuality(target: QualityTarget, tier: string): ModResult {
    if (!this.isOp()) return "not-op";
    if ((target !== "camera" && target !== "screen") || !TIERS.has(tier)) return "invalid";
    return this.send("set-quality", { target, tier });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ModSnapshot => this.snap;

  private toPeer(type: string, id: string, extra: Record<string, unknown> = {}): ModResult {
    if (!this.isOp()) return "not-op";
    if (!id) return "invalid";
    return this.send(type, { id, ...extra });
  }

  private send(type: string, fields: Record<string, unknown>): ModResult {
    return this.sender(type, fields) ? "sent" : "offline";
  }

  private set(next: ModSnapshot) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
```

If `QUALITY_TIERS` is typed `any` and lint complains about the explicit param type, keep the annotation minimal so `tsc` and ESLint pass; do not add a `.d.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run (in `mobile/`): `npx jest test/moderation.test.ts && npm run typecheck && npm run lint`
Expected: PASS, no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/moderation.ts mobile/test/moderation.test.ts
git commit -m "feat(mobile): Moderation store for op commands, room lock and quality"
```

---

### Task 3: Wire `Moderation` into `Call`; locked-while-away; not-op text; PreJoin peek

**Files:**
- Modify: `mobile/src/core/call.ts` (imports; `JoinRequest` :50-58; fields :97-100; constructor :133-139; `join` handlers :184-212; `onJoined` :398-423; `onServerError` :425-433; `onQuality` :456-459)
- Modify: `mobile/src/core/errors.ts`
- Modify: `mobile/src/ui/screens/PreJoin.tsx:138`
- Test: `mobile/test/call.test.ts`, `mobile/test/errors.test.ts`

**Interfaces:**
- Consumes: `Moderation` (Task 2): `seed(joined, peekLocked, first)`, `onLocked(bool)`, `onQuality(frame)`.
- Produces: `call.moderation: Moderation` (readonly); `JoinRequest.locked?: boolean`; `CallOutcome` `rejected` with `code: "locked-while-away"`; `export const LOCKED_WHILE_AWAY_TEXT` in `errors.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/test/call.test.ts` (uses the file's existing `setup`, `req`, `joined`, `sock`, `inCall`, `framesOf`, `flush`):

```ts
test("moderation: seeded from joined, follows lock and quality broadcasts, commands go out", async () => {
  const t = setup();
  await t.call.join(req());
  sock().open();
  sock().receive(joined({ role: "op", locked: true }));
  await flush();
  expect(t.call.moderation.getSnapshot()).toEqual({ locked: true, quality: { camera: "low", screen: "auto" } });
  sock().receive({ type: "room-unlocked" });
  expect(t.call.moderation.getSnapshot().locked).toBe(false);
  sock().receive({ type: "room-locked" });
  expect(t.call.moderation.getSnapshot().locked).toBe(true);
  sock().receive({ type: "quality", camera: "high", screen: "low" });
  expect(t.call.moderation.getSnapshot().quality).toEqual({ camera: "high", screen: "low" });
  expect(t.peers[0].quality).toEqual(["high", "low"]); // still applied to the peer
  expect(t.call.moderation.kick("p1")).toBe("sent");
  expect(framesOf("kick")).toEqual([{ type: "kick", id: "p1" }]);
});

test("moderation: non-op is refused locally; offline while reconnecting", async () => {
  const t = await inCall(); // role "user"
  expect(t.call.moderation.kick("p1")).toBe("not-op");
  sock().receive({ type: "role", id: "me", role: "op" });
  expect(t.call.moderation.kick("p1")).toBe("sent");
  sock().drop();
  expect(t.call.moderation.kick("p1")).toBe("offline");
});

test("moderation: older server falls back to the PreJoin peek on first join only", async () => {
  const t = setup();
  await t.call.join(req({ locked: true }));
  sock().open();
  sock().receive(joined()); // no `locked` field
  await flush();
  expect(t.call.moderation.getSnapshot().locked).toBe(true);
  sock().receive({ type: "room-unlocked" });
  sock().drop();
  t.timers.advance(500);
  sock().open();
  sock().receive(joined());
  await flush();
  expect(t.call.moderation.getSnapshot().locked).toBe(false);
});

test("bad-password on a rejoin: the room was locked while away; back to PreJoin, no loop", async () => {
  const { call, timers, ends } = await inCall();
  sock().drop();
  timers.advance(500);
  sock().open();
  sock().receive({ type: "error", code: "bad-password", message: "x" });
  expect(ends).toEqual([{
    kind: "rejected", code: "locked-while-away",
    text: "The room was locked while you were reconnecting. Enter the password to rejoin.",
  }]);
  timers.advance(60_000);
  expect(FakeSocket.all).toHaveLength(2);
  expect(call.getState().phase).toBe("ended");
});

test("not-op in a call uses the app's wording", async () => {
  const { notices } = await inCall();
  sock().receive({ type: "error", code: "not-op", message: "x" });
  expect(notices).toEqual(["That needs op, and the server says you don't have it. Rejoining will pick it back up."]);
});
```

The existing test "an error before joined ends the call as rejected…" already pins the first-join `bad-password` wording (`Wrong password for this room.`); it must still pass unchanged.

Append to `mobile/test/errors.test.ts`:

```ts
import { inCallErrorText as inCallText2 } from "../src/core/errors";

test("not-op in-call wording says rejoining, not reloading", () => {
  expect(inCallText2("not-op")).toBe("That needs op, and the server says you don't have it. Rejoining will pick it back up.");
  expect(inCallText2("no-such-peer")).toBe("They already left the call.");
});
```

(If `errors.test.ts` already imports `inCallErrorText`, use that name and drop the aliased import.)

- [ ] **Step 2: Run tests to verify they fail**

Run (in `mobile/`): `npx jest test/call.test.ts test/errors.test.ts`
Expected: FAIL — `call.moderation` undefined / TS error on `locked` in `req`, wrong texts.

- [ ] **Step 3: Implement**

`mobile/src/core/errors.ts` — add, and use in `inCallErrorText`:

```ts
// The web says "Reloading will pick it back up"; the app has no page to reload.
const IN_CALL_OVERRIDES: Record<string, string> = {
  "not-op": "That needs op, and the server says you don't have it. Rejoining will pick it back up.",
};

export const LOCKED_WHILE_AWAY_TEXT = "The room was locked while you were reconnecting. Enter the password to rejoin.";

export function inCallErrorText(code: string, message = ""): string {
  return IN_CALL_OVERRIDES[code] || serverErrorDisposition({ code, message, inCall: true }).text;
}
```

`mobile/src/core/call.ts`:

1. Imports: `import { inCallErrorText, joinErrorText, LOCKED_WHILE_AWAY_TEXT } from "./errors";` and `import { Moderation } from "./moderation";`.
2. `JoinRequest`: add `locked?: boolean; // PreJoin's last peek; used only if the server's joined omits it`.
3. Field: `readonly moderation: Moderation;` beside `readonly polls: Polls;`.
4. Constructor, after `this.polls = …`:
   ```ts
   this.moderation = new Moderation((type, fields) => this.trySend(type, fields), () => this.state.role === "op");
   ```
5. In `join`, after `sig.on("quality", …)`:
   ```ts
   sig.on("room-locked", () => this.moderation.onLocked(true));
   sig.on("room-unlocked", () => this.moderation.onLocked(false));
   ```
6. In `onJoined`, after `this.polls.seed(m.poll);`:
   ```ts
   this.moderation.seed(m, !!this.req?.locked, first);
   ```
7. In `onServerError`, at the top of the fatal branch:
   ```ts
   if (this.awaitingJoined || !this.joinedOnce) {
     // A rejoin refused for the password: the room was locked while we were away
     // (an older server; a current one admits members it already let in).
     if (this.joinedOnce && m.code === "bad-password") {
       this.finish({ kind: "rejected", code: "locked-while-away", text: LOCKED_WHILE_AWAY_TEXT });
       return;
     }
     this.finish({ kind: "rejected", code: m.code || "error", text: joinErrorText(m.code || "", m.message || "") });
     return;
   }
   ```
8. In `onQuality`, add `this.moderation.onQuality(m);` as the last line.

`mobile/src/ui/screens/PreJoin.tsx:138` — pass the peek:

```ts
const joined = join({ link, name: finalName, password, gravatar: gravatarHash(email), mic, camera, dataSaver, locked: !!room?.locked });
```

(`Call.tsx` needs no change: a `rejected` outcome already returns to PreJoin with `outcome.text` as the error.)

- [ ] **Step 4: Run tests to verify they pass**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/call.ts mobile/src/core/errors.ts mobile/src/ui/screens/PreJoin.tsx mobile/test/call.test.ts mobile/test/errors.test.ts
git commit -m "feat(mobile): wire Moderation into Call; explain a lock that happened while reconnecting"
```

---

### Task 4: Person sheet, Stop share in the viewer, lock in the top bar

**Files:**
- Create: `mobile/src/ui/components/PersonSheet.tsx` (replaces `VolumeSheet.tsx`, which is deleted)
- Delete: `mobile/src/ui/components/VolumeSheet.tsx`
- Modify: `mobile/src/ui/hooks.ts` (add `useModeration`)
- Modify: `mobile/src/ui/components/ScreenViewer.tsx`
- Modify: `mobile/src/ui/components/TopBar.tsx`
- Modify: `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `call.moderation` (Task 3), `ModResult`, `ModSnapshot`, `MOD_RESULT_TEXT` (Task 2), `Participant` from `core/roster`.
- Produces: `useModeration(): ModSnapshot` in `ui/hooks.ts` (Task 5 uses it); `PersonSheet` component.

There are no React component tests in this repo (`jest.config.js` matches `*.test.ts` only); verification is `tsc`, ESLint and the manual checklist (Task 6).

- [ ] **Step 1: Add the hook** — in `mobile/src/ui/hooks.ts`:

```ts
import type { ModSnapshot } from "../core/moderation";

const EMPTY_MOD: ModSnapshot = { locked: false, quality: { camera: "auto", screen: "auto" } };

export function useModeration(): ModSnapshot {
  const { call } = useCall();
  return useStore(call()?.moderation ?? null, EMPTY_MOD);
}
```

- [ ] **Step 2: Create `PersonSheet.tsx`**

```tsx
import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MOD_RESULT_TEXT, type ModResult } from "../../core/moderation";
import type { Participant } from "../../core/roster";
import { VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../core/volumes";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";
import { Slider } from "./Slider";

export interface PersonActions {
  muteMic(id: string): ModResult;
  grantOp(id: string): ModResult;
  kick(id: string): ModResult;
  ban(id: string): ModResult;
}

// Long-press a tile: the person's volume for everyone, and for ops the moderation
// actions. Kick, Ban and Make op ask first; Mute is a nudge they can undo.
export function PersonSheet({ p, volume, onChange, onClose, isOp, actions }: {
  p: Participant | null; volume: number; onChange(v: number): void; onClose(): void;
  isOp: boolean; actions: PersonActions;
}) {
  const [msg, setMsg] = useState("");
  const id = p?.id;
  useEffect(() => { setMsg(""); }, [id]);

  const run = (r: ModResult, closeOnSent = false) => {
    if (r === "sent" && closeOnSent) onClose();
    else setMsg(MOD_RESULT_TEXT[r] || "");
  };
  const confirm = (title: string, message: string, label: string, destructive: boolean, act: () => void) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: destructive ? "destructive" : "default", onPress: act },
    ]);

  const name = p?.name ?? "";
  const pid = p?.id ?? "";
  return (
    <Sheet visible={!!p} onClose={onClose} heightFraction={isOp ? 0.5 : 0.25}>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{p?.role === "op" ? "@" : ""}{name}</Text>
        <Text style={styles.value}>Volume {Math.round(volume * 100)}%</Text>
        <Slider value={volume} min={VOLUME_MIN} max={VOLUME_MAX} step={VOLUME_STEP} onChange={onChange}
          accessibilityLabel={`${name} volume`} />
        {isOp && p ? (
          <View style={styles.actions}>
            <View style={styles.row}>
              <Pressable
                onPress={() => run(actions.muteMic(pid))}
                disabled={!p.mic}
                accessibilityRole="button"
                accessibilityLabel={p.mic ? `Mute ${name}'s mic` : `${name} is muted`}
                accessibilityState={{ disabled: !p.mic }}
                style={[styles.btn, !p.mic && styles.off]}
              >
                <Text style={styles.btnText}>{p.mic ? "Mute mic" : "Muted"}</Text>
              </Pressable>
              {p.role !== "op" ? (
                <Pressable
                  onPress={() => confirm(`Make ${name} an op?`, "They'll be able to kick, ban and mute anyone. This can't be undone.", "Make op", false, () => run(actions.grantOp(pid)))}
                  accessibilityRole="button"
                  style={styles.btn}
                >
                  <Text style={styles.btnText}>Make op</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.row}>
              <Pressable
                onPress={() => confirm(`Kick ${name}?`, "They'll be removed from the call.", "Kick", true, () => run(actions.kick(pid), true))}
                accessibilityRole="button"
                style={[styles.btn, styles.danger]}
              >
                <Text style={styles.btnText}>Kick</Text>
              </Pressable>
              <Pressable
                onPress={() => confirm(`Ban ${name}?`, "They'll be removed and blocked from rejoining.", "Ban", true, () => run(actions.ban(pid), true))}
                accessibilityRole="button"
                style={[styles.btn, styles.danger]}
              >
                <Text style={styles.btnText}>Ban</Text>
              </Pressable>
            </View>
            {msg ? <Text style={styles.value}>{msg}</Text> : null}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  value: { color: colors.muted },
  actions: { gap: 8, marginTop: 12 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignItems: "center" },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  off: { opacity: 0.5 },
  btnText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
```

Then `git rm mobile/src/ui/components/VolumeSheet.tsx`.

- [ ] **Step 3: Stop share in `ScreenViewer.tsx`**

Change the signature to:

```tsx
export function ScreenViewer({ p, onClose, isOp, onStopShare }: {
  p: Participant | null; onClose(): void; isOp: boolean; onStopShare(id: string): ModResult;
}) {
```

Add imports `import { MOD_RESULT_TEXT, type ModResult } from "../../core/moderation";`, state `const [stopMsg, setStopMsg] = useState("");`, and inside the existing `useEffect` keyed on `id` add `setStopMsg("");`. Right after the top `<View style={[styles.top, …]}>…</View>` block, add:

```tsx
      {isOp ? (
        <View style={[styles.stopWrap, { top: insets.top + 60 }]}>
          <Pressable
            onPress={() => { const r = onStopShare(p.id); setStopMsg(r === "sent" ? "" : MOD_RESULT_TEXT[r] || ""); }}
            style={styles.stop}
            accessibilityRole="button"
            accessibilityLabel={`Stop ${p.name}'s screenshare`}
          >
            <Text style={styles.btnText}>Stop share</Text>
          </Pressable>
          {stopMsg ? <Text style={styles.vol}>{stopMsg}</Text> : null}
        </View>
      ) : null}
```

and styles:

```ts
  stopWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 4 },
  stop: { paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
```

(No confirm — stop share is instant per spec. The viewer already closes when the share ends, via `Call.tsx`'s `viewing` effect.)

- [ ] **Step 4: Lock in `TopBar.tsx`**

```tsx
// "🔒 #room · 12:34" — the lock shows while the room is password-locked; the timer
// counts from when the server created the room.
export function TopBar({ slug, locked }: { slug: string; locked: boolean }) {
  const elapsed = useElapsed();
  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1} accessibilityLabel={`${locked ? "Room locked. " : ""}#${slug}${elapsed ? `, ${elapsed}` : ""}`}>
        {locked ? "🔒 " : ""}#{slug}{elapsed ? ` · ${elapsed}` : ""}
      </Text>
    </View>
  );
}
```

- [ ] **Step 5: Wire `Call.tsx`**

- Imports: replace `VolumeSheet` with `import { PersonSheet } from "../components/PersonSheet";`; add `useModeration` to the `../hooks` import.
- After `const volumes = useVolumes();` add `const mod = useModeration();`.
- Add, beside the existing "Drop a stale viewer id" effect:

```tsx
  // Close the person sheet when that person leaves (or a rejoin changes ids).
  useEffect(() => {
    if (volumeFor && state && !state.participants.some((x) => x.id === volumeFor)) setVolumeFor(null);
  }, [volumeFor, state]);
```

- `<TopBar slug={state.slug} locked={mod.locked} />`
- Replace the `<VolumeSheet … />` element with:

```tsx
        <PersonSheet
          p={volumeFor ? people.find((x) => x.id === volumeFor) ?? null : null}
          volume={volumeFor ? volumes[volumeFor] ?? 1 : 1}
          onChange={(v) => { if (volumeFor) call()?.volumes.set(volumeFor, v); }}
          onClose={() => setVolumeFor(null)}
          isOp={state.role === "op"}
          actions={{
            muteMic: (id) => call()?.moderation.muteMic(id) ?? "offline",
            grantOp: (id) => call()?.moderation.grantOp(id) ?? "offline",
            kick: (id) => call()?.moderation.kick(id) ?? "offline",
            ban: (id) => call()?.moderation.ban(id) ?? "offline",
          }}
        />
```

- `<ScreenViewer p={viewed} onClose={() => setViewing(null)} isOp={state.role === "op"} onStopShare={(id) => call()?.moderation.stopShare(id) ?? "offline"} />`

`isOp` is read from `state.role` on every render, so becoming op while the sheet is open reveals the actions live.

- [ ] **Step 6: Verify**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint`
Expected: all PASS. `grep -rn VolumeSheet src` → no matches.

- [ ] **Step 7: Commit**

```bash
git add -A mobile/src
git commit -m "feat(mobile): op actions in the person sheet, Stop share in the viewer, lock in the top bar"
```

---

### Task 5: ☰ More sheet — Lock room and Quality (ops)

**Files:**
- Modify: `mobile/src/ui/components/MoreSheet.tsx`
- Modify: `mobile/src/ui/screens/Call.tsx` (MoreSheet props)

**Interfaces:**
- Consumes: `useModeration()` (Task 4), `ModResult`, `MOD_RESULT_TEXT`, `QualityTarget` (Task 2), `QUALITY_TIERS` from `../../shared/web`.
- Produces: `MoreSheet` props `locked: boolean; quality: {camera: string; screen: string}; mod: { lock(pw: string): ModResult; unlock(): ModResult; setQuality(t: QualityTarget, tier: string): ModResult }`.

- [ ] **Step 1: Extend `MoreSheet.tsx`**

1. Imports: add `ScrollView` to the `react-native` import; add
   ```ts
   import { MOD_RESULT_TEXT, type ModResult, type QualityTarget } from "../../core/moderation";
   import { QUALITY_TIERS } from "../../shared/web";
   ```
2. Props: add `locked`, `quality`, `mod` (types above) to the destructuring and the type literal.
3. State, after the existing `msg` state:
   ```ts
   const [view, setView] = useState<"main" | "quality">("main");
   const [lockDraft, setLockDraft] = useState<string | null>(null); // null: not editing
   const [modMsg, setModMsg] = useState("");
   useEffect(() => { setView("main"); setLockDraft(null); setModMsg(""); }, [visible]);
   const show = (r: ModResult) => setModMsg(MOD_RESULT_TEXT[r] || "");
   const submitLock = () => {
     const r = mod.lock(lockDraft ?? "");
     if (r === "sent") { setLockDraft(null); setModMsg(""); } else show(r);
   };
   ```
4. Wrap the sheet's content `<View style={styles.body}>…</View>` in `<ScrollView keyboardShouldPersistTaps="handled">…</ScrollView>` (the sheet now has more rows than fit at 0.55).
5. When `view === "quality"`, render this instead of the main body:

```tsx
        <View style={styles.body}>
          <Pressable onPress={() => setView("main")} accessibilityRole="button" accessibilityLabel="Back" style={styles.row2}>
            <Text style={styles.saveText}>‹ Back</Text>
          </Pressable>
          {(["camera", "screen"] as QualityTarget[]).map((target) => (
            <View key={target} style={{ gap: 2 }}>
              <Text style={styles.label}>{target === "camera" ? "Camera" : "Screen"}</Text>
              {QUALITY_TIERS.map((t: { id: string; label: string }) => {
                const on = quality[target] === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => show(mod.setQuality(target, t.id))}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={styles.tier}
                  >
                    <Text style={styles.tierText}>{on ? "✓ " : "   "}{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {modMsg ? <Text style={styles.msg}>{modMsg}</Text> : null}
        </View>
```

6. In the main body, replace the existing `{isOp ? (<Pressable … New poll…</Pressable>) : null}` with:

```tsx
        {isOp ? (
          <>
            <Pressable onPress={onNewPoll} accessibilityRole="button" style={styles.row2}>
              <Text style={styles.saveText}>New poll…</Text>
            </Pressable>
            {locked ? (
              <Pressable onPress={() => show(mod.unlock())} accessibilityRole="button" style={styles.row2}>
                <Text style={styles.saveText}>Unlock room</Text>
              </Pressable>
            ) : lockDraft === null ? (
              <Pressable onPress={() => { setLockDraft(""); setModMsg(""); }} accessibilityRole="button" style={styles.row2}>
                <Text style={styles.saveText}>Lock room…</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  value={lockDraft}
                  onChangeText={setLockDraft}
                  placeholder="Room password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={submitLock}
                  accessibilityLabel="Room password"
                />
                <Pressable
                  onPress={submitLock}
                  disabled={lockDraft.trim() === ""}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: lockDraft.trim() === "" }}
                  style={[styles.save, lockDraft.trim() === "" && styles.saveOff]}
                >
                  <Text style={styles.saveText}>Lock</Text>
                </Pressable>
                <Pressable onPress={() => setLockDraft(null)} accessibilityRole="button" style={styles.save}>
                  <Text style={styles.saveText}>Cancel</Text>
                </Pressable>
              </View>
            )}
            <Pressable onPress={() => { setView("quality"); setModMsg(""); }} accessibilityRole="button" style={styles.row2}>
              <Text style={styles.saveText}>Quality…</Text>
            </Pressable>
            {modMsg ? <Text style={styles.msg}>{modMsg}</Text> : null}
          </>
        ) : null}
```

When a `room-locked` broadcast arrives while the draft is open, `locked` flips to true and the row shows **Unlock room**; also clear the draft then:

```ts
useEffect(() => { if (locked) setLockDraft(null); }, [locked]);
```

7. Styles: add
```ts
  tier: { paddingVertical: 10 },
  tierText: { color: colors.text, fontSize: 16 },
```

- [ ] **Step 2: Wire in `Call.tsx`** — add to the `<MoreSheet … />` props:

```tsx
          locked={mod.locked}
          quality={mod.quality}
          mod={{
            lock: (pw) => call()?.moderation.lock(pw) ?? "offline",
            unlock: () => call()?.moderation.unlock() ?? "offline",
            setQuality: (t, tier) => call()?.moderation.setQuality(t, tier) ?? "offline",
          }}
```

- [ ] **Step 3: Verify**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/ui/components/MoreSheet.tsx mobile/src/ui/screens/Call.tsx
git commit -m "feat(mobile): Lock room and Quality in the ☰ sheet for ops"
```

---

### Task 6: 1.3.0 version bump and the manual checklist

**Files:**
- Modify: `mobile/android/app/build.gradle:85-86`
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (both `CURRENT_PROJECT_VERSION` and both `MARKETING_VERSION`, lines ~284/293/315/323)
- Modify: `mobile/MANUAL-TEST.md` (append a section after item 37)

- [ ] **Step 1: Bump versions**

```bash
cd mobile
sed -i 's/versionCode 5/versionCode 6/; s/versionName "1.2.0"/versionName "1.3.0"/' android/app/build.gradle
sed -i 's/CURRENT_PROJECT_VERSION = 5;/CURRENT_PROJECT_VERSION = 6;/g; s/MARKETING_VERSION = 1.2.0;/MARKETING_VERSION = 1.3.0;/g' ios/Coyote.xcodeproj/project.pbxproj
grep -n "versionCode\|versionName" android/app/build.gradle
grep -n "CURRENT_PROJECT_VERSION\|MARKETING_VERSION" ios/Coyote.xcodeproj/project.pbxproj
```
Expected: `versionCode 6`, `versionName "1.3.0"`, two `= 6;` and two `= 1.3.0;`.

- [ ] **Step 2: Append to `mobile/MANUAL-TEST.md`**

```markdown
## Op moderation (1.3.0)

Server prerequisite: a deploy whose `joined` frame carries `locked` (members survive a
lock on reconnect). Run with the phone as op and a browser as the target, then swap.

38. **Mute and make op.** Long-press the browser's tile: the sheet shows the volume
    slider and Mute mic / Make op / Kick / Ban. Mute mic: the browser's mic turns off
    and the button reads "Muted"; the browser can unmute. Make op: a confirm appears;
    after it, the tile shows "@" and Make op disappears.
39. **Kick and ban.** Kick (confirm "Kick <name>?"): the browser is removed, the sheet
    closes, chat shows the moderation line. Rejoin from the browser, then Ban: the
    browser can't rejoin ("You are banned from this room.").
40. **Stop share.** The browser shares its screen; open it on the phone: Stop share
    ends it and the viewer closes. A non-op phone shows no Stop share button.
41. **Lock.** ☰ → Lock room…, enter a password, Lock: 🔒 appears in the phone's top
    bar and the browser shows "Room locked". A third client is refused without the
    password and admitted with it. Airplane mode on the phone for 10 s: it rejoins the
    locked room without asking for the password. ☰ → Unlock room: 🔒 goes away.
42. **Late joiner sees the lock.** Lock the room from the browser, then join from the
    phone (with the password): 🔒 shows immediately.
43. **Quality.** ☰ → Quality… → Camera → Low: the browser's camera visibly drops to
    360p·15 and the check moves; back to Auto. Repeat for Screen with a share running.
44. **Non-op.** As a non-op, long-press a tile: only the volume slider; ☰ has no Lock
    room or Quality. Get made op by the browser while the sheet is open: the actions
    appear.
45. **Being moderated.** Re-run Foundation's kick/ban item and 2b's force-mute with a
    browser op against the phone.
```

- [ ] **Step 3: Verify the full suite**

Run: `go test ./...` (repo root), then in `mobile/`: `npx jest && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/android/app/build.gradle mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/MANUAL-TEST.md
git commit -m "chore(mobile): 1.3.0 (build 6) with the op moderation manual checklist"
```
