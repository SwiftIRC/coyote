# Mobile apps — Op moderation (iOS & Android)

Sub-project 3 of 4. Builds on [Foundation](2026-10-08-mobile-foundation-design.md)
and [Room features](2026-10-11-mobile-room-features-design.md).

## Problem

An op on a phone can create and close polls, and nothing else. They cannot kick, ban,
mute, stop a screenshare, make someone op, lock the room or set the room's video
quality — all of which an op on the web can do. Everything already exists in the
protocol; being on the receiving end (kicked, banned, force-muted, quality caps,
moderation lines in chat) already works in the app.

Two existing gaps surfaced while mapping the web client, and are fixed here because
op moderation makes them easy to hit:

1. **Locking a room locks out its own members on reconnect.** `Room.Join` checks the
   password first (`internal/room/room.go:174`), and a reconnect re-sends the join
   with the password typed at pre-join. After an op locks the room mid-call, anyone
   whose connection blips — ops included — is refused with `bad-password`. The web
   shows a notice and retries forever; the app treats it as fatal and ends the call.
2. **A late joiner can't tell the room is locked.** `joined` carries no lock state, so
   a client joining an already-locked room shows it unlocked (and an op's button reads
   "Lock room").

## Scope

One release, **app 1.3.0** (iOS build 6, Android versionCode 6):

- Per person (ops only): **mute mic, make op, kick, ban.**
- Per screenshare (ops only): **stop share.**
- Room (ops only): **lock / unlock** with a password, **quality** (camera and screen
  tiers).
- Everyone: a **lock indicator** in the call's top bar.
- Server: members already admitted **survive a lock on reconnect**; `joined` carries
  **`locked`**. The web reads `joined.locked` too.
- App fallback for older servers: a `bad-password` on a rejoin returns to PreJoin with
  an explanation.

## Decisions

- **Web parity plus "make op".** The web has `+op` on every tile; without it a mobile
  op cannot hand op over before leaving. Forcing someone's camera off (which the server
  accepts but the web does not offer) is not added.
- **Confirms:** Kick, Ban (web wording) and **Make op** (granting op cannot be undone —
  there is no demote — and mis-taps are likelier in a phone sheet). Mute, stop share,
  unlock and quality changes are instant, as on the web; mute and stop share are
  nudges the target can undo.
- **Actions live in the existing long-press sheet,** not as buttons on tiles (phone
  tiles are too small) and not in a new participants screen. Every participant,
  camera off or not, has a tile to long-press.
- **The wire protocol gains one optional field** (`joined.locked`); everything else is
  existing frames: `kick`, `ban`, `mute-peer`, `grant-op`, `set-lock`, `set-quality`,
  `room-locked`, `room-unlocked`, `quality`, `role`.
- **State follows the server.** Lock and quality displays change only when the
  server's broadcast arrives, never on the tap — as on the web.
- **A `Moderation` store beside `Call`,** following the `Polls` pattern from 2b.
  Rejected: methods on `Call` with lock/quality in `CallState` (grows `call.ts`, and
  every lock change rebuilds the grid's state — the pattern 2b rejected), and sending
  frames straight from components (op checks and offline handling scattered and
  untested).

## Server change

### Admitted refs survive a lock

`Room` gains `admittedRefs map[string]struct{}`.

- A successful `Join` with a non-empty `p.Ref` adds the ref.
- In `Join`, the password check is skipped when `p.Ref != ""` and the ref is in
  `admittedRefs`. The identified-only and ban checks still run after it, unchanged.
- `Kick` and `Ban` delete the target's ref, so a kicked person cannot slip back past a
  lock with their old session. (While unlocked, a kicked person may rejoin, as today.)
- The set lives and dies with the `Room`, like `opRefs`. A `""` ref is never stored.
- It covers anyone admitted earlier in the room's life, including people who left on
  purpose; only `Kick`/`Ban` revoke it. Kicking a stale session (a ghost left behind by
  a reconnect) keeps the ref if another participant still holds it.

The ref is `sessionRef(join.Session)` — derived from the client's per-call session
nonce, stable across a reconnect, never the nonce itself. A fresh browser tab or a new
Join tap in the app is a new session and needs the password.

### `joined.locked`

`signal.Joined` gains `Locked bool \`json:"locked"\`` — deliberately **not**
`omitempty`, so a new server always sends it and the app can tell "unlocked" from
"older server, unknown". Filled from `r.locked` under the room lock in `Join`.

### Web

`app.js`'s `joined` handler calls `controls.onLock(!!msg.locked)`, so the lock status
and the op's Lock/Unlock button are right for a late joiner.

### Tests (Go)

- Locked mid-call: a rejoin with the same ref and the stale (empty) password is
  admitted.
- Locked: a new ref with no password is refused `bad-password`; with the password,
  admitted.
- Kicked, then locked: the kicked ref is refused `bad-password`. Same for banned (still
  refused, `bad-password` first while locked; `banned` when unlocked).
- `joined.locked` is true for a joiner of a locked room and `false` (present) when unlocked.

## App core (`mobile/src/core/`)

### `moderation.ts`

A plain class, no React Native imports, `subscribe()` / snapshot like `Polls`.

- **Snapshot:** `{ locked: boolean, quality: { camera: string, screen: string } }`.
- **Seeding,** on every `joined` (first join and rejoin):
  - `locked` from `joined.locked`. If the field is absent (older server): on the
    first join, the `locked` flag of PreJoin's last `GET /api/rooms/{slug}` peek,
    passed in the join request; on a rejoin, the value it already holds. The next
    `room-locked` / `room-unlocked` corrects it.
  - `quality` from `joined.quality` (empty → `"auto"`).
- **Listens:** `room-locked` → `locked = true`; `room-unlocked` → `locked = false`;
  `quality {camera, screen}` → `quality`.
- **Actions,** each returning `ModResult = "sent" | "offline" | "not-op" | "invalid"`:

  | Method | Frame | Validation |
  |---|---|---|
  | `muteMic(id)` | `mute-peer {id, kind:"mic"}` | op |
  | `stopShare(id)` | `mute-peer {id, kind:"screen"}` | op |
  | `grantOp(id)` | `grant-op {id}` | op |
  | `kick(id)` | `kick {id}` | op |
  | `ban(id)` | `ban {id}` | op |
  | `lock(password)` | `set-lock {password}` | op; trimmed password non-empty |
  | `unlock()` | `set-lock {}` | op |
  | `setQuality(target, tier)` | `set-quality {target, tier}` | op; target `camera`/`screen`; tier in the shared `quality.js` list |

  The op check is `isOp()` wired to `state.role === "op"` (as `Polls`). Checks run in
  order `not-op`, then `invalid`, then `offline`. Sending goes through `Call.trySend`,
  which returns false (→ `offline`) when the call is not live or the socket is not
  open.
- Nothing is updated optimistically.

### `Call` wiring

- Creates the store and exposes it as `call.moderation`.
- Seeds it on every `joined` before replayed frames are processed.
- Continues to apply quality caps to the peer itself (`onQuality`, join-time caps);
  the store only mirrors the value for display.
- **Fallback C:** in `onServerError`, a `bad-password` while awaiting a **rejoin**
  (a `joined` has been received before in this call) ends the call with
  `finish({kind:"rejected", code:"locked-while-away"})`. `Call.tsx` returns to PreJoin
  with *"The room was locked while you were reconnecting. Enter the password to
  rejoin."* A `bad-password` on the first join is unchanged ("Wrong password for this
  room.").

### Refusal text (`core/errors.ts`)

In-call `error` frames already become a notice (banner + chat) through the shared
`serverErrorDisposition`, which gives `no-such-peer` → "They already left the call."
The app overrides `not-op` to *"That needs op, and the server says you don't have it."*
It deliberately makes no promise that rejoining helps: a guest op's rejoin on mobile uses
a new session and would not regain op.

### Hook

`useModeration()` built on `useSyncExternalStore` against `call.moderation`, read
through `CallContext`, like `usePoll()`.

## UI

### Person sheet (long-press a tile)

`VolumeSheet` becomes `PersonSheet`. Non-ops see what they see today: the name and the
volume slider. Ops additionally see, below the slider:

- **Mute mic** — sent immediately. Disabled and labelled "Muted" while the person's
  mic is off; follows their `media-state` live.
- **Make op** — hidden if they are already op. Confirm: title *"Make <name> an op?"*,
  message *"They'll be able to kick, ban and mute anyone. This can't be undone."*,
  button **Make op**.
- **Kick** (red) — confirm: *"Kick <name>?"*, *"They'll be removed from the call."*,
  destructive button **Kick**.
- **Ban** (red) — confirm: *"Ban <name>?"*, *"They'll be removed and blocked from
  rejoining."*, destructive button **Ban**.

Confirms use `Alert.alert` with a `cancel` button and the action button (`destructive`
style for Kick and Ban). Kick and Ban close the sheet once sent. The sheet closes if
the person leaves while it is open. It grows to fit the action rows when shown to an
op, and gains them live if you are made op while it is open. A long-press on the
self-view opens nothing (unchanged).

### Screenshare viewer

Ops get a **Stop share** button in the viewer's toolbar, sent immediately. The viewer
already closes itself when the share ends. There is no long-press on the screen tile.

### ☰ More sheet (ops only, below "New poll…")

- **Lock room…** — expands in place (like the Name edit) to a password field (secure
  entry, trimmed, required) and a **Lock** button; Cancel or closing the sheet
  discards it. While the room is locked the row reads **Unlock room** and unlocks
  immediately. The row's label follows the server's broadcast, not the tap.
  (`Alert.prompt` is not used: it is iOS-only.)
- **Quality…** — a sub-view inside the sheet with two groups, **Camera** and
  **Screen**, each listing the tiers from the shared `quality.js` with their labels
  (Auto, Ultra 1080p·30, Fast 720p·60, High 720p·30, Medium 480p·24, Low 360p·15) and
  the current one checked. Tapping a tier sends `set-quality`; the check moves when the
  `quality` broadcast arrives. A back control returns to the main menu.

### Lock indicator (everyone)

The top bar reads `🔒 #room · 12:34` while the room is locked (with an accessibility
label "Room locked").

### Feedback

`offline` and `not-op` results show the same inline notice style as polls: *"Not
connected — try again."* and *"Only ops can do that."* `invalid` is prevented by the
UI (Lock is disabled until a password is entered) and is not shown.

## Lifecycle

- **Rejoin:** the store is re-seeded from `joined`; an open person sheet stays open if
  the person is still present (matched by participant id — a rejoin changes ids, so in
  practice it closes).
- **Background:** lock and quality broadcasts are still tracked.
- **Leave:** the store goes away with the `Call`; nothing is saved.

## Testing

**Automated** (Jest, `tsc`, ESLint; `go test ./...`):

- **Go:** the admitted-ref cases and `joined.locked` above.
- **`moderation`:** seeding from `joined.locked`; peek fallback when absent; lock /
  unlock / quality broadcasts; each action's exact frame; `not-op`, `invalid` and
  `offline` results; no state change on send.
- **`call`:** rejoin `bad-password` → `rejected` with `locked-while-away`; first-join
  `bad-password` unchanged; the store is seeded on every `joined`; the `not-op` override text.

**Manual** — new items in `mobile/MANUAL-TEST.md`, run on both platforms with a phone
as op and a browser as the target, then the reverse:

- Mute mic, make op (confirm), kick (confirm), ban (confirm; the browser can't rejoin).
- Stop a browser's screenshare from the viewer.
- Lock from the phone; the browser sees the lock; a third client is refused without
  the password and admitted with it; airplane mode on the phone for 10 s → it rejoins
  the locked room. Unlock.
- Join a locked room from a second device: the 🔒 shows immediately.
- Set camera quality to Low: the browser's camera visibly drops; back to Auto.
- Be the target: kicked/banned/muted by a browser op (already covered by Foundation
  items; re-run).

## Release

- **1.3.0** — iOS build 6, Android versionCode 6, bumped together per
  `mobile/RELEASE.md`.
- **Deploy the server first.** Against an older server everything works except
  lock-survives-reconnect (fallback C applies) and the late joiner's lock indicator
  (falls back to the PreJoin peek).
- No native (Swift/Kotlin) changes are expected.

## Out of scope

Unban and a ban list, demote / op transfer, op handoff when the op leaves,
server-enforced mutes, forcing someone's camera off, and screenshare sending /
background effects (sub-project 4).
