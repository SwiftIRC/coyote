# Mobile apps — Room features (iOS & Android)

Sub-project 2 of 4. Builds on
[Foundation](2026-10-08-mobile-foundation-design.md), which delivered a working call
app: links, pre-join, the audio/video grid, mute/camera/flip, audio routing,
background survival, reconnect and removal handling.

## Problem

The apps can hold a call but nothing else that happens in a Coyote room. People on
phones can't read or send chat, can't see a screenshare, don't hear anyone arrive or
leave, can't vote in polls or use the soundboard, and can't turn a loud participant
down or save mobile data. Everything here already exists in the web client and the
protocol; the job is to bring it to the apps with layouts that work on a phone.

## Scope and releases

All four feature groups are wanted. They ship in two releases from this one spec,
each with its own implementation plan:

- **2a (app 1.1.0):** chat with replay and tappable links, rename, screenshare
  viewing, call sounds (join, leave, screenshare chimes), room timer.
- **2b (app 1.2.0):** polls (everyone votes; ops create and close), soundboard,
  per-participant volume, settings menu (Name, Data saver, Hide self-view).

2b needs one server addition (`GET /api/soundboard`); 2a needs no server change.

## Decisions

- **The wire protocol is unchanged.** The apps speak the existing frames
  (`chat`, `rename`, `peer-renamed`, `moderation`, `poll`, `create-poll`, `vote`,
  `close-poll`, `sound`, `set-receive-video`, `joined.roomAge`, `joined.poll`,
  `tracks` with `screen` / `screen-audio` kinds) exactly as the browser does.
- **One small server addition:** `GET /api/soundboard`, because the board list is
  otherwise only injected into the web page's HTML. Rejected: bundling clips in the
  app (new clips would need an app release) and parsing the page (fragile).
- **Room state lives in small feature stores beside `Call`,** following the `Roster`
  pattern, not in `CallState` and not in a general state library. `Call` stays about
  joining and media; chat traffic never re-renders the video grid; each feature is
  tested on its own. Rejected: folding everything into `CallState` (doubles
  `call.ts`, every message rebuilds the grid's state) and Redux/Zustand (a second
  state model for no gain at this size).
- **Shared, not copied,** as in Foundation: the DOM-free web modules
  `linkify.js`, `duration.js`, `presence.js`, `poll.js` and `soundboard.js` are
  imported through `src/shared/web.ts`.
- **No new third-party native dependencies.** The chat sheet, pinch-zoom viewer and
  sliders use React Native's `Animated` / `PanResponder`. Sound playback is a small
  in-house native module (below) so it can never disturb the call's audio session.
  Rejected: `react-native-sound` (uncertain maintenance and New Architecture
  support, and it exposes `setCategory`, which must never run mid-call),
  `react-native-gesture-handler` / `reanimated` (heavy native additions for two
  gestures).
- **The app stays portrait-locked.** The screenshare viewer offers a rotate button
  instead of unlocking orientation, which would need a native orientation module.
- **Behaviour matches the web** wherever this spec doesn't say otherwise: limits,
  who may do what, what persists and what is per-call.

## Architecture

### Feature stores (`mobile/src/core/`)

Each is a plain class with no React Native imports and a `subscribe()` /
snapshot API, unit-tested with Jest against a fake signalling client.

| Module | Holds | Listens to | Sends |
|---|---|---|---|
| `chat.ts` (2a) | log of at most 500 entries (messages, moderation lines, local notices, poll cards), unread count, open flag | `chat`, `moderation`, in-call notices, `poll` open/close | `chat {text}` |
| `roomClock.ts` (2a) | room start time | `joined.roomAge` | — |
| `chimes.ts` (2a) | the shared `Presence` (by `ref`, 6 s delayed leave) plus screen-tile detection | roster changes | plays sounds via `CoyoteSounds` |
| `polls.ts` (2b) | the current poll snapshot and `yourVote` | `joined.poll`, `poll` | `create-poll`, `vote`, `close-poll` |
| `soundboard.ts` (2b) | board list, clip playing `{id, by}`, per-clip load state | `sound` | `sound {action, id}` |

Room-wide settings that touch the server (`set-receive-video`) and rename go through
`Call`, which already owns the session and the stored join request.

### Wiring

`Call` creates the stores, hands each the signalling client, and exposes them as
`call.chat`, `call.polls`, `call.soundboard`, `call.clock`. On every `joined` —
first join or rejoin — it resets or seeds them before the server's replay arrives:
chat is cleared (the server replays its last 200 messages as individual `chat`
frames right after `joined`), the poll is seeded from `joined.poll`, the clock
re-anchors to `joined.roomAge`, and `Presence` is re-seeded from `joined.peers`.
`CallState` gains no new fields.

### UI access

One hook per store — `useChat()`, `usePoll()`, `useSoundboard()`, `useRoomClock()` —
built on `useSyncExternalStore` against the store's `subscribe()`, so only the
components that read a store re-render when it changes. They read the store from
the active call through `CallContext`.

### Shared web modules

Added to `src/shared/web.ts`: `linkSegments` (linkify.js), `formatDuration`
(duration.js), `Presence` (presence.js), `totalVotes` and `tallyPercents`
(poll.js), `normalizeBoard` and `boardButtonState` (soundboard.js).
`soundboardFromPage` is not imported (it reads `window`). The `HH:MM` timestamp
helper lives inside the web's DOM-bound `ui/chat.js`, so the app has its own
one-line equivalent.

### Media

`Peer` already reports every remote track with its `kind`. `Roster` gains `screen`
and `screenAudio` slots next to `video` and `audio`; `Call` routes `screen` /
`screen-audio` tracks into them and clears them when the track goes. The grid
renders a screen tile for every participant whose `screen` slot (or only
`screenAudio`) is filled.

## Call screen UI (2a)

**Controls bar:** mic · camera · audio route · **chat** (unread badge, "99+" past
99) · **☰ more** · leave. **Flip camera** moves onto the self-view tile as a small
⟳ button; it is only useful while the camera is on, which is exactly when the
self-view shows.

**Top bar:** a slim overlay inside the safe area showing `#room · 12:34` — the room
timer counting up from `joined.roomAge` with the local clock, formatted by the
shared `formatDuration` (`m:ss` / `h:mm:ss`).

**Chat sheet**
- Toggled by the chat button; also closed by dragging its handle down or tapping
  the grid above it. Covers about 55% of the screen; the grid stays live above.
- Lines show `HH:MM Name: text`. Text is rendered as plain text split by the
  shared `linkSegments`; links are tappable and open in the system browser.
- Moderation lines and in-call notices render as muted system lines, worded as on
  the web.
- Auto-scrolls only if the user is already at the bottom.
- The input lifts above the keyboard (as in the pre-join fix), is limited to 2000
  characters and is trimmed; empty input is not sent. There is no local echo: a
  message appears when the server broadcasts it back, as on the web.
- Opening the sheet zeroes the unread count; while it is open nothing counts as
  unread. Unread increments for each `chat`, and for `poll` open and close (not
  updates).
- In 2b the sheet header gains **Chat · Poll** tabs and a 🔊 soundboard button.

**Screenshare tile and viewer**
- A grid tile labelled "Name (screen)" with 🖥, video shown with `contain`
  (uncropped). An audio-only share shows a "Sharing audio" placeholder.
- Tapping opens a full-screen viewer: pinch-zoom and pan (`PanResponder` on a
  transformed `RTCView`), a ⟲ rotate button that turns the view 90°, a volume
  slider when the share has audio (0–200%), and a close button. The viewer closes
  itself if the share ends.
- The `bloop` chime plays when a screen tile appears (as on the web), not on
  reconnect.

**☰ More sheet**
- 2a: **Name** — edit in place, 24 characters, trimmed; sends `rename` when
  changed. The displayed name updates when `peer-renamed` arrives for self; the
  name is then saved as the default join name and used by the next rejoin
  (already handled for the join request in `Call.onRenamed`).
- 2b adds **Data saver**, **Hide self-view**, and, for ops, **New poll…**.

## Room features UI (2b)

**Polls**
- Shown as a card in the chat log (re-rendered in place on `update`) and in the
  sheet's **Poll** tab.
- Each option shows a bar, its count and a percentage from the shared
  `tallyPercents` (largest remainder, sums to 100). Tapping an option votes;
  tapping another changes the vote. The app remembers its own vote locally (the
  server never echoes it) and takes `yourVote` from `joined.poll` after a rejoin.
- A closed poll shows "Closed" with the winning option highlighted, and stays until
  replaced.
- **Ops** (`role === "op"`) get **New poll…** in ☰: a form with a question (≤200
  characters) and 2–6 options (≤80 characters each) with add/remove rows. If a poll
  is open the form warns that creating one replaces it. Ops also see **Close poll**
  on the card.
- The server refuses invalid or non-op poll actions silently, so the app enforces
  the same limits and role check before sending.

**Soundboard**
- The 🔊 button in the chat sheet header opens an emoji grid built from
  `GET /api/soundboard` (fetched once per call, normalised with the shared
  `normalizeBoard`). Each clip is downloaded on first use and cached in the app's
  cache directory, keyed by its versioned `src` URL.
- Tapping a clip sends `sound start`. Everyone — including the starter — plays it
  when the server broadcasts `start`; the board then locks (`boardButtonState`)
  except for the starter's stop button. When the clip ends naturally the starter
  sends `stop`, as on the web.
- If the endpoint is unavailable (an older server) the 🔊 button is hidden. A clip
  whose download fails is disabled; the rest of the board works.

**Per-participant volume**
- Long-press a tile for a sheet with the person's name and a slider from 0 to 200%
  in 5% steps with a live "NNN%" readout, applied to their mic track with
  `MediaStreamTrack._setVolume` (libwebrtc per-track gain, native on both
  platforms). Screenshare audio has its own slider in the viewer.
- Volumes last for the call only (not saved), as on the web, and are re-applied to
  the new tracks after a rejoin.

**Settings (☰)**
- **Data saver:** sends `set-receive-video {enabled: false}` (and `true` when turned
  off). Saved in preferences and re-sent after every `joined`. While on, tiles show
  avatars, as they would with cameras off; screenshare audio keeps playing.
- **Hide self-view:** saved; hides the self-view tile. The camera keeps sending.

## Server change

`GET /api/soundboard` in `internal/server/server.go`, next to the other `/api/*`
routes. It returns `soundboardJSON(embeddedSoundboard)` — the same
`[{id, label, src}]` list the page receives — with `Content-Type:
application/json` and a short `Cache-Control`. `/api/*` is already excluded from
the app-link paths in the `.well-known` files, so the endpoint never opens the app.
Covered by a Go handler test.

## Sound playback: `CoyoteSounds`

A small in-house native module:
- **iOS:** Swift, `AVAudioPlayer`. **Android:** Kotlin, `SoundPool` for the short
  chimes and `MediaPlayer` for board clips.
- **JS API:** `preload(id, uri)`, `play(id)`, `stop(id)`, and an `ended(id)` event
  (so the soundboard knows when to send `stop`).
- **It never sets the audio category or mode and never activates the audio
  session.** Sounds play inside the call's existing session and follow the current
  route (earpiece, speaker or Bluetooth).
- The three chimes (`door_open`, `sounds_drop`, `sounds_bloop`) are bundled: in the
  iOS target's resources and in Android `res/raw` (lowercase names). They are
  copies of `internal/web/assets/*.mp3`; a Jest test asserts byte equality so they
  cannot drift.

## Errors

- **Sending while signalling is down:** frames sent during a reconnect are dropped
  by `Signaling`, so the chat input checks the connection first and shows "Not
  connected — message not sent", keeping the text. Votes and rename are refused the
  same way with a notice.
- **Silent server refusals** (empty or over-long chat, invalid names, non-op poll
  actions, unknown sounds) are prevented by validating the same limits in the app.
- **Soundboard:** endpoint failure hides the board; a failed clip download disables
  that clip.
- **Playback failures** are logged and otherwise ignored; a missing chime never
  affects the call.

## Lifecycle

- **Rejoin** (a `joined` after reconnect): chat cleared and replayed by the server,
  poll re-seeded from `joined.poll`, clock re-anchored, data saver re-sent,
  per-participant volumes re-applied, `Presence` re-seeded so nobody chimes.
- **Background:** chat and polls keep updating and the unread badge counts; chimes
  and soundboard clips still play, as they would in a phone call.
- **Leaving** a call disposes every store; nothing carries into the next call
  except saved preferences (name, data saver, hide self-view).

## Testing

**Automated** (run on every change: Jest, `tsc`, ESLint; `go test` for the server):
- **chat:** replay order, the 500-entry cap, unread rules (open sheet, poll
  open/close vs update), clear on rejoin, the not-connected path, link segmentation.
- **polls:** seed from `joined.poll` including `yourVote`, open/update/close,
  local vote memory, op-only actions, client-side limits.
- **soundboard:** start/stop locking, starter-only stop, `ended` → `stop`, endpoint
  failure hides the board.
- **roomClock:** anchoring to `roomAge` with injected time.
- **chimes:** seeding from `joined.peers` is silent, reconnect doesn't chime, the
  6 s delayed leave, the screen-tile bloop.
- **Call wiring:** stores reset/seeded on each `joined`; data saver re-sent;
  screen tracks routed into `Roster`'s `screen` / `screenAudio` slots and cleared
  when they go.
- **Shared imports:** the new `src/shared/web.ts` exports resolve under Jest.
- **Native contract:** `CoyoteSounds` method names exported by the Swift and Kotlin
  sources (in the style of `test/nativeModules.test.ts`); bundled chimes
  byte-identical to the web's.
- **Server:** `GET /api/soundboard` returns the embedded board as JSON.

**Manual:** `mobile/MANUAL-TEST.md` gains a Room features section, run on both
platforms before each release, including a solo two-device check (phone plus a
browser with headphones) covering chat, links, rename, a screenshare with audio,
chimes, polls, the soundboard, volume and data saver.

## Releases

- **2a → 1.1.0.** No server deploy needed.
- **2b → 1.2.0,** after a server with `GET /api/soundboard` is deployed. Against an
  older server the soundboard is simply hidden, so the order is safe either way.
- Both platforms are bumped together, per `mobile/RELEASE.md`.

## Out of scope (Room features)

Op moderation other than polls (kick, ban, force-mute, stop-share, lock, quality —
sub-project 3); sending screenshares and background effects (sub-project 4); a
call-sounds toggle; saving per-participant volumes; landscape orientation; deafen;
noise-suppression and grid-columns settings; push notifications.
