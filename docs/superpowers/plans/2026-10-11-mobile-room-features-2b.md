# Mobile Room Features — Release 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship app 1.2.0 with polls (everyone votes; ops create and close), the soundboard, per-participant volume, Data saver and Hide self-view settings, and a × to remove rooms from the Home screen's Recent list.

**Architecture:** Three new feature stores beside `Call` (`Polls`, `Soundboard`, `Volumes`) in the 2a pattern — plain classes with `subscribe()`/`getSnapshot()`, fed by `Call` from signaling frames and reset on every `joined`, read by the UI through `useSyncExternalStore` hooks. The soundboard's clip list comes from a new read-only `GET /api/soundboard`; clips are downloaded and cached by the in-house `CoyoteSounds` native module, which gains HTTPS loading. Data saver lives in `Call` (re-sent after every rejoin); Hide self-view and the Recent list are UI-local preferences.

**Tech Stack:** React Native 0.87, TypeScript, Jest; Swift + Kotlin (`CoyoteSounds`); Go (server endpoint). Shared DOM-free web modules from `internal/web/assets/lib/`.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-room-features-design.md` (2b scope), plus one user-requested addition recorded in Task 14: a × on each Recent room on Home.

## Global Constraints

- Wire protocol unchanged. One server addition: `GET /api/soundboard` returning `[{id, label, src}]` — the same list the web page gets — `Content-Type: application/json`, short `Cache-Control`.
- No new third-party dependencies (JS or native).
- `CoyoteSounds` must never set the audio category/mode or activate the audio session (2a rule, still tested).
- Polls: only ops (`role === "op"`) create/close; anyone votes; single choice, changeable; one poll per room, a new one replaces the old. Question ≤ 200 characters; 2–6 options, each ≤ 80 characters, trimmed and non-empty. The server refuses invalid input silently, so the app validates first.
- Poll unread: a poll **open** or **close** bumps the chat badge; **update** does not.
- Your own vote is remembered locally (the server never echoes it) and restored from `joined.poll.yourVote` after a rejoin.
- Soundboard: one clip at a time per room; only the starter can stop it; when the starter's clip ends naturally the starter sends `stop`; everyone (including the starter) plays on the server's `start` broadcast. If `/api/soundboard` is unavailable the 🔊 button is hidden; a clip that fails to load is disabled.
- `sound` events' `by` is a **display name**, not an id: "mine" is decided by matching the id this client asked to start.
- Per-participant volume: 0–200% in 5% steps (`0`–`2`, step `0.05`), applied with `setStreamVolume` to that person's mic stream; per call, not saved; re-applied when their audio stream changes (e.g. after a rejoin).
- Data saver: sends `set-receive-video {enabled: false}` (and `true` when turned off); saved in preferences; re-sent after every `joined`; while on, tiles show avatars; screenshare audio keeps playing.
- Hide self-view: saved; hides the self-view tile; the camera keeps sending.
- Recent list: × removes that room (by host + slug) from history immediately; no confirmation.
- Preferences are merged on save (a save of some fields never drops the others).
- Verification (from `mobile/`): `npx jest`, `npm run -s typecheck`, `npx eslint src test`. Server: `go vet ./... && go test ./...`.
- Commits: Conventional Commits; no Co-Authored-By trailer. Version for this release: 1.2.0, iOS build 5, Android versionCode 5.

## Review Focus

1. **Rejoin mid-poll / mid-clip:** after a reconnect the poll card shows the right tallies and *your* highlighted vote (from `joined.poll.yourVote`), and a clip that was playing doesn't leave the board locked forever (the server doesn't tell late joiners about a playing clip). (Tests in Tasks 5, 6, 8.)
2. **Voting while disconnected / non-op poll actions:** a vote or create/close while reconnecting, or create/close by a non-op, must not silently vanish or change local state — it returns a result the UI shows. (Tests in Task 5.)
3. **A poll replaced while its card is on screen:** an old card in the chat log must not show the new poll's tallies under the old question. (Test in Task 5; UI in Task 10.)
4. **Starter leaves or reconnects while their clip plays:** the server broadcasts `stop`; the board must unlock; our own `ended` for a clip we didn't start must not send `stop`. (Tests in Task 6.)
5. **Saving one preference clobbering others:** the lobby saving name/mic/camera must not reset Data saver or Hide self-view, and vice versa. (Test in Task 4.)

---

## File structure

**Create**
- `internal/server/soundboard_api_test.go` — endpoint test (handler goes in `soundboard.go`).
- `mobile/src/core/prefs.ts` — `Prefs`, `DEFAULT_PREFS`, `mergePrefs()` (pure).
- `mobile/src/core/polls.ts` — `Polls` store + validation.
- `mobile/src/core/soundboard.ts` — `Soundboard` store, `BoardSound`, `ClipPort`.
- `mobile/src/core/volumes.ts` — `Volumes` store.
- `mobile/src/ui/components/PollCard.tsx`, `PollForm.tsx`, `SoundboardPanel.tsx`, `VolumeSheet.tsx`, `Toggle.tsx`.
- Tests: `mobile/test/prefs.test.ts`, `polls.test.ts`, `soundboard.test.ts`, `volumes.test.ts`.

**Modify**
- `internal/server/server.go`, `internal/server/soundboard.go`.
- `mobile/src/shared/web.ts`, `mobile/test/shared.test.ts`.
- `mobile/src/core/recent.ts`, `mobile/test/recent.test.ts`, `mobile/src/native/storage.ts`, `mobile/src/ui/screens/Home.tsx`.
- `mobile/src/core/chat.ts`, `mobile/test/chat.test.ts` (poll entries + unread).
- `mobile/src/core/api.ts`, `mobile/test/api.test.ts` (`fetchSoundboard`).
- `mobile/src/core/call.ts`, `mobile/test/call.test.ts`, `mobile/src/native/callFactory.ts`.
- `mobile/src/native/sounds.ts`, `CoyoteSoundsModule.kt`, `CoyoteSounds.swift`, `CoyoteSounds.m`, `mobile/test/nativeModules.test.ts`.
- `mobile/src/ui/hooks.ts`, `CallContext.tsx`, `screens/Call.tsx`, `screens/PreJoin.tsx`, `components/ChatSheet.tsx`, `MoreSheet.tsx`, `Tile.tsx`, `SelfView.tsx`.
- `mobile/MANUAL-TEST.md`, `android/app/build.gradle`, `ios/Coyote.xcodeproj/project.pbxproj`, the spec.

---

### Task 1: `GET /api/soundboard`

**Files:**
- Modify: `internal/server/soundboard.go`, `internal/server/server.go`
- Test: `internal/server/soundboard_api_test.go`

**Interfaces:**
- Produces: `GET /api/soundboard` → `200`, `Content-Type: application/json`, `Cache-Control: public, max-age=300`, body = `soundboardJSON(embeddedSoundboard)` (a JSON array of `{id, label, src}`; `src` is a server-relative path like `/v/<version>/sounds/board/1f680.mp3`).

- [ ] **Step 1: Write the failing test** — create `internal/server/soundboard_api_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The apps can't read the board out of the web page, so it is served as JSON — the
// exact list the page is built with.
func TestSoundboardAPIServesTheEmbeddedBoard(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/api/soundboard")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=300" {
		t.Fatalf("cache-control %q", cc)
	}
	var got []sound
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(embeddedSoundboard) {
		t.Fatalf("got %d sounds, want %d", len(got), len(embeddedSoundboard))
	}
	for i, s := range got {
		if s != embeddedSoundboard[i] {
			t.Fatalf("sound %d = %+v, want %+v", i, s, embeddedSoundboard[i])
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/server -run TestSoundboardAPIServesTheEmbeddedBoard -count=1`
Expected: FAIL — the catch-all serves the app shell (status 200 but `content-type` is `text/html…`, or JSON decode fails).

- [ ] **Step 3: Implement** — append to `internal/server/soundboard.go`:

```go
// handleSoundboard serves the board as JSON for the mobile apps, which can't read
// it out of the page shell. Same list, same order, as the page's injection.
func (h *Hub) handleSoundboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(soundboardJSON(embeddedSoundboard))
}
```

Add `"net/http"` to that file's imports. In `internal/server/server.go`, after the `GET /api/version` route, add:

```go
	mux.HandleFunc("GET /api/soundboard", h.handleSoundboard)
```

- [ ] **Step 4: Run tests and vet**

Run: `go vet ./... && go test ./internal/server -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/soundboard.go internal/server/server.go internal/server/soundboard_api_test.go
git commit -m "feat(server): serve the soundboard list as JSON for the apps"
```

---

### Task 2: Shared poll and soundboard maths

**Files:**
- Modify: `mobile/src/shared/web.ts`
- Test: `mobile/test/shared.test.ts`

**Interfaces:**
- Produces (re-exported from `src/shared/web.ts`): `totalVotes(tallies): number`, `tallyPercents(tallies): number[]` (largest remainder, sums to 100 when any vote exists), `normalizeBoard(list): Array<{id, label, src}>`, `boardButtonState(id, label, playing, mine): {active: boolean, disabled: boolean, title: string}`.

- [ ] **Step 1: Write the failing test** — append to `mobile/test/shared.test.ts`:

```ts
import { boardButtonState, normalizeBoard, tallyPercents, totalVotes } from "../src/shared/web";

test("poll and soundboard modules load", () => {
  expect(totalVotes([1, "x", 2])).toBe(3);
  expect(tallyPercents([1, 1, 1])).toEqual([34, 33, 33]);
  expect(tallyPercents([0, 0])).toEqual([0, 0]);
  expect(normalizeBoard([{ id: "a", label: "🚀", src: "/s.mp3" }, { id: "", label: "x", src: "y" }, null]))
    .toEqual([{ id: "a", label: "🚀", src: "/s.mp3" }]);
  expect(boardButtonState("a", "🚀", "", false)).toEqual({ active: false, disabled: false, title: "Play 🚀 for everyone" });
  expect(boardButtonState("a", "🚀", "a", true)).toMatchObject({ active: true, disabled: false });
  expect(boardButtonState("b", "🧪", "a", false)).toMatchObject({ active: false, disabled: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/shared.test.ts` — Expected: FAIL (not exported).

- [ ] **Step 3: Add the exports** to `mobile/src/shared/web.ts`:

```ts
export { totalVotes, tallyPercents } from "../../../internal/web/assets/lib/poll.js";
export { normalizeBoard, boardButtonState } from "../../../internal/web/assets/lib/soundboard.js";
```

(`soundboardFromPage` is deliberately not exported: it reads `window`.)

- [ ] **Step 4: Run tests and type check**

Run: `cd mobile && npx jest test/shared.test.ts && npm run -s typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/shared/web.ts mobile/test/shared.test.ts
git commit -m "feat(mobile): share poll tallies and soundboard button state from the web client"
```

---

### Task 3: Remove a room from Recent (×)

**Files:**
- Modify: `mobile/src/core/recent.ts`, `mobile/test/recent.test.ts`, `mobile/src/native/storage.ts`, `mobile/src/ui/screens/Home.tsx`

**Interfaces:**
- Produces: `removeRecent(list: RecentRoom[], room: Pick<RecentRoom, "host" | "slug">): RecentRoom[]` (pure); `forgetRoom(room: Pick<RecentRoom, "host" | "slug">): Promise<RecentRoom[]>` in `storage.ts` (returns the new list).

- [ ] **Step 1: Write the failing test** — append to `mobile/test/recent.test.ts`:

```ts
import { removeRecent } from "../src/core/recent";

test("removeRecent drops only the matching host+slug and keeps order", () => {
  let list = mergeRecent([], L("a"), 1);
  list = mergeRecent(list, L("b"), 2);
  list = mergeRecent(list, L("http://localhost:8080/a"), 3);
  const out = removeRecent(list, { host: "vc.swiftirc.net", slug: "a" });
  expect(out.map((r) => `${r.host}/${r.slug}`)).toEqual(["localhost:8080/a", "vc.swiftirc.net/b"]);
  expect(removeRecent(out, { host: "nowhere", slug: "zzz" })).toEqual(out);
  expect(list).toHaveLength(3); // input not mutated
});
```

(The `import` goes at the top of the file with the existing imports.)

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/recent.test.ts` — Expected: FAIL (`removeRecent` not exported).

- [ ] **Step 3: Implement** — in `mobile/src/core/recent.ts` add:

```ts
// Removes one room from history (the Home screen's ×). Matches by host + slug,
// like mergeRecent's de-duplication.
export function removeRecent(list: RecentRoom[], room: Pick<RecentRoom, "host" | "slug">): RecentRoom[] {
  return list.filter((r) => !(r.host === room.host && r.slug === room.slug));
}
```

In `mobile/src/native/storage.ts` change the import to `import { mergeRecent, removeRecent, type RecentRoom } from "../core/recent";` and add:

```ts
export async function forgetRoom(room: Pick<RecentRoom, "host" | "slug">): Promise<RecentRoom[]> {
  const next = removeRecent(await loadRecent(), room);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 4: Home screen ×** — in `mobile/src/ui/screens/Home.tsx`:
  - Import `View` from `react-native` and `forgetRoom` from `../../native/storage`.
  - Replace the `renderItem` with a row that keeps the existing Pressable (now `flex: 1`) and adds a × button:

```tsx
        renderItem={({ item }) => (
          <View style={styles.recentRow}>
            <Pressable style={styles.recent} onPress={() => go(recentInput(item))} accessibilityRole="button" accessibilityLabel={`Join #${item.slug}`}>
              <Text style={styles.recentText}>#{item.slug}</Text>
              {item.host !== DEFAULT_HOST ? <Text style={styles.muted}>{item.host}</Text> : null}
            </Pressable>
            <Pressable
              onPress={() => { forgetRoom(item).then(setRecent).catch((e) => console.warn("forget room failed", e)); }}
              style={styles.forget}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove #${item.slug} from recent rooms`}
            >
              <Text style={styles.forgetText}>×</Text>
            </Pressable>
          </View>
        )}
```

  - Styles: change `recent` to `{ flex: 1, paddingVertical: 12 }` and add:

```ts
  recentRow: { flexDirection: "row", alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  forget: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  forgetText: { color: colors.muted, fontSize: 22 },
```

- [ ] **Step 5: Run tests, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/recent.ts mobile/test/recent.test.ts mobile/src/native/storage.ts mobile/src/ui/screens/Home.tsx
git commit -m "feat(mobile): remove a room from the Recent list with ×"
```

---

### Task 4: Preferences that merge, with Data saver and Hide self-view

**Files:**
- Create: `mobile/src/core/prefs.ts`, `mobile/test/prefs.test.ts`
- Modify: `mobile/src/native/storage.ts`, `mobile/src/ui/screens/PreJoin.tsx`, `mobile/src/ui/CallContext.tsx`

**Interfaces:**
- Produces: `interface Prefs { name: string; email: string; mic: boolean; camera: boolean; dataSaver: boolean; hideSelf: boolean }`, `DEFAULT_PREFS`, `mergePrefs(stored: unknown, patch: Partial<Prefs>): Prefs` (drops unknown keys and wrong types). `storage.ts`: `loadPrefs(): Promise<Prefs>`, `savePrefs(patch: Partial<Prefs>): Promise<Prefs>` — **now merges** into what's stored.

- [ ] **Step 1: Write the failing test** — create `mobile/test/prefs.test.ts`:

```ts
import { DEFAULT_PREFS, mergePrefs } from "../src/core/prefs";

test("defaults when nothing is stored", () => {
  expect(mergePrefs(null, {})).toEqual(DEFAULT_PREFS);
  expect(DEFAULT_PREFS).toMatchObject({ dataSaver: false, hideSelf: false, mic: true, camera: true });
});

test("a patch keeps every field it doesn't mention", () => {
  const stored = { ...DEFAULT_PREFS, name: "Ryan", dataSaver: true, hideSelf: true };
  const out = mergePrefs(stored, { name: "R", mic: false, camera: false, email: "e" });
  expect(out).toEqual({ name: "R", email: "e", mic: false, camera: false, dataSaver: true, hideSelf: true });
  expect(mergePrefs(out, { dataSaver: false })).toMatchObject({ name: "R", dataSaver: false, hideSelf: true });
});

test("garbage in storage falls back field by field", () => {
  const out = mergePrefs({ name: 5, dataSaver: "yes", hideSelf: true, extra: 1 }, {});
  expect(out).toEqual({ ...DEFAULT_PREFS, hideSelf: true });
  expect(out).not.toHaveProperty("extra");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/prefs.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `mobile/src/core/prefs.ts`:

```ts
// Saved preferences. Saves merge into what's stored so one screen saving its fields
// (the lobby: name, mic, camera) never resets another's (Data saver, Hide self-view).
export interface Prefs {
  name: string;
  email: string; // stays on the device; only its hash is sent
  mic: boolean;
  camera: boolean;
  dataSaver: boolean;
  hideSelf: boolean;
}

export const DEFAULT_PREFS: Prefs = { name: "", email: "", mic: true, camera: true, dataSaver: false, hideSelf: false };

export function mergePrefs(stored: unknown, patch: Partial<Prefs>): Prefs {
  const src = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as Array<keyof Prefs>) {
    const v = src[k];
    if (typeof v === typeof DEFAULT_PREFS[k]) (out as Record<string, unknown>)[k] = v;
  }
  return { ...out, ...patch };
}
```

Replace the prefs half of `mobile/src/native/storage.ts` (the `Prefs` interface, `DEFAULT_PREFS`, `readJSON`, `loadPrefs`, `savePrefs`) with:

```ts
import { mergePrefs, type Prefs } from "../core/prefs";
export type { Prefs } from "../core/prefs";

const PREFS_KEY = "coyote.prefs.v1";

async function readPrefs(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadPrefs(): Promise<Prefs> {
  return mergePrefs(await readPrefs(), {});
}

// Merges `patch` into the stored preferences and returns the result.
export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = mergePrefs(await readPrefs(), patch);
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}
```

Keep `RECENT_KEY`, `loadRecent`, `rememberRoom` and `forgetRoom` as they are.

- [ ] **Step 4: Update callers**
  - `PreJoin.tsx`: its `savePrefs({ name: …, email, mic, camera })` call keeps compiling and now merges — no change needed beyond confirming it type-checks.
  - `CallContext.tsx` `selfRenamed`: replace `loadPrefs().then((p) => savePrefs({ ...p, name }))` with `savePrefs({ name })` and drop the now-unused `loadPrefs` import if nothing else uses it.

- [ ] **Step 5: Run tests, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/prefs.ts mobile/test/prefs.test.ts mobile/src/native/storage.ts mobile/src/ui/CallContext.tsx mobile/src/ui/screens/PreJoin.tsx
git commit -m "feat(mobile): preferences merge on save; add Data saver and Hide self-view"
```

---

### Task 5: Polls store, and poll cards in the chat log

**Files:**
- Create: `mobile/src/core/polls.ts`, `mobile/test/polls.test.ts`
- Modify: `mobile/src/core/chat.ts`, `mobile/test/chat.test.ts`, `mobile/src/ui/components/ChatSheet.tsx` (one line)

**Interfaces:**
- Consumes: `Sender` from `chat.ts`; `Frame` from `types.ts`.
- Produces (`polls.ts`):
  - `interface PollView { id: string; question: string; options: string[]; tallies: number[]; by: string; open: boolean; yourVote: number | null }`
  - `type PollResult = "sent" | "offline" | "not-op" | "invalid" | "closed"`
  - Limits: `QUESTION_MAX = 200`, `OPTION_MAX = 80`, `OPTIONS_MIN = 2`, `OPTIONS_MAX = 6`.
  - `validatePoll(question: string, options: string[]): { question: string; options: string[] } | null` (trims; drops empty options; null if invalid).
  - `class Polls { constructor(send: Sender, isOp: () => boolean); seed(snap: Frame | undefined | null): void; onPoll(m: Frame): void; vote(choice: number): PollResult; create(question: string, options: string[]): PollResult; close(): PollResult; subscribe(fn): () => void; getSnapshot(): PollView | null }`
- Produces (`chat.ts` additions): `ChatEntry` gains `| { key: number; kind: "poll"; pollId: string; ts: number }`; `ChatLog.onPollEvent(action: string, pollId: string): void` — `open` appends a poll entry and counts unread (if closed); `close` counts unread only; `update` does nothing.

- [ ] **Step 1: Write the failing tests** — create `mobile/test/polls.test.ts`:

```ts
import { Polls, validatePoll } from "../src/core/polls";

function make(op = false, connected = true) {
  const sent: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const polls = new Polls((type, fields) => {
    if (!connected) return false;
    sent.push({ type, fields });
    return true;
  }, () => op);
  return { polls, sent };
}
const ev = (over = {}) => ({ type: "poll", action: "open", id: "p1", question: "Lunch?", options: ["Pizza", "Tacos"], tallies: [0, 0], by: "Op", open: true, ...over });

test("open, update and close; snapshot identity changes only on change", () => {
  const { polls } = make();
  expect(polls.getSnapshot()).toBeNull();
  polls.onPoll(ev());
  const s1 = polls.getSnapshot();
  expect(s1).toMatchObject({ id: "p1", question: "Lunch?", tallies: [0, 0], open: true, yourVote: null });
  expect(polls.getSnapshot()).toBe(s1);
  polls.onPoll(ev({ action: "update", tallies: [2, 1] }));
  expect(polls.getSnapshot()!.tallies).toEqual([2, 1]);
  polls.onPoll(ev({ action: "close", tallies: [2, 1], open: false }));
  expect(polls.getSnapshot()).toMatchObject({ open: false, tallies: [2, 1] });
});

test("voting sends and remembers locally; changing a vote works; a new poll forgets it", () => {
  const { polls, sent } = make();
  polls.onPoll(ev());
  expect(polls.vote(1)).toBe("sent");
  expect(sent).toEqual([{ type: "vote", fields: { pollId: "p1", choice: 1 } }]);
  expect(polls.getSnapshot()!.yourVote).toBe(1);
  polls.onPoll(ev({ action: "update", tallies: [0, 1] }));
  expect(polls.getSnapshot()!.yourVote).toBe(1); // updates never clear it
  expect(polls.vote(0)).toBe("sent");
  expect(polls.getSnapshot()!.yourVote).toBe(0);
  polls.onPoll(ev({ id: "p2" }));
  expect(polls.getSnapshot()).toMatchObject({ id: "p2", yourVote: null });
});

test("vote refuses closed, out-of-range and offline without changing state", () => {
  const off = make(false, false);
  off.polls.onPoll(ev());
  expect(off.polls.vote(0)).toBe("offline");
  expect(off.polls.getSnapshot()!.yourVote).toBeNull();
  const { polls, sent } = make();
  expect(polls.vote(0)).toBe("closed"); // no poll
  polls.onPoll(ev());
  expect(polls.vote(5)).toBe("invalid");
  polls.onPoll(ev({ action: "close", open: false }));
  expect(polls.vote(0)).toBe("closed");
  expect(sent).toEqual([]);
});

test("seed from joined.poll restores tallies and your vote; absent clears", () => {
  const { polls } = make();
  polls.seed({ type: "", id: "p9", question: "Q", options: ["a", "b"], tallies: [3, 4], by: "Op", open: true, yourVote: 1 } as never);
  expect(polls.getSnapshot()).toMatchObject({ id: "p9", tallies: [3, 4], yourVote: 1 });
  polls.seed(undefined);
  expect(polls.getSnapshot()).toBeNull();
});

test("create and close are op-only and validated", () => {
  const user = make(false);
  expect(user.polls.create("Q?", ["a", "b"])).toBe("not-op");
  const { polls, sent } = make(true);
  expect(polls.create("  ", ["a", "b"])).toBe("invalid");
  expect(polls.create("Q?", ["only one", "  "])).toBe("invalid");
  expect(polls.create("Q?", [" a ", "b", ""])).toBe("sent");
  expect(sent[0]).toEqual({ type: "create-poll", fields: { question: "Q?", options: ["a", "b"] } });
  expect(polls.close()).toBe("closed"); // nothing open yet
  polls.onPoll(ev());
  expect(polls.close()).toBe("sent");
  expect(sent[1]).toEqual({ type: "close-poll", fields: { pollId: "p1" } });
  expect(user.polls.close()).toBe("not-op");
});

test("validatePoll enforces the server's limits", () => {
  expect(validatePoll("x".repeat(201), ["a", "b"])).toBeNull();
  expect(validatePoll("Q", ["a", "x".repeat(81)])).toBeNull();
  expect(validatePoll("Q", ["1", "2", "3", "4", "5", "6", "7"])).toBeNull();
  expect(validatePoll(" Q ", [" a ", " b "])).toEqual({ question: "Q", options: ["a", "b"] });
});
```

Append to `mobile/test/chat.test.ts`:

```ts
test("poll open adds a card and counts unread; close counts unread; update doesn't", () => {
  const { log } = make();
  log.onPollEvent("open", "p1");
  expect(log.getSnapshot().entries.at(-1)).toMatchObject({ kind: "poll", pollId: "p1" });
  expect(log.getSnapshot().unread).toBe(1);
  log.onPollEvent("update", "p1");
  expect(log.getSnapshot().unread).toBe(1);
  expect(log.getSnapshot().entries).toHaveLength(1);
  log.onPollEvent("close", "p1");
  expect(log.getSnapshot().unread).toBe(2);
  expect(log.getSnapshot().entries).toHaveLength(1);
  log.setOpen(true);
  log.onPollEvent("open", "p2");
  expect(log.getSnapshot().unread).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/polls.test.ts test/chat.test.ts` — Expected: FAIL (module / method missing).

- [ ] **Step 3: Implement `polls.ts`** — create `mobile/src/core/polls.ts`:

```ts
// The room's one poll (a new one replaces the old). The server never echoes your own
// vote, so it is remembered here, and restored from joined.poll.yourVote on rejoin.
// Snapshots are replaced on change for useSyncExternalStore.
import type { Sender } from "./chat";
import type { Frame } from "./types";

export interface PollView {
  id: string;
  question: string;
  options: string[];
  tallies: number[];
  by: string;
  open: boolean;
  yourVote: number | null;
}
export type PollResult = "sent" | "offline" | "not-op" | "invalid" | "closed";

export const QUESTION_MAX = 200;
export const OPTION_MAX = 80;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;

const runes = (s: string) => [...s].length;

export function validatePoll(question: string, options: string[]): { question: string; options: string[] } | null {
  const q = question.trim();
  const opts = options.map((o) => o.trim()).filter((o) => o !== "");
  if (!q || runes(q) > QUESTION_MAX) return null;
  if (opts.length < OPTIONS_MIN || opts.length > OPTIONS_MAX) return null;
  if (opts.some((o) => runes(o) > OPTION_MAX)) return null;
  return { question: q, options: opts };
}

function fromFrame(m: Frame, yourVote: number | null): PollView {
  return {
    id: String(m.id ?? ""),
    question: String(m.question ?? ""),
    options: Array.isArray(m.options) ? m.options.map(String) : [],
    tallies: Array.isArray(m.tallies) ? m.tallies.map((t: unknown) => Number(t) || 0) : [],
    by: String(m.by ?? ""),
    open: !!m.open,
    yourVote,
  };
}

export class Polls {
  private snap: PollView | null = null;
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private isOp: () => boolean) {}

  seed(snap: Frame | undefined | null): void {
    if (!snap || !snap.id) {
      this.set(null);
      return;
    }
    const yv = typeof snap.yourVote === "number" ? snap.yourVote : null;
    this.set(fromFrame(snap, yv));
  }

  onPoll(m: Frame): void {
    const same = this.snap && this.snap.id === m.id;
    this.set(fromFrame(m, same ? this.snap!.yourVote : null));
  }

  vote(choice: number): PollResult {
    const p = this.snap;
    if (!p || !p.open) return "closed";
    if (!Number.isInteger(choice) || choice < 0 || choice >= p.options.length) return "invalid";
    if (!this.sender("vote", { pollId: p.id, choice })) return "offline";
    this.set({ ...p, yourVote: choice });
    return "sent";
  }

  create(question: string, options: string[]): PollResult {
    if (!this.isOp()) return "not-op";
    const v = validatePoll(question, options);
    if (!v) return "invalid";
    return this.sender("create-poll", { question: v.question, options: v.options }) ? "sent" : "offline";
  }

  close(): PollResult {
    if (!this.isOp()) return "not-op";
    const p = this.snap;
    if (!p || !p.open) return "closed";
    return this.sender("close-poll", { pollId: p.id }) ? "sent" : "offline";
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): PollView | null => this.snap;

  private set(next: PollView | null) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Extend `chat.ts`** — in `mobile/src/core/chat.ts`:

```ts
export type ChatEntry =
  | { key: number; kind: "message"; from: string; text: string; ts: number }
  | { key: number; kind: "system"; text: string; ts: number }
  | { key: number; kind: "poll"; pollId: string; ts: number };
```

and add the method (next to `notice`):

```ts
  // A poll opening adds its card to the log; opening and closing both count as
  // unread (updates — every vote — don't).
  onPollEvent(action: string, pollId: string): void {
    const closed = !this.snap.open;
    if (action === "open") {
      this.push({ key: ++this.seq, kind: "poll", pollId, ts: Math.floor(this.nowMs() / 1000) }, closed);
    } else if (action === "close" && closed) {
      this.set({ ...this.snap, unread: this.snap.unread + 1 });
    }
  }
```

- [ ] **Step 5: Run tests, type check, lint**

In `mobile/src/ui/components/ChatSheet.tsx`, `Line` handles `system` and then treats every other entry as a message, which no longer type-checks with the new union. Add, right after its `if (e.kind === "system") …` line: `if (e.kind === "poll") return null; // rendered by Task 10`.

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/polls.ts mobile/test/polls.test.ts mobile/src/core/chat.ts mobile/test/chat.test.ts mobile/src/ui/components/ChatSheet.tsx
git commit -m "feat(mobile): polls store with local vote memory; poll cards and unread in chat"
```

---

### Task 6: Soundboard store

**Files:**
- Create: `mobile/src/core/soundboard.ts`, `mobile/test/soundboard.test.ts`

**Interfaces:**
- Consumes: `Sender` (chat.ts), `normalizeBoard` (shared), `Frame`.
- Produces:
  - `interface BoardSound { id: string; label: string; src: string }`
  - `interface ClipPort { load(clipId: string, url: string): void; play(clipId: string): void; stop(clipId: string): void }` (clip ids are `clip:<id>`)
  - `type ClipState = "loading" | "ready" | "failed"`
  - `interface BoardSnapshot { sounds: BoardSound[] | null; playing: { id: string; mine: boolean } | null; clips: Record<string, ClipState> }` — `sounds === null` = unavailable (hide 🔊).
  - `class Soundboard { constructor(send: Sender, clips: ClipPort); setBoard(list: unknown, origin: string): void; unavailable(): void; onSound(m: Frame): void; onLoaded(clipId: string, ok: boolean): void; onEnded(clipId: string): void; start(id: string): "sent" | "offline" | "busy" | "unavailable"; stop(): "sent" | "offline" | "not-mine"; reset(): void; subscribe; getSnapshot }`
  - `clipId(id: string): string` → `"clip:" + id`.

- [ ] **Step 1: Write the failing tests** — create `mobile/test/soundboard.test.ts`:

```ts
import { clipId, Soundboard } from "../src/core/soundboard";

function make(connected = true) {
  const sent: any[] = [];
  const clips = { loads: [] as string[][], plays: [] as string[], stops: [] as string[] };
  const board = new Soundboard((type, fields) => {
    if (!connected) return false;
    sent.push({ type, ...fields });
    return true;
  }, {
    load: (id, url) => clips.loads.push([id, url]),
    play: (id) => clips.plays.push(id),
    stop: (id) => clips.stops.push(id),
  });
  return { board, sent, clips };
}
const LIST = [{ id: "1f680", label: "🚀", src: "/v/abc/sounds/board/1f680.mp3" }, { id: "1f9ea", label: "🧪", src: "/v/abc/sounds/board/1f9ea.mp3" }];

test("setBoard normalises, loads every clip by absolute URL, and tracks load state", () => {
  const { board, clips } = make();
  expect(board.getSnapshot().sounds).toBeNull();
  board.setBoard([...LIST, { id: "" }], "https://vc.swiftirc.net");
  expect(board.getSnapshot().sounds).toEqual(LIST);
  expect(clips.loads).toEqual([
    ["clip:1f680", "https://vc.swiftirc.net/v/abc/sounds/board/1f680.mp3"],
    ["clip:1f9ea", "https://vc.swiftirc.net/v/abc/sounds/board/1f9ea.mp3"],
  ]);
  expect(board.getSnapshot().clips).toEqual({ "1f680": "loading", "1f9ea": "loading" });
  board.onLoaded(clipId("1f680"), true);
  board.onLoaded(clipId("1f9ea"), false);
  expect(board.getSnapshot().clips).toEqual({ "1f680": "ready", "1f9ea": "failed" });
});

test("start sends intent; the broadcast plays for everyone and marks it mine; stop/ended", () => {
  const { board, sent, clips } = make();
  board.setBoard(LIST, "https://h");
  board.onLoaded(clipId("1f680"), true);
  expect(board.start("1f680")).toBe("sent");
  expect(sent).toEqual([{ type: "sound", action: "start", id: "1f680" }]);
  expect(board.getSnapshot().playing).toBeNull(); // nothing until the server says so
  board.onSound({ type: "sound", action: "start", id: "1f680", by: "Ryan" });
  expect(board.getSnapshot().playing).toEqual({ id: "1f680", mine: true });
  expect(clips.plays).toEqual(["clip:1f680"]);
  expect(board.start("1f9ea")).toBe("busy");
  board.onEnded(clipId("1f680")); // finished naturally: the starter sends stop
  expect(sent.at(-1)).toEqual({ type: "sound", action: "stop", id: "1f680" });
  board.onSound({ type: "sound", action: "stop", id: "1f680", by: "Ryan" });
  expect(board.getSnapshot().playing).toBeNull();
  expect(clips.stops).toEqual(["clip:1f680"]);
});

test("someone else's clip: plays, locks, ended does not send stop, stop() is refused", () => {
  const { board, sent } = make();
  board.setBoard(LIST, "https://h");
  board.onLoaded(clipId("1f9ea"), true);
  board.onSound({ type: "sound", action: "start", id: "1f9ea", by: "Alice" });
  expect(board.getSnapshot().playing).toEqual({ id: "1f9ea", mine: false });
  board.onEnded(clipId("1f9ea"));
  expect(board.stop()).toBe("not-mine");
  expect(sent).toEqual([]);
});

test("a clip that never loaded isn't played; offline start is refused; reset unlocks", () => {
  const { board, clips } = make();
  board.setBoard(LIST, "https://h");
  board.onSound({ type: "sound", action: "start", id: "1f680", by: "A" });
  expect(clips.plays).toEqual([]); // still loading
  expect(board.getSnapshot().playing).toEqual({ id: "1f680", mine: false });
  board.reset(); // rejoin: the server doesn't replay a playing sound to joiners
  expect(board.getSnapshot().playing).toBeNull();
  expect(board.getSnapshot().sounds).toEqual(LIST); // the list survives a rejoin
  const off = make(false);
  off.board.setBoard(LIST, "https://h");
  expect(off.board.start("1f680")).toBe("offline");
});

test("unavailable hides the board and start refuses", () => {
  const { board } = make();
  board.unavailable();
  expect(board.getSnapshot().sounds).toBeNull();
  expect(board.start("1f680")).toBe("unavailable");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mobile && npx jest test/soundboard.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `mobile/src/core/soundboard.ts`:

```ts
// The soundboard: the server's clip list, which clip is playing, and whether we
// started it. Everyone (the starter too) plays on the server's start broadcast; the
// starter sends stop when its clip finishes naturally. `sound.by` is a display name,
// so "mine" means the id we asked to start.
import type { Sender } from "./chat";
import { normalizeBoard } from "../shared/web";
import type { Frame } from "./types";

export interface BoardSound { id: string; label: string; src: string }
export interface ClipPort { load(clipId: string, url: string): void; play(clipId: string): void; stop(clipId: string): void }
export type ClipState = "loading" | "ready" | "failed";
export interface BoardSnapshot {
  sounds: BoardSound[] | null;
  playing: { id: string; mine: boolean } | null;
  clips: Record<string, ClipState>;
}

export const clipId = (id: string): string => `clip:${id}`;
const idOf = (clip: string): string => clip.replace(/^clip:/, "");

export class Soundboard {
  private snap: BoardSnapshot = { sounds: null, playing: null, clips: {} };
  private requested: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private sender: Sender, private clips: ClipPort) {}

  setBoard(list: unknown, origin: string): void {
    const sounds = normalizeBoard(list) as BoardSound[];
    const clips: Record<string, ClipState> = {};
    for (const s of sounds) {
      clips[s.id] = this.snap.clips[s.id] === "ready" ? "ready" : "loading";
      if (clips[s.id] === "loading") this.clips.load(clipId(s.id), origin + s.src);
    }
    this.set({ ...this.snap, sounds, clips });
  }

  unavailable(): void {
    this.set({ ...this.snap, sounds: null });
  }

  onLoaded(clip: string, ok: boolean): void {
    const id = idOf(clip);
    if (!(id in this.snap.clips)) return;
    this.set({ ...this.snap, clips: { ...this.snap.clips, [id]: ok ? "ready" : "failed" } });
  }

  onSound(m: Frame): void {
    const id = String(m.id ?? "");
    if (m.action === "start") {
      const mine = this.requested === id;
      this.requested = null;
      if (this.snap.clips[id] === "ready") this.clips.play(clipId(id));
      this.set({ ...this.snap, playing: { id, mine } });
    } else if (m.action === "stop") {
      if (this.snap.playing) this.clips.stop(clipId(this.snap.playing.id));
      this.set({ ...this.snap, playing: null });
    }
  }

  onEnded(clip: string): void {
    const p = this.snap.playing;
    if (p && p.mine && clipId(p.id) === clip) this.sender("sound", { action: "stop", id: p.id });
  }

  start(id: string): "sent" | "offline" | "busy" | "unavailable" {
    if (!this.snap.sounds || !this.snap.sounds.some((s) => s.id === id)) return "unavailable";
    if (this.snap.playing) return "busy";
    if (!this.sender("sound", { action: "start", id })) return "offline";
    this.requested = id;
    return "sent";
  }

  stop(): "sent" | "offline" | "not-mine" {
    const p = this.snap.playing;
    if (!p || !p.mine) return "not-mine";
    return this.sender("sound", { action: "stop", id: p.id }) ? "sent" : "offline";
  }

  // Rejoin: the server doesn't tell joiners about a playing clip, so unlock.
  reset(): void {
    this.requested = null;
    if (this.snap.playing) this.clips.stop(clipId(this.snap.playing.id));
    this.set({ ...this.snap, playing: null });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): BoardSnapshot => this.snap;

  private set(next: BoardSnapshot) {
    this.snap = next;
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Run tests, type check, lint**

Run: `cd mobile && npx jest test/soundboard.test.ts && npm run -s typecheck && npx eslint src test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/soundboard.ts mobile/test/soundboard.test.ts
git commit -m "feat(mobile): soundboard store — one clip at a time, starter-only stop"
```

---

### Task 7: Volumes store

**Files:**
- Create: `mobile/src/core/volumes.ts`, `mobile/test/volumes.test.ts`

**Interfaces:**
- Produces: `VOLUME_MIN = 0`, `VOLUME_MAX = 2`, `VOLUME_STEP = 0.05`; `class Volumes { get(id: string): number /* default 1 */; set(id: string, v: number): void /* clamps, rounds to step */; subscribe; getSnapshot(): Record<string, number> }`.

- [ ] **Step 1: Write the failing test** — create `mobile/test/volumes.test.ts`:

```ts
import { Volumes } from "../src/core/volumes";

test("defaults to 100%, clamps to 0–200%, rounds to 5% steps, notifies on change only", () => {
  const v = new Volumes();
  let n = 0;
  v.subscribe(() => n++);
  expect(v.get("a")).toBe(1);
  v.set("a", 1.53);
  expect(v.get("a")).toBe(1.55);
  v.set("a", 9);
  expect(v.get("a")).toBe(2);
  v.set("a", -1);
  expect(v.get("a")).toBe(0);
  v.set("a", 0);
  expect(n).toBe(3);
  expect(v.getSnapshot()).toEqual({ a: 0 });
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npx jest test/volumes.test.ts` → FAIL.

- [ ] **Step 3: Implement** — create `mobile/src/core/volumes.ts`:

```ts
// Per-participant listening volume for this call (not saved), keyed by participant id.
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;
export const VOLUME_STEP = 0.05;

export class Volumes {
  private snap: Record<string, number> = {};
  private listeners = new Set<() => void>();

  get(id: string): number {
    return this.snap[id] ?? 1;
  }

  set(id: string, v: number): void {
    const clamped = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Number.isFinite(v) ? v : 1));
    const stepped = Math.round(clamped / VOLUME_STEP) * VOLUME_STEP;
    const value = Math.round(stepped * 100) / 100;
    if (this.snap[id] === value) return;
    this.snap = { ...this.snap, [id]: value };
    for (const fn of [...this.listeners]) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): Record<string, number> => this.snap;
}
```

- [ ] **Step 4: Run tests** — `cd mobile && npx jest test/volumes.test.ts && npm run -s typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/volumes.ts mobile/test/volumes.test.ts
git commit -m "feat(mobile): per-participant volume store"
```

---

### Task 8: Wire polls, soundboard, volumes and Data saver into Call

**Files:**
- Modify: `mobile/src/core/api.ts`, `mobile/test/api.test.ts`, `mobile/src/core/call.ts`, `mobile/test/call.test.ts`, `mobile/src/native/callFactory.ts`, `mobile/src/ui/screens/PreJoin.tsx`

**Interfaces:**
- Consumes: `Polls` (Task 5), `Soundboard`, `ClipPort`, `BoardSound` (Task 6), `Volumes` (Task 7), `ChatLog.onPollEvent` (Task 5).
- Produces:
  - `api.ts`: `fetchSoundboard(f: Fetcher, origin: string): Promise<unknown[] | null>` — `null` on any failure or a non-array body.
  - `CallDeps` gains `clips: ClipPort` and `fetchBoard(origin: string): Promise<unknown[] | null>`.
  - `JoinRequest` gains `dataSaver: boolean`.
  - `CallState` gains `dataSaver: boolean`.
  - `Call` gains `readonly polls: Polls`, `readonly soundboard: Soundboard`, `readonly volumes: Volumes`, `setDataSaver(on: boolean): void`.

- [ ] **Step 1: `fetchSoundboard` test** — add `fetchSoundboard` to the existing `import { … } from "../src/core/api";` line in `mobile/test/api.test.ts` and append (it uses the file's `fetcher(routes)` helper):

```ts
test("fetchSoundboard returns the list, or null on failure or a bad body", async () => {
  const list = [{ id: "a", label: "🚀", src: "/s.mp3" }];
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 200, body: list } }), "https://h")).toEqual(list);
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 404 } }), "https://h")).toBeNull();
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": { status: 200, body: { not: "a list" } } }), "https://h")).toBeNull();
  expect(await fetchSoundboard(fetcher({ "https://h/api/soundboard": "throw" }), "https://h")).toBeNull();
});
```

- [ ] **Step 2: Call tests** — in `mobile/test/call.test.ts` `setup()`: add

```ts
  const clipCalls: string[] = [];
  let board: unknown[] | null = [{ id: "1f680", label: "🚀", src: "/v/x/sounds/board/1f680.mp3" }];
```

to the top of `setup()`, and to the `Call` deps:

```ts
    clips: { load: (id) => clipCalls.push(`load ${id}`), play: (id) => clipCalls.push(`play ${id}`), stop: (id) => clipCalls.push(`stop ${id}`) },
    fetchBoard: async () => board,
```

return `clipCalls` and a `setBoard: (b: unknown[] | null) => { board = b; }` from `setup()`, and add `dataSaver: false` to the `req()` helper's defaults. Then append:

```ts
test("polls: joined.poll seeds, poll frames update and reach chat; votes go out", async () => {
  const t = setup();
  await t.call.join(req());
  sock().open();
  sock().receive(joined({ poll: { id: "p1", question: "Q", options: ["a", "b"], tallies: [1, 0], by: "Op", open: true, yourVote: 0 } }));
  await flush();
  expect(t.call.polls.getSnapshot()).toMatchObject({ id: "p1", yourVote: 0 });
  sock().receive({ type: "poll", action: "open", id: "p2", question: "Q2", options: ["x", "y"], tallies: [0, 0], by: "Op", open: true });
  expect(t.call.polls.getSnapshot()).toMatchObject({ id: "p2", yourVote: null });
  expect(t.call.chat.getSnapshot().entries.at(-1)).toMatchObject({ kind: "poll", pollId: "p2" });
  expect(t.call.polls.vote(1)).toBe("sent");
  expect(framesOf("vote")).toEqual([{ type: "vote", pollId: "p2", choice: 1 }]);
});

test("poll create/close follow our role", async () => {
  const { call } = await inCall();
  expect(call.polls.create("Q?", ["a", "b"])).toBe("not-op");
  sock().receive({ type: "role", id: "me", role: "op" });
  expect(call.polls.create("Q?", ["a", "b"])).toBe("sent");
});

test("soundboard: board fetched once and clips loaded; sound frames play; rejoin unlocks", async () => {
  const t = await inCall();
  await flush();
  expect(t.call.soundboard.getSnapshot().sounds).toHaveLength(1);
  expect(t.clipCalls).toEqual(["load clip:1f680"]);
  t.call.soundboard.onLoaded("clip:1f680", true);
  sock().receive({ type: "sound", action: "start", id: "1f680", by: "Alice" });
  expect(t.clipCalls.at(-1)).toBe("play clip:1f680");
  sock().drop();
  t.timers.advance(500);
  sock().open();
  sock().receive(joined());
  await flush();
  expect(t.call.soundboard.getSnapshot().playing).toBeNull();
  expect(t.clipCalls.filter((c) => c.startsWith("load"))).toHaveLength(1); // not refetched on rejoin
});

test("soundboard unavailable when the endpoint fails", async () => {
  const t = setup();
  t.setBoard(null);
  await t.call.join(req());
  sock().open();
  sock().receive(joined());
  await flush();
  expect(t.call.soundboard.getSnapshot().sounds).toBeNull();
});

test("data saver: from the join request, toggled, and re-sent after every joined", async () => {
  const t = setup();
  await t.call.join(req({ dataSaver: true }));
  sock().open();
  sock().receive(joined());
  await flush();
  expect(framesOf("set-receive-video")).toEqual([{ type: "set-receive-video", enabled: false }]);
  expect(t.call.getState().dataSaver).toBe(true);
  t.call.setDataSaver(false);
  expect(framesOf("set-receive-video").at(-1)).toEqual({ type: "set-receive-video", enabled: true });
  expect(t.call.getState().dataSaver).toBe(false);
  t.call.setDataSaver(true);
  sock().drop();
  t.timers.advance(500);
  sock().open();
  sock().receive(joined());
  await flush();
  expect(sock().sent.filter((f) => f.type === "set-receive-video")).toEqual([{ type: "set-receive-video", enabled: false }]);
});

test("data saver off at join sends nothing", async () => {
  await inCall();
  expect(framesOf("set-receive-video")).toEqual([]);
});
```

(`framesOf(type)` collects frames across every socket; `sock().sent` is the current socket only — both are existing helpers in this file.)

- [ ] **Step 3: Run to verify failure** — `cd mobile && npx jest test/call.test.ts test/api.test.ts` → FAIL (types/members missing).

- [ ] **Step 4: Implement**

`api.ts`:

```ts
// GET /api/soundboard -> [{id, label, src}]; null when unreachable or malformed.
export async function fetchSoundboard(f: Fetcher, origin: string): Promise<unknown[] | null> {
  try {
    const res = await f(`${origin}/api/soundboard`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}
```

`call.ts`:
- Imports: `import { Polls } from "./polls";`, `import { Soundboard, type ClipPort } from "./soundboard";`, `import { Volumes } from "./volumes";`.
- `CallDeps`: add `clips: ClipPort;` and `fetchBoard(origin: string): Promise<unknown[] | null>;`.
- `JoinRequest`: add `dataSaver: boolean;`. `CallState`: add `dataSaver: boolean;` (initial `false`).
- Fields: `readonly polls: Polls; readonly soundboard: Soundboard; readonly volumes = new Volumes(); private boardRequested = false;`
- Constructor (after `this.chat = …`):

```ts
    this.polls = new Polls((type, fields) => this.trySend(type, fields), () => this.state.role === "op");
    this.soundboard = new Soundboard((type, fields) => this.trySend(type, fields), deps.clips);
```

- In `join()`: include `dataSaver: req.dataSaver` in the first `update(...)`; add handlers next to `chat`:

```ts
    sig.on("poll", (m) => {
      this.polls.onPoll(m);
      this.chat.onPollEvent(String(m.action), String(m.id));
    });
    sig.on("sound", (m) => this.soundboard.onSound(m));
```

- In `onJoined`, after `this.chat.clear();`:

```ts
    this.polls.seed(m.poll);
    this.soundboard.reset();
    if (this.state.dataSaver) this.sig?.send("set-receive-video", { enabled: false });
    if (!this.boardRequested) {
      this.boardRequested = true;
      const origin = this.req!.link.origin;
      this.deps.fetchBoard(origin).then((list) => {
        if (list) this.soundboard.setBoard(list, origin);
        else this.soundboard.unavailable();
      }).catch(() => this.soundboard.unavailable());
    }
```

  (The `set-receive-video` send happens here, before `update({ phase: "in-call" … })`, so use `this.sig?.send` directly — the socket is open and `joined` arrived on it.)
- New method after `rename`:

```ts
  // Data saver: the SFU stops forwarding video to us. Remembered for the call and
  // re-sent after every joined; if offline now, the next joined sends it.
  setDataSaver(on: boolean): void {
    this.update({ dataSaver: on });
    this.trySend("set-receive-video", { enabled: !on });
  }
```

`callFactory.ts`: import `fetchSoundboard` from `../core/api` and the clip functions from `./sounds` (added in Task 9 — until then add to `sounds.ts` the stubs `export function loadClip(_id: string, _url: string): void {}`, `export function playClip(_id: string): void {}`, `export function stopClip(_id: string): void {}`, which Task 9 replaces), and add to the deps:

```ts
    clips: { load: loadClip, play: playClip, stop: stopClip },
    fetchBoard: (origin) => fetchSoundboard(fetch, origin),
```

`PreJoin.tsx`: `loadPrefs()` already runs on mount — keep its `dataSaver` in state (`const [dataSaver, setDataSaver] = useState(false)`, set from `p.dataSaver`) and pass `dataSaver` in the `join({...})` request.

- [ ] **Step 5: Run tests, type check, lint**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/core/api.ts mobile/test/api.test.ts mobile/src/core/call.ts mobile/test/call.test.ts mobile/src/native/callFactory.ts mobile/src/native/sounds.ts mobile/src/ui/screens/PreJoin.tsx
git commit -m "feat(mobile): wire polls, soundboard, volumes and data saver into Call"
```

---

### Task 9: CoyoteSounds loads remote clips

**Files:**
- Modify: `mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteSoundsModule.kt`, `mobile/ios/Coyote/CoyoteSounds.swift`, `mobile/src/native/sounds.ts`, `mobile/src/native/callFactory.ts`, `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Native: `preload(id, uri)` now accepts `https://` URLs — the file is downloaded once into the app cache (named from the URL path, which includes the server version, so a new build's clips are fetched fresh) and then prepared; when done, the module emits `CoyoteSoundLoaded {id, ok}`. `asset:` behaviour is unchanged (no event needed, but emitting `{id, ok}` is harmless). A failed preload **removes** any previous player for that id on both platforms.
- JS (`sounds.ts`): `loadClip(id, url)`, `playClip(id)`, `stopClip(id)`, `onSoundLoaded(fn: (id: string, ok: boolean) => void): () => void`; `onSoundEnded` unchanged.
- `callFactory.ts`: subscribes `onSoundLoaded` → `call.soundboard.onLoaded` and `onSoundEnded` → `call.soundboard.onEnded`; unsubscribes in `dispose()`.

- [ ] **Step 1: Contract test** — append to `mobile/test/nativeModules.test.ts`:

```ts
test("CoyoteSounds downloads remote clips off the main thread and reports loads", () => {
  const app = path.join(__dirname, "..");
  const kt = fs.readFileSync(path.join(app, "android", "app", "src", "main", "java", "net", "swiftirc", "coyote", "CoyoteSoundsModule.kt"), "utf8");
  const swift = fs.readFileSync(path.join(app, "ios", "Coyote", "CoyoteSounds.swift"), "utf8");
  expect(kt).toContain("CoyoteSoundLoaded");
  expect(kt).toMatch(/Executors\.newSingleThreadExecutor/);
  expect(swift).toContain("CoyoteSoundLoaded");
  expect(swift).toMatch(/downloadTask/);
  expect(swift).not.toMatch(/methodQueue/); // 2a Ruling: main-thread confinement
  expect(swift).not.toMatch(/setCategory|setMode|setActive/);
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npx jest test/nativeModules.test.ts` → FAIL.

- [ ] **Step 3: Android** — in `CoyoteSoundsModule.kt`:
  - Add imports `java.io.File`, `java.net.URL`, `java.util.concurrent.Executors`, `java.util.concurrent.ConcurrentHashMap`.
  - Change `players` to `private val players = ConcurrentHashMap<String, MediaPlayer>()` and add `private val io = Executors.newSingleThreadExecutor()`.
  - Replace `preload` with:

```kotlin
  @ReactMethod
  fun preload(id: String, uri: String) {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      io.execute {
        val ok = try {
          val file = cachedFile(uri)
          if (!file.exists()) URL(uri).openStream().use { input -> file.outputStream().use { input.copyTo(it) } }
          prepare(id, Uri.fromFile(file).toString())
        } catch (e: Exception) {
          Log.w("CoyoteSounds", "download $id failed", e)
          players.remove(id)?.release()
          false
        }
        emitLoaded(id, ok)
      }
      return
    }
    emitLoaded(id, prepare(id, uri))
  }

  private fun cachedFile(uri: String): File {
    val name = Uri.parse(uri).path.orEmpty().trim('/').replace('/', '_').ifEmpty { "clip" }
    return File(File(ctx.cacheDir, "sounds").apply { mkdirs() }, name)
  }

  // Returns true when ready. On failure any previous player for `id` is dropped.
  private fun prepare(id: String, uri: String): Boolean {
    players.remove(id)?.release()
    val p = MediaPlayer()
    return try {
      p.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      if (uri.startsWith("asset:")) {
        val res = bundled[uri.removePrefix("asset:")] ?: run { p.release(); return false }
        ctx.resources.openRawResourceFd(res).use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
      } else {
        p.setDataSource(ctx, Uri.parse(uri))
      }
      p.setOnCompletionListener { emitEnded(id) }
      p.prepare()
      players[id] = p
      true
    } catch (e: Exception) {
      Log.w("CoyoteSounds", "preload $id failed", e)
      p.release()
      false
    }
  }

  private fun emitLoaded(id: String, ok: Boolean) {
    val body = Arguments.createMap().apply { putString("id", id); putBoolean("ok", ok) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteSoundLoaded", body)
  }
```

  - In `invalidate()` also call `io.shutdownNow()`.

- [ ] **Step 4: iOS** — in `CoyoteSounds.swift`:
  - `supportedEvents()` returns `["CoyoteSoundEnded", "CoyoteSoundLoaded"]`.
  - Replace the body of `preload` with:

```swift
  @objc(preload:uri:)
  func preload(_ id: String, uri: String) {
    if uri.hasPrefix("http://") || uri.hasPrefix("https://"), let remote = URL(string: uri) {
      let local = cachedURL(for: remote)
      if FileManager.default.fileExists(atPath: local.path) {
        DispatchQueue.main.async { [weak self] in self?.prepare(id, url: local) }
        return
      }
      URLSession.shared.downloadTask(with: remote) { [weak self] tmp, _, error in
        var ready: URL? = nil
        if let tmp = tmp, error == nil {
          try? FileManager.default.removeItem(at: local)
          if (try? FileManager.default.moveItem(at: tmp, to: local)) != nil { ready = local }
        }
        DispatchQueue.main.async { [weak self] in
          if let ready = ready { self?.prepare(id, url: ready) } else { self?.fail(id) }
        }
      }.resume()
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if let url = self.resolve(uri) { self.prepare(id, url: url) } else { self.fail(id) }
    }
  }

  // Main thread only (Ruling 1).
  private func prepare(_ id: String, url: URL) {
    guard let p = try? AVAudioPlayer(contentsOf: url) else { fail(id); return }
    p.delegate = self
    p.prepareToPlay()
    players[id] = p
    loaded(id, ok: true)
  }

  private func fail(_ id: String) {
    players[id] = nil // a failed (re)load never leaves a stale player behind
    loaded(id, ok: false)
  }

  private func loaded(_ id: String, ok: Bool) {
    if listening { sendEvent(withName: "CoyoteSoundLoaded", body: ["id": id, "ok": ok]) }
  }

  private func cachedURL(for remote: URL) -> URL {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("sounds", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = remote.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).replacingOccurrences(of: "/", with: "_")
    return dir.appendingPathComponent(name.isEmpty ? "clip" : name)
  }
```

  Keep `resolve(_:)` for `asset:` and `file:` URIs. No change to `CoyoteSounds.m` (method signatures unchanged).

- [ ] **Step 5: JS wrapper** — in `mobile/src/native/sounds.ts` replace the Task 8 stubs with:

```ts
export function loadClip(id: string, url: string): void {
  try {
    CoyoteSounds?.preload(id, url);
  } catch (e) {
    console.warn("clip load failed", e);
  }
}

export function playClip(id: string): void {
  try {
    CoyoteSounds?.play(id);
  } catch (e) {
    console.warn("clip play failed", e);
  }
}

export function stopClip(id: string): void {
  try {
    CoyoteSounds?.stop(id);
  } catch (e) {
    console.warn("clip stop failed", e);
  }
}

export function onSoundLoaded(fn: (id: string, ok: boolean) => void): () => void {
  if (!CoyoteSounds) return () => {};
  const sub = new NativeEventEmitter(CoyoteSounds).addListener("CoyoteSoundLoaded", (e) => {
    const ev = e as { id?: unknown; ok?: unknown };
    if (typeof ev.id === "string") fn(ev.id, ev.ok === true);
  });
  return () => sub.remove();
}
```

  In `callFactory.ts`, after `const stopLifecycle = …`:

```ts
  const stopLoaded = onSoundLoaded((id, ok) => call?.soundboard.onLoaded(id, ok));
  const stopEnded = onSoundEnded((id) => call?.soundboard.onEnded(id));
```

  and call `stopLoaded(); stopEnded();` in `dispose()`.

- [ ] **Step 6: Run tests, type check, lint, Android compile**

Run: `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`, then `cd android && ./gradlew :app:compileDebugKotlin -q` (report if the SDK is unavailable here).
Expected: PASS / BUILD SUCCESSFUL. Swift is verified on the maintainer's Mac.

- [ ] **Step 7: Commit**

```bash
git add mobile/android/app/src/main/java/net/swiftirc/coyote/CoyoteSoundsModule.kt mobile/ios/Coyote/CoyoteSounds.swift mobile/src/native/sounds.ts mobile/src/native/callFactory.ts mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): CoyoteSounds downloads and caches remote clips, reports loads"
```

---

### Task 10: Poll UI — card, Poll tab, chat cards, op form

**Files:**
- Create: `mobile/src/ui/components/PollCard.tsx`, `mobile/src/ui/components/PollForm.tsx`
- Modify: `mobile/src/ui/hooks.ts`, `mobile/src/ui/components/ChatSheet.tsx`, `mobile/src/ui/components/MoreSheet.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `Polls`, `PollView`, `PollResult`, limits (Task 5); `tallyPercents`, `totalVotes` (Task 2); `Sheet` (2a).
- Produces:
  - `hooks.ts`: `usePoll(): PollView | null`.
  - `PollCard` props `{ poll: PollView; isOp: boolean; stale?: boolean; onVote(i: number): PollResult; onClose(): PollResult }` — `stale` renders "This poll was replaced." instead of tallies.
  - `PollForm` props `{ visible: boolean; onClose(): void; replacing: boolean; create(q: string, opts: string[]): PollResult }`.
  - `ChatSheet` gains props `{ isOp: boolean; polls: { vote(i: number): PollResult; close(): PollResult } }` and a header with tabs `Chat · Poll` (state `"chat" | "poll"`); the 🔊 header button is added in Task 11.
  - `MoreSheet` gains `isOp: boolean; onNewPoll(): void` (a "New poll…" row for ops). Tasks 13 adds the toggles.

- [ ] **Step 1: Hook** — in `hooks.ts`:

```ts
import type { PollView } from "../core/polls";

export function usePoll(): PollView | null {
  const { call } = useCall();
  return useStore(call()?.polls ?? null, null as PollView | null);
}
```

- [ ] **Step 2: PollCard** — create `PollCard.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PollResult, PollView } from "../../core/polls";
import { tallyPercents, totalVotes } from "../../shared/web";
import { colors, radius } from "../theme";

const ERRORS: Partial<Record<PollResult, string>> = {
  offline: "Not connected — vote not sent.",
  closed: "This poll is closed.",
  "not-op": "Only ops can close polls.",
};

export function PollCard({ poll, isOp, stale = false, onVote, onClose }: {
  poll: PollView; isOp: boolean; stale?: boolean; onVote(i: number): PollResult; onClose(): PollResult;
}) {
  const [msg, setMsg] = useState("");
  if (stale) return <Text style={styles.stale}>This poll was replaced.</Text>;
  const pct = tallyPercents(poll.tallies);
  const total = totalVotes(poll.tallies);
  const max = Math.max(0, ...poll.tallies);
  const act = (r: PollResult) => setMsg(r === "sent" ? "" : ERRORS[r] || "");
  return (
    <View style={styles.card}>
      <Text style={styles.question}>{poll.question}</Text>
      <Text style={styles.meta}>{poll.open ? `Poll by ${poll.by}` : "Closed"} · {total} vote{total === 1 ? "" : "s"}</Text>
      {poll.options.map((o, i) => {
        const mine = poll.yourVote === i;
        const winner = !poll.open && total > 0 && poll.tallies[i] === max;
        return (
          <Pressable key={i} disabled={!poll.open} onPress={() => act(onVote(i))} accessibilityRole="button"
            accessibilityLabel={`${o}, ${poll.tallies[i] ?? 0} votes${mine ? ", your vote" : ""}`} style={[styles.option, mine && styles.mine, winner && styles.winner]}>
            <View style={[styles.bar, { width: `${pct[i] ?? 0}%` }]} />
            <Text style={styles.optText} numberOfLines={2}>{o}</Text>
            <Text style={styles.count}>{poll.tallies[i] ?? 0} · {pct[i] ?? 0}%</Text>
          </Pressable>
        );
      })}
      {isOp && poll.open ? (
        <Pressable onPress={() => act(onClose())} style={styles.close} accessibilityRole="button">
          <Text style={styles.closeText}>Close poll</Text>
        </Pressable>
      ) : null}
      {msg ? <Text style={styles.err}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: 12, gap: 6, marginVertical: 4 },
  question: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  option: { borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 8 },
  mine: { borderColor: colors.accent },
  winner: { borderColor: colors.text },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(232,131,58,0.25)" },
  optText: { flex: 1, color: colors.text },
  count: { color: colors.muted, fontVariant: ["tabular-nums"] },
  close: { alignSelf: "flex-start", paddingVertical: 6 },
  closeText: { color: colors.accent, fontWeight: "600" },
  err: { color: colors.danger },
  stale: { color: colors.muted, fontStyle: "italic" },
});
```

- [ ] **Step 3: PollForm** — create `PollForm.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { OPTION_MAX, OPTIONS_MAX, OPTIONS_MIN, QUESTION_MAX, type PollResult } from "../../core/polls";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";

const ERRORS: Partial<Record<PollResult, string>> = {
  invalid: `Add a question and ${OPTIONS_MIN}–${OPTIONS_MAX} options.`,
  offline: "Not connected — poll not created.",
  "not-op": "Only ops can create polls.",
};

export function PollForm({ visible, onClose, replacing, create }: {
  visible: boolean; onClose(): void; replacing: boolean; create(q: string, opts: string[]): PollResult;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (visible) { setQuestion(""); setOptions(["", ""]); setMsg(""); }
  }, [visible]);
  const submit = () => {
    const r = create(question, options);
    if (r === "sent") onClose();
    else setMsg(ERRORS[r] || "");
  };
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.75}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>New poll</Text>
        {replacing ? <Text style={styles.warn}>This replaces the current poll and its votes.</Text> : null}
        <TextInput style={styles.input} placeholder="Question" placeholderTextColor={colors.muted}
          value={question} onChangeText={setQuestion} maxLength={QUESTION_MAX} accessibilityLabel="Question" />
        {options.map((o, i) => (
          <View key={i} style={styles.row}>
            <TextInput style={[styles.input, styles.flex]} placeholder={`Option ${i + 1}`} placeholderTextColor={colors.muted}
              value={o} maxLength={OPTION_MAX} accessibilityLabel={`Option ${i + 1}`}
              onChangeText={(t) => setOptions(options.map((x, j) => (j === i ? t : x)))} />
            {options.length > OPTIONS_MIN ? (
              <Pressable onPress={() => setOptions(options.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`}>
                <Text style={styles.remove}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {options.length < OPTIONS_MAX ? (
          <Pressable onPress={() => setOptions([...options, ""])} accessibilityRole="button">
            <Text style={styles.add}>+ Add option</Text>
          </Pressable>
        ) : null}
        {msg ? <Text style={styles.err}>{msg}</Text> : null}
        <Pressable onPress={submit} style={styles.create} accessibilityRole="button">
          <Text style={styles.createText}>Create poll</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  label: { color: colors.muted, textTransform: "uppercase", fontSize: 12 },
  warn: { color: colors.accent },
  input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 12, fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  flex: { flex: 1 },
  remove: { color: colors.muted, fontSize: 22, paddingHorizontal: 6 },
  add: { color: colors.accent, fontWeight: "600" },
  err: { color: colors.danger },
  create: { backgroundColor: colors.accent, borderRadius: radius, padding: 14, alignItems: "center" },
  createText: { color: "#000", fontWeight: "700", fontSize: 16 },
});
```

- [ ] **Step 4: ChatSheet tabs and poll entries**
  - Add props `isOp: boolean` and `polls: { vote(i: number): PollResult; close(): PollResult }`; read `const poll = usePoll();` and `const [tab, setTab] = useState<"chat" | "poll">("chat");`.
  - Above the list, render a header row: two Pressables "Chat" and "Poll" (the active one in `colors.text`, the other `colors.muted`; `accessibilityRole="tab"`, `accessibilityState={{ selected }}`). Leave space on the right for Task 11's 🔊 button (`styles.header` = `{ flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 12, paddingBottom: 6 }`, with a `<View style={{ flex: 1 }} />` spacer as the last child).
  - When `tab === "poll"`: render `poll ? <PollCard poll={poll} isOp={isOp} onVote={polls.vote} onClose={polls.close} /> : <Text style={styles.system}>No poll in this room.</Text>` inside a padded `ScrollView`, and hide the input row.
  - In `Line`, handle `e.kind === "poll"`: `return poll ? <PollCard poll={poll} isOp={isOp} stale={poll.id !== e.pollId} onVote={polls.vote} onClose={polls.close} /> : <Text style={styles.system}>Poll</Text>;` — pass `poll`, `isOp`, `polls` into `Line` as props (replace any temporary `return null` from Task 5).
- [ ] **Step 5: MoreSheet "New poll…"** — add props `isOp: boolean; onNewPoll(): void`; under the Name block, when `isOp`, render a full-width row Pressable "New poll…" (`accessibilityRole="button"`) that calls `onNewPoll()`.
- [ ] **Step 6: Call screen** — `sheet` state becomes `"chat" | "more" | "poll-form" | null`. Pass to `ChatSheet`: `isOp={state.role === "op"}` and `polls={{ vote: (i) => call()?.polls.vote(i) ?? "offline", close: () => call()?.polls.close() ?? "offline" }}`. Pass to `MoreSheet`: `isOp={state.role === "op"}` and `onNewPoll={() => setSheet("poll-form")}`. Mount:

```tsx
        <PollForm
          visible={sheet === "poll-form"}
          onClose={() => setSheet(null)}
          replacing={!!pollNow?.open}
          create={(q, o) => call()?.polls.create(q, o) ?? "offline"}
        />
```

  with `const pollNow = usePoll();` among the hooks above the early return.

- [ ] **Step 7: Type check, lint, tests**

Run: `cd mobile && npm run -s typecheck && npx eslint src && npx jest` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): poll cards in chat, a Poll tab, and the op poll form"
```

---

### Task 11: Soundboard panel

**Files:**
- Create: `mobile/src/ui/components/SoundboardPanel.tsx`
- Modify: `mobile/src/ui/hooks.ts`, `mobile/src/ui/components/ChatSheet.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `Soundboard`, `BoardSnapshot` (Task 6); `boardButtonState` (Task 2).
- Produces: `useSoundboard(): BoardSnapshot`; `SoundboardPanel` props `{ board: BoardSnapshot; start(id: string): "sent" | "offline" | "busy" | "unavailable"; stop(): "sent" | "offline" | "not-mine" }`; `ChatSheet` gains prop `soundboard: { start; stop }` and a third tab `"sounds"` shown only when `board.sounds` is non-null and non-empty.

- [ ] **Step 1: Hook** — in `hooks.ts`:

```ts
import type { BoardSnapshot } from "../core/soundboard";

const EMPTY_BOARD: BoardSnapshot = { sounds: null, playing: null, clips: {} };

export function useSoundboard(): BoardSnapshot {
  const { call } = useCall();
  return useStore(call()?.soundboard ?? null, EMPTY_BOARD);
}
```

- [ ] **Step 2: Panel** — create `SoundboardPanel.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BoardSnapshot } from "../../core/soundboard";
import { boardButtonState } from "../../shared/web";
import { colors, radius } from "../theme";

export function SoundboardPanel({ board, start, stop }: {
  board: BoardSnapshot;
  start(id: string): "sent" | "offline" | "busy" | "unavailable";
  stop(): "sent" | "offline" | "not-mine";
}) {
  const [msg, setMsg] = useState("");
  const playing = board.playing?.id ?? "";
  const mine = !!board.playing?.mine;
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {(board.sounds ?? []).map((s) => {
          const st = boardButtonState(s.id, s.label, playing, mine);
          const failed = board.clips[s.id] === "failed";
          const disabled = st.disabled || failed;
          return (
            <Pressable
              key={s.id}
              disabled={disabled}
              onPress={() => {
                const r = st.active ? stop() : start(s.id);
                setMsg(r === "offline" ? "Not connected." : "");
              }}
              accessibilityRole="button"
              accessibilityLabel={failed ? `${s.label} unavailable` : st.title}
              accessibilityState={{ disabled, selected: st.active }}
              style={[styles.btn, st.active && styles.active, disabled && styles.off]}
            >
              <Text style={styles.emoji}>{st.active ? "⏹" : s.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {msg ? <Text style={styles.err}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  btn: { width: 64, height: 64, borderRadius: radius, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  active: { borderColor: colors.accent },
  off: { opacity: 0.4 },
  emoji: { fontSize: 30 },
  err: { color: colors.danger },
});
```

- [ ] **Step 3: ChatSheet** — add prop `soundboard: { start(id: string): …; stop(): … }`; read `const board = useSoundboard();`; extend `tab` to `"chat" | "poll" | "sounds"`; add a 🔊 tab button (`accessibilityLabel="Soundboard"`) to the header only when `board.sounds?.length`; render `<SoundboardPanel board={board} start={soundboard.start} stop={soundboard.stop} />` for that tab (no input row). If the tab is `"sounds"` and the board becomes unavailable, fall back to `"chat"`.
- [ ] **Step 4: Call screen** — pass `soundboard={{ start: (id) => call()?.soundboard.start(id) ?? "offline", stop: () => call()?.soundboard.stop() ?? "offline" }}` to `ChatSheet`.
- [ ] **Step 5: Type check, lint, tests** — `cd mobile && npm run -s typecheck && npx eslint src && npx jest` → PASS.
- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): soundboard tab in the chat sheet"
```

---

### Task 12: Per-participant volume (long-press a tile)

**Files:**
- Create: `mobile/src/ui/components/VolumeSheet.tsx`
- Modify: `mobile/src/ui/hooks.ts`, `mobile/src/ui/components/Tile.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `Volumes`, `VOLUME_*` (Task 7); `Slider`, `setStreamVolume` (2a); `Sheet` (2a).
- Produces: `useVolumes(): Record<string, number>`; `Tile` gains props `volume: number` and `onLongPress(): void`; `VolumeSheet` props `{ p: Participant | null; volume: number; onChange(v: number): void; onClose(): void }`.

- [ ] **Step 1: Hook** — `hooks.ts`:

```ts
const EMPTY_VOLUMES: Record<string, number> = {};

export function useVolumes(): Record<string, number> {
  const { call } = useCall();
  return useStore(call()?.volumes ?? null, EMPTY_VOLUMES);
}
```

- [ ] **Step 2: Tile** — in `Tile.tsx`: add `volume: number; onLongPress(): void` to the props; import `Pressable` and `setStreamVolume` from `../../native/volume`; wrap the tile's root `View` in a `Pressable` with `onLongPress={onLongPress}` (`delayLongPress={350}`, `accessibilityHint="Long-press to change this person's volume"`); apply the volume whenever the stream or value changes:

```tsx
  useEffect(() => {
    setStreamVolume(p.audio, volume);
  }, [p.audio, volume]);
```

  Show a small `🔉NN%` badge next to the name when `volume !== 1`.

- [ ] **Step 3: VolumeSheet** — create `VolumeSheet.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Participant } from "../../core/roster";
import { VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../core/volumes";
import { colors } from "../theme";
import { Sheet } from "./Sheet";
import { Slider } from "./Slider";

export function VolumeSheet({ p, volume, onChange, onClose }: {
  p: Participant | null; volume: number; onChange(v: number): void; onClose(): void;
}) {
  return (
    <Sheet visible={!!p} onClose={onClose} heightFraction={0.25}>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{p?.name ?? ""}</Text>
        <Text style={styles.value}>Volume {Math.round(volume * 100)}%</Text>
        <Slider value={volume} min={VOLUME_MIN} max={VOLUME_MAX} step={VOLUME_STEP} onChange={onChange}
          accessibilityLabel={`${p?.name ?? ""} volume`} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  value: { color: colors.muted },
});
```

- [ ] **Step 4: Call screen** — hooks: `const volumes = useVolumes();` and `const [volumeFor, setVolumeFor] = useState<string | null>(null);`. Pass to each person `Tile`: `volume={volumes[t.p.id] ?? 1}` and `onLongPress={() => setVolumeFor(t.p.id)}`. Mount:

```tsx
        <VolumeSheet
          p={volumeFor ? people.find((x) => x.id === volumeFor) ?? null : null}
          volume={volumeFor ? volumes[volumeFor] ?? 1 : 1}
          onChange={(v) => { if (volumeFor) call()?.volumes.set(volumeFor, v); }}
          onClose={() => setVolumeFor(null)}
        />
```

  (A participant who leaves makes `p` null, which closes the sheet.)
- [ ] **Step 5: Type check, lint, tests** → PASS.
- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): long-press a tile to set that person's volume"
```

---

### Task 13: Settings — Data saver and Hide self-view

**Files:**
- Create: `mobile/src/ui/components/Toggle.tsx`
- Modify: `mobile/src/ui/components/MoreSheet.tsx`, `mobile/src/ui/components/Tile.tsx`, `mobile/src/ui/screens/Call.tsx`

**Interfaces:**
- Consumes: `Call.setDataSaver`, `CallState.dataSaver` (Task 8); `savePrefs`, `loadPrefs` (Task 4).
- Produces: `Toggle` props `{ label: string; value: boolean; onChange(v: boolean): void }` (a row with RN's built-in `Switch`); `MoreSheet` gains `dataSaver: boolean; onDataSaver(v: boolean): void; hideSelf: boolean; onHideSelf(v: boolean): void`; `Tile` gains `dataSaver: boolean`.

- [ ] **Step 1: Toggle** — create `Toggle.tsx`:

```tsx
import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { colors } from "../theme";

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  label: { color: colors.text, fontSize: 16 },
});
```

- [ ] **Step 2: MoreSheet** — add the four props; below the Name block render `<Toggle label="Data saver" value={dataSaver} onChange={onDataSaver} />` with a muted caption "Stops receiving video; audio keeps playing.", then `<Toggle label="Hide self-view" value={hideSelf} onChange={onHideSelf} />`; keep "New poll…" (Task 10) last. Raise `heightFraction` to `0.55`.
- [ ] **Step 3: Tile** — add `dataSaver: boolean`; `showVideo` becomes `!dataSaver && p.camera && p.video?.toURL`.
- [ ] **Step 4: Call screen** —
  - `const [hideSelf, setHideSelf] = useState(false);` and on mount `useEffect(() => { loadPrefs().then((p) => setHideSelf(p.hideSelf)).catch(() => {}); }, []);` (hooks above the early return).
  - `<SelfView stream={state.camera && !hideSelf ? state.localStream : null} … />`.
  - Each person `Tile`: `dataSaver={state.dataSaver}`.
  - `MoreSheet`: `dataSaver={state.dataSaver}`, `onDataSaver={(v) => { call()?.setDataSaver(v); savePrefs({ dataSaver: v }).catch(() => {}); }}`, `hideSelf={hideSelf}`, `onHideSelf={(v) => { setHideSelf(v); savePrefs({ hideSelf: v }).catch(() => {}); }}`.
- [ ] **Step 5: Type check, lint, tests** → PASS.
- [ ] **Step 6: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): Data saver and Hide self-view settings"
```

---

### Task 14: Manual checklist, version 1.2.0, spec update

**Files:**
- Modify: `mobile/MANUAL-TEST.md`, `mobile/android/app/build.gradle`, `mobile/ios/Coyote.xcodeproj/project.pbxproj`, `docs/superpowers/specs/2026-10-11-mobile-room-features-design.md`

- [ ] **Step 1: Checklist** — append a `## Room features (2b)` section to `mobile/MANUAL-TEST.md`, numbering on from the last item:

```markdown
## Room features (2b)

Server prerequisite: a deploy that serves `GET /api/soundboard`.

N. **Polls (voter).** A browser op creates a poll: a card appears in chat and the
   badge counts it; the Poll tab shows it. Vote, then change your vote: tallies and
   percentages update on both sides and your choice stays highlighted. Airplane mode
   5 s and back: your vote is still highlighted. The op closes it: "Closed", winner
   highlighted. The op creates a new poll: the old chat card reads "This poll was
   replaced."
N+1. **Polls (op).** Make the phone's user an op. ☰ → New poll… with 2–6 options
   (try 7 and an empty question: refused with a message). Close it from the card.
N+2. **Soundboard.** Chat sheet → 🔊: tap 🚀 — both the phone and the browser play it;
   the other buttons lock; the phone's button shows ⏹ and stops it. Let one finish on
   its own: the board unlocks for everyone. Start one from the browser: it plays on
   the phone and locks the board. Against a server without `/api/soundboard`, the 🔊
   tab is absent.
N+3. **Per-participant volume.** Long-press a tile: the slider goes 0–200%; 0% mutes
   that person, 200% is clearly louder; others are unaffected. Leave and rejoin the
   call: volumes reset to 100%. Airplane mode 5 s and back mid-call: volumes stay.
N+4. **Data saver.** ☰ → Data saver on: every tile shows avatars, audio continues,
   a screenshare's audio still plays. Leave and rejoin: still on. Off: video returns.
N+5. **Hide self-view.** ☰ → Hide self-view: your picture-in-picture disappears; the
   browser still sees your camera. Rejoin: still hidden.
N+6. **Recent rooms ×.** On Home, tap × on a Recent row: it disappears at once; quit
   and reopen the app: it's still gone; the other rooms remain.
```

- [ ] **Step 2: Version 1.2.0** —

```bash
cd mobile && sed -i 's/versionCode 4/versionCode 5/; s/versionName "1.1.0"/versionName "1.2.0"/' android/app/build.gradle
sed -i 's/CURRENT_PROJECT_VERSION = 4;/CURRENT_PROJECT_VERSION = 5;/; s/MARKETING_VERSION = 1.1.0;/MARKETING_VERSION = 1.2.0;/' ios/Coyote.xcodeproj/project.pbxproj
grep -n "versionCode\|versionName" android/app/build.gradle; grep -n "MARKETING_VERSION\|CURRENT_PROJECT_VERSION" ios/Coyote.xcodeproj/project.pbxproj
```

Expected: `versionCode 5`, `versionName "1.2.0"`, two `CURRENT_PROJECT_VERSION = 5;`, two `MARKETING_VERSION = 1.2.0;`.

- [ ] **Step 3: Spec** — in the spec:
  - "Scope and releases" 2b bullet: append ", and a × on each Recent room on the Home screen to remove it from history (added at the user's request)".
  - "Wiring": change "`CallState` gains only `name`…" to "`CallState` gains only `name` (your confirmed display name) and `dataSaver`; chat, poll and soundboard traffic stay out of it."
  - "Sound playback": add "Remote clips (`https://`) are downloaded once into the app cache, named from the URL path (which carries the server version), then prepared; the module emits `CoyoteSoundLoaded {id, ok}`. A failed load drops any previous player for that id."
  - "Settings (☰)": note that preferences merge on save.

- [ ] **Step 4: Full verification** — `cd mobile && npx jest && npm run -s typecheck && npx eslint src test`; `cd .. && go vet ./... && go test ./...` → PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/MANUAL-TEST.md mobile/android/app/build.gradle mobile/ios/Coyote.xcodeproj/project.pbxproj docs/superpowers/specs/2026-10-11-mobile-room-features-design.md
git commit -m "chore(mobile): 1.2.0 (build 5) with the Room features 2b manual checklist"
```
