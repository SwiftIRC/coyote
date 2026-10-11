# Mobile Background Effects (4b, 1.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a phone blur its background or replace it with one of the server's scenes, chosen in PreJoin or ☰ → Background…, processed natively on the camera frames.

**Architecture:** A pure-TS `Backgrounds` store (`core/backgrounds.ts`) holds the catalogue (None/Blur/Blur+ plus scenes from a new `GET /api/scenes`), the user's choice and what is applied to the current camera track; it talks to native code through a three-method `EffectPort`. `Call` owns one store and hands it every new camera track; PreJoin owns another for its preview. Natively, one processor named `coyote-background` is registered with react-native-webrtc's `ProcessorProvider` on each platform: iOS segments with Vision and composites with Core Image; Android segments with ML Kit and composites on the CPU at 640×360. Both output an upright frame (rotation 0), pass frames through when idle or tripped, and trip a circuit breaker when too slow.

**Tech Stack:** Go (server), React Native 0.87 + TypeScript (`mobile/`), Jest, react-native-webrtc 124 (existing), Swift + ObjC (Vision, Core Image), Kotlin (ML Kit Selfie Segmentation).

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-heavy-sending-design.md` (sections "Decisions" and "4b — Background effects").

## Global Constraints

- Commit messages: **no `Co-Authored-By` trailer.** Conventional style as in `git log` (`feat(server): …`, `feat(mobile): …`, `chore(mobile): …`).
- Do not push, do not merge. Work on branch `feat/mobile-backgrounds`.
- Only new third-party dependency: Android `com.google.mlkit:segmentation-selfie:16.0.0-beta6`. Nothing new on npm, CocoaPods or Go.
- Layering: `mobile/src/core/` imports nothing from React Native or react-native-webrtc.
- Verification — Go: `go test ./...` (repo root). Mobile (in `mobile/`): `npx jest`, `npm run typecheck`, `npm run lint`. All must pass at the end of every task (2 lint warnings in `test/shared.test.ts` pre-exist). Swift/ObjC/Kotlin cannot be compiled here — the user builds on the Mac; write native code exactly as given.
- Identifiers (verbatim): processor name `coyote-background`; native module `CoyoteBackground`; event `CoyoteBackgroundTripped` with body `{ reason: "slow" | "failed" }`; effect ids `none`, `blur`, `blur-strong`; pref key `background` (default `"none"`).
- Effect strengths (fractions of the frame's short side, as the web): Blur `0.012`, Blur+ `0.03`.
- Breaker: budget **45 ms** rolling average, tripping after **3 s** over budget, ignoring the first **2 s** after an effect is set; segmentation at most **15 per second**, reusing the last mask between.
- Android output while an effect is on: **640×360** (360×640 upright portrait), rotation 0.
- Copy (verbatim):
  - Sheet title row labels: `None`, `Blur`, `Blur+`; offline line `Scenes unavailable offline.`
  - PreJoin row label `Background`; ☰ row `Background…`.
  - Notices: `Background effect turned off: this phone couldn't keep up.` (slow), `Background effect turned off: this phone couldn't start it.` (failed), `Couldn't load that background.` (scene load failed).
- Version 1.5.0: iOS `MARKETING_VERSION = 1.5.0`, `CURRENT_PROJECT_VERSION = 8` (all four configurations: Coyote + CoyoteBroadcast, Debug + Release); Android `versionName "1.5.0"`, `versionCode 8`.

## Review Focus

1. **Two choices in quick succession** (a slow scene download, then Blur) — the last choice must win, in JS state and in the native processor (Task 2 test "the last choice wins over a slower earlier one"; native "latest wins" token in Tasks 5 and 6).
2. **Camera flip / off→on / backgrounding** — the effect must follow onto the new camera track (Task 3 tests).
3. **Older server (no `/api/scenes`) or offline** — built-ins still work; a saved scene choice silently falls back to None for this call and is kept (Task 2 tests).
4. **The breaker trips** — None plus the notice, the saved choice kept, and choosing again re-arms (Task 2 test).
5. **A scene download fails** — None plus "Couldn't load that background.", no stuck spinner (Task 2 test).

---

### Task 1: Server — `GET /api/scenes`

**Files:**
- Modify: `internal/server/scenes.go` (add a handler), `internal/server/server.go:101` (route)
- Test: `internal/server/scenes_api_test.go` (new)

**Interfaces:**
- Produces: `GET /api/scenes` → `200`, `Content-Type: application/json`, `Cache-Control: public, max-age=300`, body `[{ "id", "label", "src" }]` — exactly `buildScenes(web.Assets, assetsVersion)`, the list the web shell embeds. `src` is an absolute, version-stamped path (e.g. `/v/<ver>/img/bg/carina.webp`).

- [ ] **Step 1: Write the failing test** — create `internal/server/scenes_api_test.go`:

```go
package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/SwiftIRC/coyote/internal/web"
)

// The apps can't read the scenes out of the web page, so they are served as JSON —
// the exact list the page is built with.
func TestScenesAPIServesTheEmbeddedScenes(t *testing.T) {
	_, srv := newTestHub(t, "", true)
	resp, err := http.Get(srv.URL + "/api/scenes")
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
	var got []scene
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	want := buildScenes(web.Assets, assetsVersion)
	if len(got) != len(want) {
		t.Fatalf("got %d scenes, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("scene %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run (repo root): `go test ./internal/server/ -run TestScenesAPI -v`
Expected: FAIL — status 404 (or the SPA shell's 200 with HTML → JSON decode error).

- [ ] **Step 3: Implement** — append to `internal/server/scenes.go`:

```go
// handleScenes serves the scene list as JSON for the mobile apps, which can't read
// it out of the page shell. Same list, same order, as the page's injection.
func (h *Hub) handleScenes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(embeddedScenesJSON())
}
```

(add `"net/http"` to the file's imports). In `internal/server/server.go`, after the `GET /api/soundboard` route:

```go
	mux.HandleFunc("GET /api/scenes", h.handleScenes)
```

- [ ] **Step 4: Run tests**

Run: `go test ./...` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/scenes.go internal/server/server.go internal/server/scenes_api_test.go
git commit -m "feat(server): GET /api/scenes for the mobile apps"
```

---

### Task 2: `Backgrounds` store, `fetchScenes`, `background` pref

**Files:**
- Create: `mobile/src/core/backgrounds.ts`
- Modify: `mobile/src/core/api.ts`, `mobile/src/core/prefs.ts`
- Test: `mobile/test/backgrounds.test.ts` (new), `mobile/test/api.test.ts`, `mobile/test/prefs.test.ts`

**Interfaces:**
- Consumes: `TrackLike`, `Logger` from `core/types.ts`.
- Produces (used by Tasks 3, 4, 7):
  - `type NativeEffect = { kind: "blur"; radius: number } | { kind: "scene"; url: string }`
  - `type TripReason = "slow" | "failed"`
  - `interface Scene { id: string; label: string; url: string }`
  - `type ScenesState = "idle" | "loading" | "ready" | "unavailable"`
  - `interface BgSnapshot { selected: string; applied: string; busy: boolean; scenes: Scene[]; scenesState: ScenesState }`
  - `interface EffectPort { setEffect(e: NativeEffect): Promise<void>; attach(track: TrackLike): void; detach(track: TrackLike): void }`
  - `const BUILTIN_EFFECTS: ReadonlyArray<{ id: string; label: string; radius?: number }>`
  - `const BG_TEXT = { slow, failed, load }`
  - `function parseScenes(list: unknown, origin: string): Scene[]`
  - `function labelFor(id: string, scenes: Scene[]): string`
  - `class Backgrounds { constructor(port: EffectPort, loadSceneList: () => Promise<Scene[] | null>, notice: (text: string) => void, log: Logger); select(id: string): Promise<void>; setTrack(track: TrackLike | null): Promise<void>; loadScenes(): Promise<void>; resetScenes(): void; onTripped(reason: TripReason): void; subscribe(fn): () => void; getSnapshot(): BgSnapshot }`
  - `fetchScenes(f: Fetcher, origin: string): Promise<unknown[] | null>` in `core/api.ts`
  - `Prefs.background: string` (default `"none"`)

Semantics: `selected` is the user's choice (saved as the pref by callers); `applied` is what the current camera track actually shows (`"none"` when there is no track, the choice is unknown, loading failed, or the breaker tripped). Every `apply` bumps a generation; a result from an older generation is ignored.

- [ ] **Step 1: Write the failing tests** — create `mobile/test/backgrounds.test.ts`:

```ts
import { Backgrounds, BG_TEXT, labelFor, parseScenes, type EffectPort, type NativeEffect, type Scene } from "../src/core/backgrounds";
import type { TrackLike } from "../src/core/types";
import { FakeTrack, flush, silentLog } from "./fakes";

const SCENES: Scene[] = [{ id: "carina", label: "Carina", url: "https://h/v/1/img/bg/carina.webp" }];

function setup(opts: { scenes?: Scene[] | null; failScene?: boolean; defer?: boolean } = {}) {
  const calls: string[] = [];
  const notices: string[] = [];
  const pending: Array<{ effect: NativeEffect; resolve(): void; reject(e: unknown): void }> = [];
  let sceneFetches = 0;
  const port: EffectPort = {
    setEffect: (e) => {
      calls.push(`set ${e.kind === "blur" ? `blur ${e.radius}` : `scene ${e.url}`}`);
      if (opts.defer) return new Promise<void>((resolve, reject) => pending.push({ effect: e, resolve, reject }));
      if (e.kind === "scene" && opts.failScene) return Promise.reject(new Error("download failed"));
      return Promise.resolve();
    },
    attach: (t: TrackLike) => calls.push(`attach ${t.id}`),
    detach: (t: TrackLike) => calls.push(`detach ${t.id}`),
  };
  const bg = new Backgrounds(port, async () => {
    sceneFetches++;
    return opts.scenes === undefined ? SCENES : opts.scenes;
  }, (t) => notices.push(t), silentLog);
  return { bg, calls, notices, pending, fetches: () => sceneFetches };
}

test("parseScenes keeps well-formed entries and makes src absolute", () => {
  const list = [
    { id: "carina", label: "Carina", src: "/v/1/img/bg/carina.webp" },
    { id: "full", label: "", src: "https://cdn/x.webp" },
    { id: "", label: "x", src: "/a.webp" },
    { id: "nosrc", label: "x" },
    { id: "blur", label: "clash", src: "/b.webp" },
    { id: "rel", label: "r", src: "img/r.webp" },
    "junk",
  ];
  expect(parseScenes(list, "https://h")).toEqual([
    { id: "carina", label: "Carina", url: "https://h/v/1/img/bg/carina.webp" },
    { id: "full", label: "full", url: "https://cdn/x.webp" },
  ]);
  expect(parseScenes(null, "https://h")).toEqual([]);
});

test("labelFor: built-ins, scenes, and the bare id otherwise", () => {
  expect(labelFor("blur-strong", [])).toBe("Blur+");
  expect(labelFor("carina", SCENES)).toBe("Carina");
  expect(labelFor("pillars", SCENES)).toBe("pillars");
});

test("without a track a choice is remembered but nothing is applied", async () => {
  const { bg, calls } = setup();
  await bg.select("blur");
  expect(calls).toEqual([]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "none", busy: false });
});

test("a track gets the chosen blur: configure, then attach", async () => {
  const { bg, calls } = setup();
  await bg.select("blur");
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  expect(calls).toEqual(["set blur 0.012", `attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "blur", busy: false });
});

test("None detaches without configuring", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  expect(calls).toEqual([`detach ${t.id}`]);
  expect(bg.getSnapshot().applied).toBe("none");
});

test("a scene is resolved from the server's list", async () => {
  const { bg, calls } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(calls.slice(-2)).toEqual([`set scene ${SCENES[0].url}`, `attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "carina", scenesState: "ready", scenes: SCENES });
});

test("an unknown scene id falls back to None silently and stays selected", async () => {
  const { bg, calls, notices } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("gone");
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
  expect(bg.getSnapshot()).toMatchObject({ selected: "gone", applied: "none" });
  expect(notices).toEqual([]);
});

test("no scene list (older server or offline): built-ins still work, a scene choice is None", async () => {
  const { bg, calls } = setup({ scenes: null });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(bg.getSnapshot()).toMatchObject({ applied: "none", scenesState: "unavailable", selected: "carina" });
  await bg.select("blur");
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${t.id}`]);
});

test("an unavailable scene list is fetched again next time", async () => {
  const { bg, fetches } = setup({ scenes: null });
  await bg.loadScenes();
  await bg.loadScenes();
  expect(fetches()).toBe(2);
});

test("a ready scene list is fetched once; concurrent loads share one fetch", async () => {
  const { bg, fetches } = setup();
  await Promise.all([bg.loadScenes(), bg.loadScenes()]);
  await bg.loadScenes();
  expect(fetches()).toBe(1);
});

test("resetScenes forgets the list (a different server)", async () => {
  const { bg, fetches } = setup();
  await bg.loadScenes();
  bg.resetScenes();
  expect(bg.getSnapshot()).toMatchObject({ scenes: [], scenesState: "idle" });
  await bg.loadScenes();
  expect(fetches()).toBe(2);
});

test("a scene that fails to load: None, the load notice, not busy", async () => {
  const { bg, calls, notices } = setup({ failScene: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("carina");
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
  expect(notices).toEqual([BG_TEXT.load]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "carina", applied: "none", busy: false });
});

test("busy while the native effect is being configured", async () => {
  const { bg, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const p = bg.select("blur");
  await flush();
  expect(bg.getSnapshot().busy).toBe(true);
  pending[0].resolve();
  await p;
  expect(bg.getSnapshot()).toMatchObject({ busy: false, applied: "blur" });
});

test("the last choice wins over a slower earlier one", async () => {
  const { bg, calls, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const first = bg.select("carina");
  await flush();
  const second = bg.select("blur");
  await flush();
  pending[1].resolve();
  await second;
  pending[0].resolve();
  await first;
  expect(calls.filter((c) => c.startsWith("attach"))).toEqual([`attach ${t.id}`]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "blur", busy: false });
});

test("a new track gets the current effect; no track means None", async () => {
  const { bg, calls } = setup();
  await bg.select("blur-strong");
  const a = new FakeTrack("video");
  await bg.setTrack(a);
  const b = new FakeTrack("video");
  await bg.setTrack(b);
  expect(calls).toEqual(["set blur 0.03", `attach ${a.id}`, "set blur 0.03", `attach ${b.id}`]);
  await bg.setTrack(null);
  expect(bg.getSnapshot().applied).toBe("none");
  await bg.setTrack(null);
  expect(calls.length).toBe(4);
});

test("tripping: detach, None, the notice, choice kept; choosing again re-applies", async () => {
  const { bg, calls, notices } = setup();
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  await bg.select("blur");
  bg.onTripped("slow");
  expect(calls.at(-1)).toBe(`detach ${t.id}`);
  expect(notices).toEqual([BG_TEXT.slow]);
  expect(bg.getSnapshot()).toMatchObject({ selected: "blur", applied: "none" });
  bg.onTripped("failed"); // already off: nothing more
  expect(notices).toEqual([BG_TEXT.slow]);
  await bg.select("blur");
  expect(calls.slice(-2)).toEqual(["set blur 0.012", `attach ${t.id}`]);
});

test("a trip while configuring cancels that apply", async () => {
  const { bg, calls, notices, pending } = setup({ defer: true });
  const t = new FakeTrack("video");
  await bg.setTrack(t);
  const p = bg.select("blur");
  await flush();
  bg.onTripped("failed");
  pending[0].resolve();
  await p;
  expect(calls.filter((c) => c.startsWith("attach"))).toEqual([]);
  expect(notices).toEqual([BG_TEXT.failed]);
  expect(bg.getSnapshot()).toMatchObject({ applied: "none", busy: false });
});
```

Append to `mobile/test/api.test.ts` (and add `fetchScenes` to its import):

```ts
test("fetchScenes: the list, or null when unreachable or malformed", async () => {
  const ok = fetcher({ "https://h/api/scenes": { status: 200, body: [{ id: "a", label: "A", src: "/a.webp" }] } });
  expect(await fetchScenes(ok, "https://h")).toEqual([{ id: "a", label: "A", src: "/a.webp" }]);
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": { status: 404 } }), "https://h")).toBeNull();
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": { status: 200, body: { no: 1 } } }), "https://h")).toBeNull();
  expect(await fetchScenes(fetcher({ "https://h/api/scenes": "throw" }), "https://h")).toBeNull();
});
```

In `mobile/test/prefs.test.ts`, update the expected object in "a patch keeps every field it doesn't mention" to include `background: "none"`, and append:

```ts
test("the background choice persists and defaults to none", () => {
  expect(DEFAULT_PREFS.background).toBe("none");
  expect(mergePrefs({ background: "carina" }, {}).background).toBe("carina");
  expect(mergePrefs({ background: 7 }, {}).background).toBe("none");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/backgrounds.test.ts test/api.test.ts test/prefs.test.ts`
Expected: FAIL — missing module / `fetchScenes` / `background`.

- [ ] **Step 3: Implement**

`mobile/src/core/prefs.ts`: add `background: string; // background effect id ("none", "blur", "blur-strong" or a scene id)` to `Prefs` and `background: "none"` to `DEFAULT_PREFS`.

`mobile/src/core/api.ts`, append:

```ts
// GET /api/scenes -> [{id, label, src}]; null when unreachable or malformed.
export async function fetchScenes(f: Fetcher, origin: string): Promise<unknown[] | null> {
  try {
    const res = await f(`${origin}/api/scenes`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}
```

Create `mobile/src/core/backgrounds.ts`:

```ts
// Background effects for the local camera: the catalogue (built-ins plus the
// server's scenes), the user's choice, and what the current camera track actually
// shows. The native processor is configured through EffectPort; nothing goes over
// signaling. Snapshots are replaced on change for useSyncExternalStore.
import type { Logger, TrackLike } from "./types";

export type NativeEffect = { kind: "blur"; radius: number } | { kind: "scene"; url: string };
export type TripReason = "slow" | "failed";
export interface Scene {
  id: string;
  label: string;
  url: string;
}
export type ScenesState = "idle" | "loading" | "ready" | "unavailable";
export interface BgSnapshot {
  selected: string;
  applied: string;
  busy: boolean;
  scenes: Scene[];
  scenesState: ScenesState;
}

export interface EffectPort {
  setEffect(e: NativeEffect): Promise<void>; // configures the shared native processor
  attach(track: TrackLike): void;
  detach(track: TrackLike): void;
}

// Strengths are fractions of the frame's short side, as on the web.
export const BUILTIN_EFFECTS: ReadonlyArray<{ id: string; label: string; radius?: number }> = [
  { id: "none", label: "None" },
  { id: "blur", label: "Blur", radius: 0.012 },
  { id: "blur-strong", label: "Blur+", radius: 0.03 },
];

export const BG_TEXT = {
  slow: "Background effect turned off: this phone couldn't keep up.",
  failed: "Background effect turned off: this phone couldn't start it.",
  load: "Couldn't load that background.",
};

const builtin = (id: string) => BUILTIN_EFFECTS.find((b) => b.id === id);

export function parseScenes(list: unknown, origin: string): Scene[] {
  if (!Array.isArray(list)) return [];
  const out: Scene[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, label, src } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || builtin(id) || typeof src !== "string") continue;
    const url = /^https?:\/\//.test(src) ? src : src.startsWith("/") ? `${origin}${src}` : "";
    if (!url) continue;
    out.push({ id, label: typeof label === "string" && label ? label : id, url });
  }
  return out;
}

export function labelFor(id: string, scenes: Scene[]): string {
  return builtin(id)?.label ?? scenes.find((s) => s.id === id)?.label ?? id;
}

export class Backgrounds {
  private snap: BgSnapshot = { selected: "none", applied: "none", busy: false, scenes: [], scenesState: "idle" };
  private track: TrackLike | null = null;
  // Bumped by every apply and by a trip; an older apply's result is ignored.
  private gen = 0;
  private sceneGen = 0;
  private scenesLoad: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private port: EffectPort,
    private loadSceneList: () => Promise<Scene[] | null>,
    private notice: (text: string) => void,
    private log: Logger,
  ) {}

  select(id: string): Promise<void> {
    this.set({ selected: id || "none" });
    return this.apply();
  }

  setTrack(track: TrackLike | null): Promise<void> {
    if (track === this.track) return Promise.resolve();
    this.track = track;
    return this.apply();
  }

  loadScenes(): Promise<void> {
    if (this.snap.scenesState === "ready") return Promise.resolve();
    if (this.scenesLoad) return this.scenesLoad;
    const gen = ++this.sceneGen;
    this.set({ scenesState: "loading" });
    const load = this.loadSceneList()
      .then(
        (list) => {
          if (gen === this.sceneGen) this.set(list ? { scenes: list, scenesState: "ready" } : { scenesState: "unavailable" });
        },
        (e) => {
          this.log.warn("[background] scene list failed", e);
          if (gen === this.sceneGen) this.set({ scenesState: "unavailable" });
        },
      )
      .finally(() => {
        if (gen === this.sceneGen) this.scenesLoad = null;
      });
    this.scenesLoad = load;
    return load;
  }

  // A different server: its scenes are not this one's.
  resetScenes(): void {
    this.sceneGen++;
    this.scenesLoad = null;
    this.set({ scenes: [], scenesState: "idle" });
  }

  onTripped(reason: TripReason): void {
    if (this.snap.applied === "none" && !this.snap.busy) return;
    this.gen++;
    if (this.track) this.port.detach(this.track);
    this.set({ applied: "none", busy: false });
    this.notice(reason === "slow" ? BG_TEXT.slow : BG_TEXT.failed);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): BgSnapshot => this.snap;

  private async apply(): Promise<void> {
    const gen = ++this.gen;
    const track = this.track;
    const id = this.snap.selected;
    if (!track) {
      this.set({ applied: "none", busy: false });
      return;
    }
    const effect = await this.effectFor(id);
    if (gen !== this.gen) return;
    if (!effect) {
      this.port.detach(track);
      this.set({ applied: "none", busy: false });
      return;
    }
    this.set({ busy: true });
    try {
      await this.port.setEffect(effect);
    } catch (e) {
      if (gen !== this.gen) return;
      this.log.warn("[background] effect failed", e);
      this.port.detach(track);
      this.set({ applied: "none", busy: false });
      this.notice(BG_TEXT.load);
      return;
    }
    if (gen !== this.gen) return;
    this.port.attach(track);
    this.set({ applied: id, busy: false });
  }

  private async effectFor(id: string): Promise<NativeEffect | null> {
    const b = builtin(id);
    if (b) return b.radius === undefined ? null : { kind: "blur", radius: b.radius };
    await this.loadScenes();
    const scene = this.snap.scenes.find((s) => s.id === id);
    return scene ? { kind: "scene", url: scene.url } : null;
  }

  private set(patch: Partial<BgSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest test/backgrounds.test.ts test/api.test.ts test/prefs.test.ts` — Expected: PASS. Then `npx jest && npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/backgrounds.ts mobile/src/core/api.ts mobile/src/core/prefs.ts mobile/test/backgrounds.test.ts mobile/test/api.test.ts mobile/test/prefs.test.ts
git commit -m "feat(mobile): Backgrounds store, scene list from the server, background pref"
```

---

### Task 3: Wire `Backgrounds` into `Call`

**Files:**
- Modify: `mobile/src/core/call.ts` (imports; `CallDeps`; `JoinRequest`; fields; constructor; `join`; `refreshLocalStream` ~line 544; `releaseTracks` ~line 548)
- Modify: `mobile/src/native/callFactory.ts` (temporary deps, replaced in Task 4)
- Test: `mobile/test/call.test.ts`

**Interfaces:**
- Consumes (Task 2): `Backgrounds`, `EffectPort`, `parseScenes`.
- Produces: `Call.background: Backgrounds` (readonly); `CallDeps.effects: EffectPort`; `CallDeps.fetchScenes(origin: string): Promise<unknown[] | null>`; `JoinRequest.background?: string`.

The camera track changes in exactly two helpers — `refreshLocalStream()` (join, camera on/off, flip, background restore) and `releaseTracks()` (end, aborted join) — so both hand the current track to the store.

- [ ] **Step 1: Write the failing tests** — in `mobile/test/call.test.ts`:

1. In `setup()`, add `const effects: string[] = [];` beside `screens`, and these deps after `screen: { … },`:

```ts
    effects: {
      setEffect: async (e) => {
        effects.push(`set ${e.kind}`);
      },
      attach: (t) => effects.push(`attach ${t.id}`),
      detach: (t) => effects.push(`detach ${t.id}`),
    },
    fetchScenes: async () => [{ id: "carina", label: "Carina", src: "/v/1/img/bg/carina.webp" }],
```

and add `effects` to the returned object.

2. Append:

```ts
test("background: the join's choice is applied to the camera track", async () => {
  const { effects, cams } = await inCall({ background: "blur" });
  expect(effects).toEqual(["set blur", `attach ${cams[0].id}`]);
});

test("background: none by default — the track is detached, nothing configured", async () => {
  const { effects, cams } = await inCall();
  expect(effects).toEqual([`detach ${cams[0].id}`]);
});

test("background: follows the camera through flip and off/on", async () => {
  const { call, effects, cams } = await inCall({ background: "blur" });
  await call.flipCamera();
  await flush();
  expect(effects.at(-1)).toBe(`attach ${cams[1].id}`);
  await call.setCamera(false);
  await flush();
  expect(call.background.getSnapshot().applied).toBe("none");
  await call.setCamera(true);
  await flush();
  expect(effects.at(-1)).toBe(`attach ${cams[2].id}`);
});

test("background: a scene comes from the room's server", async () => {
  const { call, effects, cams } = await inCall();
  await call.background.select("carina");
  expect(effects.slice(-2)).toEqual(["set scene", `attach ${cams[0].id}`]);
});

test("background: leaving drops the track", async () => {
  const { call } = await inCall({ background: "blur" });
  call.leave();
  await flush();
  expect(call.background.getSnapshot().applied).toBe("none");
});

test("background: a trip shows its notice", async () => {
  const { call, notices } = await inCall({ background: "blur" });
  call.background.onTripped("slow");
  expect(notices).toContain("Background effect turned off: this phone couldn't keep up.");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest test/call.test.ts` — Expected: FAIL (typecheck errors on the new deps / `background`).

- [ ] **Step 3: Implement** in `mobile/src/core/call.ts`:

- Import: `import { Backgrounds, parseScenes, type EffectPort } from "./backgrounds";`
- `CallDeps`, after `screen: ScreenCapturePort;`:

```ts
  effects: EffectPort;
  fetchScenes(origin: string): Promise<unknown[] | null>;
```

- `JoinRequest`, after `dataSaver: boolean;`: `background?: string; // effect id; "none" when absent`
- Field after `readonly screenShare: ScreenShare;`: `readonly background: Backgrounds;`
- Constructor, after the `screenShare` construction:

```ts
    this.background = new Backgrounds(deps.effects, async () => {
      const origin = this.req?.link.origin;
      if (!origin) return null;
      const list = await deps.fetchScenes(origin);
      return list ? parseScenes(list, origin) : null;
    }, (text) => this.events.notice(text), deps.log);
```

- `join`, right after `this.req = req;`:

```ts
    this.background.select(req.background || "none").catch((err) => this.deps.log.warn("[call] background failed", err));
```

- Add a helper next to `refreshLocalStream`:

```ts
  // The background effect follows whichever camera track is current.
  private syncBackground() {
    this.background.setTrack(this.camTrack).catch((err) => this.deps.log.warn("[call] background failed", err));
  }
```

- Call `this.syncBackground();` as the last line of `refreshLocalStream()` and of `releaseTracks()`.

In `mobile/src/native/callFactory.ts` add temporary deps so the app typechecks (Task 4 replaces them):

```ts
    effects: { setEffect: () => Promise.reject(new Error("background effects not wired")), attach: () => {}, detach: () => {} },
    fetchScenes: async () => null,
```

- [ ] **Step 4: Run tests**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/core/call.ts mobile/src/native/callFactory.ts mobile/test/call.test.ts
git commit -m "feat(mobile): the call applies the background effect to its camera track"
```

---

### Task 4: JS native wrapper `src/native/background.ts`; wire the call

**Files:**
- Create: `mobile/src/native/background.ts`
- Modify: `mobile/src/native/callFactory.ts`
- Test: `mobile/test/background.native.test.ts` (new)

**Interfaces:**
- Consumes (Task 2): `EffectPort`, `NativeEffect`, `TripReason`; `fetchScenes` from `core/api.ts`.
- Produces (used by Task 7): `export const PROCESSOR = "coyote-background"`; `export const effectPort: EffectPort`; `export function onBackgroundTripped(fn: (reason: TripReason) => void): () => void`. Native contract (Tasks 5–6): module `CoyoteBackground` with `setEffect(effect): Promise<void>` and event `CoyoteBackgroundTripped` `{ reason }`.

react-native-webrtc 124 facts this wrapper depends on (from `node_modules/react-native-webrtc`): `track._setVideoEffects(names)` installs the named processors on the camera's video source. On **Android** an empty list still installs a pass-through processor that over-releases frames (`VideoEffectProcessor.onFrameCaptured` retains once and releases twice when the list is empty), so detaching must pass `null`, which takes the `setVideoProcessor(null)` branch. On **iOS** the native parameter is `nonnull NSArray`, so detaching passes `[]` (an empty processor list forwards frames unchanged).

- [ ] **Step 1: Write the failing tests** — create `mobile/test/background.native.test.ts`:

```ts
// The background-effect native port, with react-native mocked.
type Listener = (e: unknown) => void;

function load(os: "ios" | "android", opts: { module?: boolean } = {}) {
  jest.resetModules();
  const setEffect = jest.fn(async () => null);
  const listeners = new Set<Listener>();
  class NativeEventEmitter {
    addListener(_name: string, fn: Listener) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }
  }
  jest.doMock("react-native", () => ({
    Platform: { OS: os },
    NativeModules: opts.module === false ? {} : { CoyoteBackground: { setEffect } },
    NativeEventEmitter,
  }));
  let mod: typeof import("../src/native/background") | undefined;
  jest.isolateModules(() => {
    mod = require("../src/native/background");
  });
  return { mod: mod!, setEffect, emit: (e: unknown) => listeners.forEach((fn) => fn(e)), listeners };
}

function track() {
  const calls: unknown[] = [];
  return { id: "t1", kind: "video", enabled: true, stop() {}, _setVideoEffects: (n: unknown) => calls.push(n), calls };
}

test("setEffect forwards the effect to the native module", async () => {
  const { mod, setEffect } = load("ios");
  await mod.effectPort.setEffect({ kind: "blur", radius: 0.012 });
  expect(setEffect).toHaveBeenCalledWith({ kind: "blur", radius: 0.012 });
});

test("setEffect rejects when the native module is missing", async () => {
  const { mod } = load("android", { module: false });
  await expect(mod.effectPort.setEffect({ kind: "blur", radius: 0.012 })).rejects.toThrow();
});

test("attach installs the coyote-background processor", () => {
  const { mod } = load("ios");
  const t = track();
  mod.effectPort.attach(t);
  expect(mod.PROCESSOR).toBe("coyote-background");
  expect(t.calls).toEqual([["coyote-background"]]);
});

test("detach: [] on iOS, null on Android", () => {
  const ios = load("ios");
  const a = track();
  ios.mod.effectPort.detach(a);
  expect(a.calls).toEqual([[]]);
  const android = load("android");
  const b = track();
  android.mod.effectPort.detach(b);
  expect(b.calls).toEqual([null]);
});

test("attach/detach on a track without effects support do nothing", () => {
  const { mod } = load("ios");
  const t = { id: "x", kind: "video", enabled: true, stop() {} };
  expect(() => mod.effectPort.attach(t)).not.toThrow();
  expect(() => mod.effectPort.detach(t)).not.toThrow();
});

test("trip events reach the listener with a valid reason only; unsubscribe works", () => {
  const { mod, emit, listeners } = load("android");
  const got: string[] = [];
  const off = mod.onBackgroundTripped((r) => got.push(r));
  emit({ reason: "slow" });
  emit({ reason: "bogus" });
  emit({ reason: "failed" });
  expect(got).toEqual(["slow", "failed"]);
  off();
  expect(listeners.size).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest test/background.native.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — create `mobile/src/native/background.ts`:

```ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { EffectPort, NativeEffect, TripReason } from "../core/backgrounds";
import type { TrackLike } from "../core/types";

const { CoyoteBackground } = NativeModules;

// The processor CoyoteBackground registers with react-native-webrtc's ProcessorProvider.
export const PROCESSOR = "coyote-background";

type EffectsTrack = TrackLike & { _setVideoEffects?(names: string[] | null): void };

function setVideoEffects(track: TrackLike, names: string[] | null) {
  const t = track as EffectsTrack;
  if (typeof t._setVideoEffects !== "function") return;
  try {
    t._setVideoEffects(names);
  } catch (e) {
    console.warn("setting video effects failed", e);
  }
}

export const effectPort: EffectPort = {
  setEffect: (e: NativeEffect) =>
    CoyoteBackground ? CoyoteBackground.setEffect(e) : Promise.reject(new Error("CoyoteBackground native module missing")),
  attach: (track) => setVideoEffects(track, [PROCESSOR]),
  // Android: null removes the processor (an empty list over-releases frames in
  // react-native-webrtc 124). iOS: the native side takes a nonnull array.
  detach: (track) => setVideoEffects(track, Platform.OS === "android" ? null : []),
};

export function onBackgroundTripped(fn: (reason: TripReason) => void): () => void {
  if (!CoyoteBackground) return () => {};
  const sub = new NativeEventEmitter(CoyoteBackground).addListener("CoyoteBackgroundTripped", (e) => {
    const reason = (e as { reason?: unknown })?.reason;
    if (reason === "slow" || reason === "failed") fn(reason);
  });
  return () => sub.remove();
}
```

In `mobile/src/native/callFactory.ts`: import `fetchScenes` from `../core/api` (beside `fetchSoundboard`) and `effectPort, onBackgroundTripped` from `./background`; replace the Task 3 placeholders with

```ts
    effects: effectPort,
    fetchScenes: (origin) => fetchScenes(fetch, origin),
```

and after `const stopEnded = …` add `const stopTripped = onBackgroundTripped((reason) => call?.background.onTripped(reason));`, calling `stopTripped();` in `dispose()`.

- [ ] **Step 4: Run tests**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/native/background.ts mobile/src/native/callFactory.ts mobile/test/background.native.test.ts
git commit -m "feat(mobile): native background-effect port; the call reports trips"
```

---

### Task 5: iOS — `CoyoteBackground` (Vision + Core Image)

**Files:**
- Create: `mobile/ios/Coyote/CoyoteBackground.swift`, `mobile/ios/Coyote/CoyoteBackground.m`
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj` (two files in the Coyote group and Sources phase)
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Consumes: react-native-webrtc's `ProcessorProvider` (`+addProcessor:forName:`) and `VideoFrameProcessorDelegate` (`- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame`). Its `VideoEffectProcessor` passes our return value straight to the video source, so **the processor must never return nil** — it returns the input frame to pass through.
- Produces: native module `CoyoteBackground` with `setEffect(effect, resolve, reject)` (effect `{kind:"blur", radius}` or `{kind:"scene", url}`) and event `CoyoteBackgroundTripped` `{reason}`; processor `coyote-background` registered at load.

Design: the ObjC processor unwraps the `CVPixelBuffer` and calls the Swift `CoyoteBackgroundEngine`, which works on an **upright** image (the camera buffer is rotated by the frame's rotation first) and returns an upright buffer of the source pixel format; ObjC wraps it as a frame with rotation 0. Segmentation runs on an upright, downscaled BGRA copy so the mask is in the same space as the composite, with no orientation guesswork. All WebRTC types stay in ObjC; Swift sees only Core Video / Core Image / Vision.

- [ ] **Step 1: Write the failing guard test** — append to `mobile/test/nativeModules.test.ts`:

```ts
test("iOS CoyoteBackground: module, processor registration and project wiring", () => {
  const ios = path.join(__dirname, "..", "ios");
  const m = fs.readFileSync(path.join(ios, "Coyote", "CoyoteBackground.m"), "utf8");
  expect(m).toContain("RCT_EXTERN_MODULE(CoyoteBackground, RCTEventEmitter)");
  expect(m).toContain("RCT_EXTERN_METHOD(setEffect:(NSDictionary *)effect resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)");
  expect(m).toContain('forName:@"coyote-background"');
  expect(m).toContain("RTCVideoRotation_0");
  const swift = fs.readFileSync(path.join(ios, "Coyote", "CoyoteBackground.swift"), "utf8");
  expect(swift).toContain("VNGeneratePersonSegmentationRequest");
  expect(swift).toContain('"CoyoteBackgroundTripped"');
  expect(swift).toContain("@objc(setEffect:resolver:rejecter:)");
  expect(swift).toContain("budgetMs = 45.0");
  const pbx = fs.readFileSync(path.join(ios, "Coyote.xcodeproj", "project.pbxproj"), "utf8");
  expect(pbx).toContain("CoyoteBackground.swift in Sources");
  expect(pbx).toContain("CoyoteBackground.m in Sources");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest test/nativeModules.test.ts` — Expected: the new test FAILS.

- [ ] **Step 3: Swift** — create `mobile/ios/Coyote/CoyoteBackground.swift`:

```swift
import CoreImage
import CoreVideo
import CryptoKit
import Foundation
import QuartzCore
import React
import Vision

// A pool of pixel buffers of one size and format, rebuilt when either changes.
private final class PixelPool {
  private var pool: CVPixelBufferPool?
  private var key = ""

  func make(_ width: Int, _ height: Int, _ format: OSType) -> CVPixelBuffer? {
    let k = "\(width)x\(height)/\(format)"
    if pool == nil || key != k {
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: format,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
      ]
      var created: CVPixelBufferPool?
      CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &created)
      pool = created
      key = k
    }
    guard let pool = pool else { return nil }
    var out: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &out)
    return out
  }
}

// Background effects for the camera. Segments the person with Vision and composites
// them over a blurred copy of the frame or a scene with Core Image, all upright. The
// ObjC processor in CoyoteBackground.m calls `process` for every camera frame; nil
// means "pass the frame through" (no effect, or the breaker has tripped).
@objc(CoyoteBackgroundEngine)
final class CoyoteBackgroundEngine: NSObject {
  @objc static let shared = CoyoteBackgroundEngine()

  enum Effect {
    case blur(Double) // fraction of the short side
    case scene(CIImage)
  }

  // Called on the main queue with "slow" or "failed".
  var onTrip: ((String) -> Void)?

  private static let budgetMs = 45.0
  private static let warmup: CFTimeInterval = 2
  private static let slowFor: CFTimeInterval = 3
  private static let segmentEvery: CFTimeInterval = 1.0 / 15
  private static let segmentHeight: CGFloat = 384

  private let lock = NSLock()
  private var effect: Effect?
  private var tripped = false
  private var armedAt: CFTimeInterval = 0
  private var avgMs = 0.0
  private var slowSince: CFTimeInterval?
  private var mask: CIImage?
  private var maskAt: CFTimeInterval = 0

  private let context = CIContext(options: [.cacheIntermediates: false])
  private let request: VNGeneratePersonSegmentationRequest = {
    let r = VNGeneratePersonSegmentationRequest()
    r.qualityLevel = .balanced
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
  }()
  private let sequence = VNSequenceRequestHandler()
  private let outPool = PixelPool()
  private let segPool = PixelPool()

  // nil turns the effect off. Re-arms the breaker.
  func configure(_ next: Effect?) {
    lock.lock()
    effect = next
    tripped = false
    armedAt = CACurrentMediaTime()
    avgMs = 0
    slowSince = nil
    mask = nil
    lock.unlock()
  }

  @objc(process:rotation:)
  func process(_ src: CVPixelBuffer, rotation: Int) -> CVPixelBuffer? {
    lock.lock()
    defer { lock.unlock() }
    guard let effect = effect, !tripped else { return nil }
    let t0 = CACurrentMediaTime()
    let oriented = CIImage(cvPixelBuffer: src).oriented(Self.orientation(for: rotation))
    let frame = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.origin.x, y: -oriented.extent.origin.y))
    let extent = frame.extent
    if mask == nil || t0 - maskAt >= Self.segmentEvery {
      guard let fresh = segment(frame) else {
        trip("failed")
        return nil
      }
      mask = fresh
      maskAt = t0
    }
    guard let mask = mask,
          let out = outPool.make(Int(extent.width), Int(extent.height), CVPixelBufferGetPixelFormatType(src))
    else {
      trip("failed")
      return nil
    }
    let fitted = mask
      .transformed(by: CGAffineTransform(scaleX: extent.width / mask.extent.width, y: extent.height / mask.extent.height))
      .clampedToExtent()
      .applyingGaussianBlur(sigma: 2)
      .cropped(to: extent)
    let background: CIImage
    switch effect {
    case .blur(let radius):
      background = frame.clampedToExtent()
        .applyingGaussianBlur(sigma: radius * Double(min(extent.width, extent.height)))
        .cropped(to: extent)
    case .scene(let image):
      let s = max(extent.width / image.extent.width, extent.height / image.extent.height)
      let scaled = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
      background = scaled.transformed(by: CGAffineTransform(
        translationX: (extent.width - scaled.extent.width) / 2 - scaled.extent.origin.x,
        y: (extent.height - scaled.extent.height) / 2 - scaled.extent.origin.y
      )).cropped(to: extent)
    }
    let composite = frame.applyingFilter("CIBlendWithMask", parameters: [
      kCIInputBackgroundImageKey: background,
      kCIInputMaskImageKey: fitted,
    ])
    context.render(composite, to: out)
    watch(since: t0)
    return out
  }

  // The person mask for an upright frame, from a downscaled upright copy.
  private func segment(_ frame: CIImage) -> CIImage? {
    let scale = min(1, Self.segmentHeight / frame.extent.height)
    let w = Int((frame.extent.width * scale).rounded())
    let h = Int((frame.extent.height * scale).rounded())
    guard w > 0, h > 0, let small = segPool.make(w, h, kCVPixelFormatType_32BGRA) else { return nil }
    context.render(frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), to: small)
    do {
      try sequence.perform([request], on: small, orientation: .up)
    } catch {
      NSLog("[CoyoteBackground] segmentation failed: \(error)")
      return nil
    }
    guard let pb = request.results?.first?.pixelBuffer else { return nil }
    return CIImage(cvPixelBuffer: pb)
  }

  // Rolling average of the per-frame cost; trips after slowFor seconds over budget.
  private func watch(since t0: CFTimeInterval) {
    let now = CACurrentMediaTime()
    let ms = (now - t0) * 1000
    avgMs = avgMs == 0 ? ms : avgMs * 0.8 + ms * 0.2
    if now - armedAt < Self.warmup { return }
    if avgMs > Self.budgetMs {
      if let since = slowSince {
        if now - since >= Self.slowFor { trip("slow") }
      } else {
        slowSince = now
      }
    } else {
      slowSince = nil
    }
  }

  // Called with the lock held.
  private func trip(_ reason: String) {
    tripped = true
    let callback = onTrip
    DispatchQueue.main.async { callback?(reason) }
  }

  // RTCVideoRotation (degrees clockwise to display upright) → image orientation.
  private static func orientation(for rotation: Int) -> CGImagePropertyOrientation {
    switch rotation {
    case 90: return .right
    case 180: return .down
    case 270: return .left
    default: return .up
    }
  }
}

// Configures the shared engine from JS and reports trips. Exported methods hop to
// the main queue; the latest setEffect wins even if an earlier scene download
// finishes after it.
@objc(CoyoteBackground)
class CoyoteBackground: RCTEventEmitter {
  private var listening = false
  private var token = 0

  override init() {
    super.init()
    CoyoteBackgroundEngine.shared.onTrip = { [weak self] reason in
      guard let self = self, self.listening else { return }
      self.sendEvent(withName: "CoyoteBackgroundTripped", body: ["reason": reason])
    }
  }

  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["CoyoteBackgroundTripped"] }
  override func startObserving() { DispatchQueue.main.async { [weak self] in self?.listening = true } }
  override func stopObserving() { DispatchQueue.main.async { [weak self] in self?.listening = false } }

  @objc(setEffect:resolver:rejecter:)
  func setEffect(_ effect: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      self.token += 1
      let mine = self.token
      switch effect["kind"] as? String {
      case "blur":
        let radius = (effect["radius"] as? NSNumber)?.doubleValue ?? 0.012
        CoyoteBackgroundEngine.shared.configure(.blur(radius))
        resolve(nil)
      case "scene":
        guard let s = effect["url"] as? String, let url = URL(string: s) else {
          reject("bad_effect", "scene without a url", nil)
          return
        }
        self.loadScene(url) { image in
          DispatchQueue.main.async {
            guard let image = image else {
              reject("scene_failed", "Couldn't load \(s)", nil)
              return
            }
            if self.token == mine { CoyoteBackgroundEngine.shared.configure(.scene(image)) }
            resolve(nil)
          }
        }
      default:
        reject("bad_effect", "unknown effect kind", nil)
      }
    }
  }

  // Cached under Caches/backgrounds by a hash of the URL (the server version-stamps
  // scene URLs, so a changed image has a new URL).
  private func loadScene(_ url: URL, done: @escaping (CIImage?) -> Void) {
    let fm = FileManager.default
    let dir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("backgrounds", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    let file = dir.appendingPathComponent(name + ".webp")
    if fm.fileExists(atPath: file.path) {
      if let image = CIImage(contentsOf: file) {
        done(image)
        return
      }
      try? fm.removeItem(at: file)
    }
    URLSession.shared.downloadTask(with: url) { tmp, response, error in
      guard let tmp = tmp, error == nil,
            let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
      else {
        done(nil)
        return
      }
      try? fm.removeItem(at: file)
      do {
        try fm.moveItem(at: tmp, to: file)
      } catch {
        done(nil)
        return
      }
      guard let image = CIImage(contentsOf: file) else {
        try? fm.removeItem(at: file)
        done(nil)
        return
      }
      done(image)
    }.resume()
  }
}
```

- [ ] **Step 4: ObjC** — create `mobile/ios/Coyote/CoyoteBackground.m`:

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCVideoFrame.h>
#if __has_include(<react-native-webrtc/ProcessorProvider.h>)
#import <react-native-webrtc/ProcessorProvider.h>
#elif __has_include(<react_native_webrtc/ProcessorProvider.h>)
#import <react_native_webrtc/ProcessorProvider.h>
#else
#import "ProcessorProvider.h"
#endif
#import "Coyote-Swift.h"

@interface RCT_EXTERN_MODULE(CoyoteBackground, RCTEventEmitter)
RCT_EXTERN_METHOD(setEffect:(NSDictionary *)effect resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

// The camera-frame hook react-native-webrtc calls for tracks with the
// "coyote-background" effect. It must always return a frame: react-native-webrtc
// hands the result straight to the video source.
@interface CoyoteBackgroundProcessor : NSObject <VideoFrameProcessorDelegate>
@end

@implementation CoyoteBackgroundProcessor

+ (void)load {
  [ProcessorProvider addProcessor:[CoyoteBackgroundProcessor new] forName:@"coyote-background"];
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
  if (![frame.buffer isKindOfClass:[RTCCVPixelBuffer class]]) return frame;
  CVPixelBufferRef src = ((RTCCVPixelBuffer *)frame.buffer).pixelBuffer;
  CVPixelBufferRef out = [[CoyoteBackgroundEngine shared] process:src rotation:(NSInteger)frame.rotation];
  if (out == NULL) return frame;
  RTCCVPixelBuffer *buffer = [[RTCCVPixelBuffer alloc] initWithPixelBuffer:out];
  return [[RTCVideoFrame alloc] initWithBuffer:buffer rotation:RTCVideoRotation_0 timeStampNs:frame.timeStampNs];
}

@end
```

- [ ] **Step 5: Project file** — in `mobile/ios/Coyote.xcodeproj/project.pbxproj` (tabs), mirroring the `CoyoteScreenShare` entries:

PBXBuildFile, after `CoyoteScreenShare.m in Sources`:

```
		C0B0AE112E00000000000001 /* CoyoteBackground.swift in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AE012E00000000000001 /* CoyoteBackground.swift */; };
		C0B0AE122E00000000000001 /* CoyoteBackground.m in Sources */ = {isa = PBXBuildFile; fileRef = C0B0AE022E00000000000001 /* CoyoteBackground.m */; };
```

PBXFileReference, after the `CoyoteScreenShare.m` reference:

```
		C0B0AE012E00000000000001 /* CoyoteBackground.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = CoyoteBackground.swift; path = Coyote/CoyoteBackground.swift; sourceTree = "<group>"; };
		C0B0AE022E00000000000001 /* CoyoteBackground.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; name = CoyoteBackground.m; path = Coyote/CoyoteBackground.m; sourceTree = "<group>"; };
```

`Coyote` group children, after `CoyoteScreenShare.m`:

```
				C0B0AE012E00000000000001 /* CoyoteBackground.swift */,
				C0B0AE022E00000000000001 /* CoyoteBackground.m */,
```

App Sources phase (`13B07F871A680F5B00A75B9A`) files, after `CoyoteScreenShare.m in Sources`:

```
				C0B0AE112E00000000000001 /* CoyoteBackground.swift in Sources */,
				C0B0AE122E00000000000001 /* CoyoteBackground.m in Sources */,
```

Check: `python3 -c "s=open('mobile/ios/Coyote.xcodeproj/project.pbxproj').read(); print(s.count('{')-s.count('}'), s.count('(')-s.count(')'))"` → `0 0`.

- [ ] **Step 6: Verify**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/ios/Coyote/CoyoteBackground.swift mobile/ios/Coyote/CoyoteBackground.m mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/test/nativeModules.test.ts
git commit -m "feat(mobile): iOS background effects — Vision segmentation, Core Image composite"
```

---

### Task 6: Android — `CoyoteBackground` (ML Kit, CPU composite at 640×360)

**Files:**
- Create: `mobile/android/app/src/main/java/net/swiftirc/coyote/BackgroundEngine.kt`, `Yuv.kt`, `CoyoteBackgroundModule.kt`, `CoyoteBackgroundPackage.kt`
- Modify: `mobile/android/app/src/main/java/net/swiftirc/coyote/MainApplication.kt`, `mobile/android/app/build.gradle`
- Modify: `THIRD-PARTY-NOTICES.md`
- Test: `mobile/test/nativeModules.test.ts`

**Interfaces:**
- Consumes: react-native-webrtc's `com.oney.WebRTCModule.videoEffects.ProcessorProvider.addProcessor(String, VideoFrameProcessorFactoryInterface)` and `VideoFrameProcessor.process(VideoFrame, SurfaceTextureHelper): VideoFrame?`. Its `VideoEffectProcessor` forwards the original frame when a processor returns **null**, and releases a non-null returned frame itself — so return null to pass through, and return a **new** frame (refcount 1) otherwise; never return the input frame.
- Produces: module `CoyoteBackground` (`setEffect(ReadableMap, Promise)`, `addListener`, `removeListeners`), event `CoyoteBackgroundTripped` `{reason}`; processor `coyote-background` registered in `MainApplication.onCreate`.

Frames: the camera frame is cropped/scaled to 640×360 (or 360×640) in its own orientation, converted to ARGB, rotated upright into a bitmap, segmented with ML Kit (at most every 66 ms; the last mask is reused in between), blended with the background per pixel, converted back to I420 and returned upright with rotation 0.

- [ ] **Step 1: Write the failing guard tests** — append to `mobile/test/nativeModules.test.ts`:

```ts
test("Android CoyoteBackground: exports, registration, ML Kit, frame ownership", () => {
  const dir = path.join(__dirname, "..", "android", "app", "src", "main", "java", "net", "swiftirc", "coyote");
  const mod = fs.readFileSync(path.join(dir, "CoyoteBackgroundModule.kt"), "utf8");
  expect(exportedNames(mod).sort()).toEqual(["addListener", "removeListeners", "setEffect"]);
  expect(mod).toContain('"CoyoteBackgroundTripped"');
  const app = fs.readFileSync(path.join(dir, "MainApplication.kt"), "utf8");
  expect(app).toContain('ProcessorProvider.addProcessor("coyote-background"');
  expect(app).toContain("CoyoteBackgroundPackage()");
  const engine = fs.readFileSync(path.join(dir, "BackgroundEngine.kt"), "utf8");
  expect(engine).toContain("SelfieSegmenterOptions.STREAM_MODE");
  expect(engine).toContain("BUDGET_MS = 45.0");
  expect(engine).not.toMatch(/return\s+frame\b/); // never hand the input frame back
  const gradle = fs.readFileSync(path.join(__dirname, "..", "android", "app", "build.gradle"), "utf8");
  expect(gradle).toContain("com.google.mlkit:segmentation-selfie:16.0.0-beta6");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest test/nativeModules.test.ts` — Expected: the new test FAILS.

- [ ] **Step 3: Gradle** — in `mobile/android/app/build.gradle`, inside `dependencies { … }` after `implementation("com.facebook.react:react-android")`:

```gradle
    // Background effects: on-device person segmentation (model bundled, no Play Services).
    implementation("com.google.mlkit:segmentation-selfie:16.0.0-beta6")
```

- [ ] **Step 4: Kotlin** — create `Yuv.kt`:

```kotlin
package net.swiftirc.coyote

import org.webrtc.JavaI420Buffer
import org.webrtc.VideoFrame

// BT.601 limited-range conversions between I420 and packed ARGB ints, sized for
// the 640×360 frames the background effect works on.
object Yuv {
  fun i420ToArgb(src: VideoFrame.I420Buffer, out: IntArray) {
    val w = src.width
    val h = src.height
    val y = src.dataY
    val u = src.dataU
    val v = src.dataV
    val sy = src.strideY
    val su = src.strideU
    val sv = src.strideV
    for (row in 0 until h) {
      val yRow = row * sy
      val uRow = (row / 2) * su
      val vRow = (row / 2) * sv
      for (col in 0 until w) {
        val c = (y.get(yRow + col).toInt() and 0xff) - 16
        val d = (u.get(uRow + col / 2).toInt() and 0xff) - 128
        val e = (v.get(vRow + col / 2).toInt() and 0xff) - 128
        val r = clamp((298 * c + 409 * e + 128) shr 8)
        val g = clamp((298 * c - 100 * d - 208 * e + 128) shr 8)
        val b = clamp((298 * c + 516 * d + 128) shr 8)
        out[row * w + col] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
  }

  fun argbToI420(src: IntArray, w: Int, h: Int, dst: JavaI420Buffer) {
    val y = dst.dataY
    val u = dst.dataU
    val v = dst.dataV
    for (row in 0 until h) {
      for (col in 0 until w) {
        val p = src[row * w + col]
        val r = (p shr 16) and 0xff
        val g = (p shr 8) and 0xff
        val b = p and 0xff
        y.put(row * dst.strideY + col, (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
        if (row % 2 == 0 && col % 2 == 0) {
          u.put((row / 2) * dst.strideU + col / 2, (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
          v.put((row / 2) * dst.strideV + col / 2, (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
        }
      }
    }
  }

  private fun clamp(x: Int) = if (x < 0) 0 else if (x > 255) 255 else x
}
```

Create `BackgroundEngine.kt`:

```kotlin
package net.swiftirc.coyote

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt

// The "coyote-background" processor. Segments the person with ML Kit and composites
// them over a blurred copy of the frame or a scene, on the CPU at 640×360, output
// upright with rotation 0. Returning null passes the frame through untouched
// (react-native-webrtc then forwards the original); a returned frame is new and
// owned by the caller.
object BackgroundEngine : VideoFrameProcessor {
  sealed class Effect {
    data class Blur(val radius: Double) : Effect() // fraction of the short side
    class Scene(val image: Bitmap) : Effect()
  }

  private const val TAG = "CoyoteBackground"
  private const val LONG_SIDE = 640
  private const val SHORT_SIDE = 360
  private const val BUDGET_MS = 45.0
  private const val WARMUP_MS = 2_000L
  private const val SLOW_FOR_MS = 3_000L
  private const val SEGMENT_EVERY_MS = 66L

  @Volatile var onTrip: ((String) -> Unit)? = null

  private var effect: Effect? = null
  private var tripped = false
  private var armedAt = 0L
  private var avgMs = 0.0
  private var slowSince = 0L

  private var segmenter: Segmenter? = null
  private var mask: FloatArray? = null
  private var maskAt = 0L
  private var raw: Bitmap? = null
  private var upright: Bitmap? = null
  private var argb = IntArray(0)
  private var bg = IntArray(0)
  private var sceneFor: Effect.Scene? = null
  private var scenePixels = IntArray(0)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

  // null turns the effect off. Re-arms the breaker.
  @Synchronized fun configure(next: Effect?) {
    effect = next
    tripped = false
    armedAt = SystemClock.elapsedRealtime()
    avgMs = 0.0
    slowSince = 0L
    mask = null
    sceneFor = null
  }

  @Synchronized override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper?): VideoFrame? {
    val e = effect ?: return null
    if (tripped) return null
    val t0 = SystemClock.elapsedRealtime()
    return try {
      val out = render(frame, e, t0)
      watch(t0)
      out
    } catch (t: Throwable) {
      Log.w(TAG, "background frame failed", t)
      trip("failed")
      null
    }
  }

  private fun render(frame: VideoFrame, e: Effect, now: Long): VideoFrame {
    val buffer = frame.buffer
    val landscape = buffer.width >= buffer.height
    val sw = if (landscape) LONG_SIDE else SHORT_SIDE
    val sh = if (landscape) SHORT_SIDE else LONG_SIDE
    val scaled = buffer.cropAndScale(0, 0, buffer.width, buffer.height, sw, sh)
    val i420 = try { scaled.toI420() } finally { scaled.release() } ?: throw IllegalStateException("toI420 failed")
    val rot = ((frame.rotation % 360) + 360) % 360
    val sideways = rot == 90 || rot == 270
    val uw = if (sideways) sh else sw
    val uh = if (sideways) sw else sh
    ensureScratch(sw, sh, uw, uh)
    try { Yuv.i420ToArgb(i420, argb) } finally { i420.release() }
    val rawBmp = raw!!
    val up = upright!!
    rawBmp.setPixels(argb, 0, sw, 0, 0, sw, sh)
    val m = Matrix().apply {
      postRotate(rot.toFloat())
      when (rot) {
        90 -> postTranslate(sh.toFloat(), 0f)
        180 -> postTranslate(sw.toFloat(), sh.toFloat())
        270 -> postTranslate(0f, sw.toFloat())
      }
    }
    Canvas(up).drawBitmap(rawBmp, m, paint)
    up.getPixels(argb, 0, uw, 0, 0, uw, uh)
    if (mask == null || now - maskAt >= SEGMENT_EVERY_MS) segment(up, uw, uh, now)
    val personMask = mask ?: throw IllegalStateException("no mask")
    background(e, up, uw, uh)
    for (i in 0 until uw * uh) {
      val a = personMask[i].coerceIn(0f, 1f)
      val f = argb[i]
      val b = bg[i]
      val r = (((f shr 16) and 0xff) * a + ((b shr 16) and 0xff) * (1 - a)).toInt()
      val g = (((f shr 8) and 0xff) * a + ((b shr 8) and 0xff) * (1 - a)).toInt()
      val bl = ((f and 0xff) * a + (b and 0xff) * (1 - a)).toInt()
      argb[i] = (0xff shl 24) or (r shl 16) or (g shl 8) or bl
    }
    val out = JavaI420Buffer.allocate(uw, uh)
    Yuv.argbToI420(argb, uw, uh, out)
    return VideoFrame(out, 0, frame.timestampNs)
  }

  private fun ensureScratch(sw: Int, sh: Int, uw: Int, uh: Int) {
    val r = raw
    val u = upright
    if (r != null && u != null && r.width == sw && r.height == sh && u.width == uw && u.height == uh) return
    r?.recycle()
    u?.recycle()
    raw = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
    upright = Bitmap.createBitmap(uw, uh, Bitmap.Config.ARGB_8888)
    argb = IntArray(sw * sh)
    bg = IntArray(sw * sh)
    mask = null
    sceneFor = null
  }

  private fun segment(image: Bitmap, w: Int, h: Int, now: Long) {
    val client = segmenter ?: Segmentation.getClient(
      SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).build()
    ).also { segmenter = it }
    val result = Tasks.await(client.process(InputImage.fromBitmap(image, 0)), 500, TimeUnit.MILLISECONDS)
    if (result.width != w || result.height != h) throw IllegalStateException("mask ${result.width}x${result.height} for ${w}x$h")
    val floats = result.buffer.apply { rewind() }.asFloatBuffer()
    val arr = mask?.takeIf { it.size == w * h } ?: FloatArray(w * h)
    floats.get(arr)
    mask = arr
    maskAt = now
  }

  private fun background(e: Effect, image: Bitmap, w: Int, h: Int) {
    when (e) {
      is Effect.Blur -> {
        val f = max(2, (e.radius * minOf(w, h)).roundToInt())
        val small = Bitmap.createScaledBitmap(image, max(1, w / f), max(1, h / f), true)
        val big = Bitmap.createScaledBitmap(small, w, h, true)
        big.getPixels(bg, 0, w, 0, 0, w, h)
        small.recycle()
        big.recycle()
      }
      is Effect.Scene -> {
        if (sceneFor !== e || scenePixels.size != w * h) {
          val img = e.image
          val s = max(w.toFloat() / img.width, h.toFloat() / img.height)
          val m = Matrix().apply {
            postScale(s, s)
            postTranslate((w - img.width * s) / 2f, (h - img.height * s) / 2f)
          }
          val canvasBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          Canvas(canvasBmp).drawBitmap(img, m, paint)
          scenePixels = IntArray(w * h)
          canvasBmp.getPixels(scenePixels, 0, w, 0, 0, w, h)
          canvasBmp.recycle()
          sceneFor = e
        }
        System.arraycopy(scenePixels, 0, bg, 0, w * h)
      }
    }
  }

  // Rolling average of the per-frame cost; trips after SLOW_FOR_MS over budget.
  private fun watch(t0: Long) {
    val now = SystemClock.elapsedRealtime()
    val ms = (now - t0).toDouble()
    avgMs = if (avgMs == 0.0) ms else avgMs * 0.8 + ms * 0.2
    if (now - armedAt < WARMUP_MS) return
    if (avgMs > BUDGET_MS) {
      if (slowSince == 0L) slowSince = now else if (now - slowSince >= SLOW_FOR_MS) trip("slow")
    } else {
      slowSince = 0L
    }
  }

  private fun trip(reason: String) {
    tripped = true
    onTrip?.invoke(reason)
  }
}
```

Create `CoyoteBackgroundModule.kt`:

```kotlin
package net.swiftirc.coyote

import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

// Configures BackgroundEngine from JS and reports trips. Scene images are downloaded
// once into the cache; the latest setEffect wins even if an earlier download
// finishes after it.
class CoyoteBackgroundModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "CoyoteBackground"

  private val io = Executors.newSingleThreadExecutor()
  private val token = AtomicInteger(0)

  init {
    BackgroundEngine.onTrip = { reason -> emitTripped(reason) }
  }

  @ReactMethod
  fun setEffect(effect: ReadableMap, promise: Promise) {
    val mine = token.incrementAndGet()
    when (if (effect.hasKey("kind")) effect.getString("kind") else null) {
      "blur" -> {
        val radius = if (effect.hasKey("radius")) effect.getDouble("radius") else 0.012
        BackgroundEngine.configure(BackgroundEngine.Effect.Blur(radius))
        promise.resolve(null)
      }
      "scene" -> {
        val url = if (effect.hasKey("url")) effect.getString("url") else null
        if (url.isNullOrEmpty()) {
          promise.reject("bad_effect", "scene without a url")
          return
        }
        io.execute {
          try {
            val image = loadScene(url)
            if (token.get() == mine) BackgroundEngine.configure(BackgroundEngine.Effect.Scene(image))
            promise.resolve(null)
          } catch (e: Exception) {
            Log.w("CoyoteBackground", "scene $url failed", e)
            promise.reject("scene_failed", e.message ?: "scene failed", e)
          }
        }
      }
      else -> promise.reject("bad_effect", "unknown effect kind")
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun loadScene(url: String): android.graphics.Bitmap {
    val dir = File(ctx.cacheDir, "backgrounds").apply { mkdirs() }
    val hash = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    val file = File(dir, "$hash.webp")
    if (!file.exists()) {
      val part = File(dir, "$hash.part")
      val conn = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 10_000; readTimeout = 15_000 }
      try {
        if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
        conn.inputStream.use { input -> part.outputStream().use { input.copyTo(it) } }
      } catch (e: Exception) {
        part.delete()
        throw e
      } finally {
        conn.disconnect()
      }
      if (!part.renameTo(file)) {
        part.delete()
        throw java.io.IOException("rename failed")
      }
    }
    return BitmapFactory.decodeFile(file.path) ?: run {
      file.delete()
      throw java.io.IOException("decode failed")
    }
  }

  private fun emitTripped(reason: String) {
    if (!ctx.hasActiveReactInstance()) return
    val body = Arguments.createMap().apply { putString("reason", reason) }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("CoyoteBackgroundTripped", body)
  }
}
```

Create `CoyoteBackgroundPackage.kt`:

```kotlin
package net.swiftirc.coyote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CoyoteBackgroundPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CoyoteBackgroundModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
```

In `MainApplication.kt`: add imports

```kotlin
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
```

add `add(CoyoteBackgroundPackage())` after `add(CoyoteSoundsPackage())`, and in `onCreate()` before `loadReactNative(this)`:

```kotlin
    // The camera-frame hook for background effects (JS attaches it by this name).
    ProcessorProvider.addProcessor("coyote-background", VideoFrameProcessorFactoryInterface { BackgroundEngine })
```

- [ ] **Step 5: Notices** — in `THIRD-PARTY-NOTICES.md`, in the section "## Not bundled in the repository, but linked into a build", add after its Go table:

```markdown
### Android app — Google ML Kit Selfie Segmentation

The Android app links `com.google.mlkit:segmentation-selfie` (Gradle), used for
on-device person segmentation by the background effects. It is distributed under
the ML Kit Terms of Service (<https://developers.google.com/ml-kit/terms>); the model
runs on the device and no frames leave it.
```

- [ ] **Step 6: Verify**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/android/app/src/main/java/net/swiftirc/coyote mobile/android/app/build.gradle mobile/test/nativeModules.test.ts THIRD-PARTY-NOTICES.md
git commit -m "feat(mobile): Android background effects — ML Kit segmentation, CPU composite at 640×360"
```

---

### Task 7: UI — Background sheet, PreJoin row and preview, ☰ Background…

**Files:**
- Create: `mobile/src/ui/components/BackgroundSheet.tsx`
- Modify: `mobile/src/ui/hooks.ts`, `mobile/src/ui/components/MoreSheet.tsx`, `mobile/src/ui/screens/Call.tsx`, `mobile/src/ui/screens/PreJoin.tsx`

**Interfaces:**
- Consumes: `Backgrounds`, `BgSnapshot`, `BUILTIN_EFFECTS`, `labelFor`, `parseScenes` (Task 2); `call.background` (Task 3); `effectPort`, `onBackgroundTripped` (Task 4); `fetchScenes` (`core/api.ts`); `useStore` (`ui/hooks.ts`); `Sheet` component.
- Produces: `useBackground(): BgSnapshot`; `BackgroundSheet` props `{ visible: boolean; onClose(): void; snap: BgSnapshot; onSelect(id: string): void; onOpen(): void }`; `MoreSheet` prop `onBackground(): void`; `JoinRequest.background` set from PreJoin.

No component-test harness exists; this task's gate is typecheck + lint + the manual checklist.

- [ ] **Step 1: Hook** — in `mobile/src/ui/hooks.ts` add `import type { BgSnapshot } from "../core/backgrounds";` and:

```ts
const EMPTY_BG: BgSnapshot = { selected: "none", applied: "none", busy: false, scenes: [], scenesState: "idle" };

export function useBackground(): BgSnapshot {
  const { call } = useCall();
  return useStore(call()?.background ?? null, EMPTY_BG);
}
```

- [ ] **Step 2: Sheet** — create `mobile/src/ui/components/BackgroundSheet.tsx`:

```tsx
import React, { useEffect } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BUILTIN_EFFECTS, type BgSnapshot } from "../../core/backgrounds";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";

// Pick a background effect: None, Blur, Blur+, then the server's scenes. Applies
// immediately; the sheet stays open so you can compare.
export function BackgroundSheet({ visible, onClose, snap, onSelect, onOpen }: {
  visible: boolean; onClose(): void; snap: BgSnapshot; onSelect(id: string): void; onOpen(): void;
}) {
  useEffect(() => {
    if (visible) onOpen();
  }, [visible, onOpen]);

  const tile = (id: string, label: string, image?: string) => {
    const on = snap.selected === id;
    return (
      <Pressable
        key={id}
        onPress={() => onSelect(id)}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        style={[styles.tile, on && styles.tileOn]}
      >
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <Text style={[styles.label, image ? styles.labelOnImage : null]} numberOfLines={1}>{on ? "✓ " : ""}{label}</Text>
        {on && snap.busy ? <ActivityIndicator style={styles.spinner} color={colors.text} /> : null}
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.55}>
      <ScrollView contentContainerStyle={styles.grid}>
        {BUILTIN_EFFECTS.map((b) => tile(b.id, b.label))}
        {snap.scenes.map((s) => tile(s.id, s.label, s.url))}
        {snap.scenesState === "loading" ? <ActivityIndicator style={styles.loading} color={colors.muted} /> : null}
        {snap.scenesState === "unavailable" ? <Text style={styles.msg}>Scenes unavailable offline.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  tile: { width: "31%", aspectRatio: 16 / 9, borderRadius: radius, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  tileOn: { borderColor: colors.accent },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  labelOnImage: { position: "absolute", left: 4, bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 4, borderRadius: 4, overflow: "hidden" },
  spinner: { position: "absolute", top: 4, right: 4 },
  loading: { width: "100%", marginTop: 8 },
  msg: { color: colors.muted, width: "100%", marginTop: 8 },
});
```

- [ ] **Step 3: ☰ row** — in `mobile/src/ui/components/MoreSheet.tsx` add prop `onBackground(): void` (destructure it and add it to the props type), and right after the Share screen `<Pressable>…</Pressable>` add:

```tsx
        <Pressable onPress={onBackground} accessibilityRole="button" style={styles.row2}>
          <Text style={styles.saveText}>Background…</Text>
        </Pressable>
```

- [ ] **Step 4: Call screen** — in `mobile/src/ui/screens/Call.tsx`:

- Add `useBackground` to the `../hooks` import and `import { BackgroundSheet } from "../components/BackgroundSheet";`.
- `const bg = useBackground();` after `const share = useScreenShare();`.
- Extend the sheet state union: `"chat" | "more" | "poll-form" | "background" | null`.
- Pass `onBackground={() => setSheet("background")}` to `MoreSheet`.
- After `<PollForm … />` add:

```tsx
        <BackgroundSheet
          visible={sheet === "background"}
          onClose={() => setSheet(null)}
          snap={bg}
          onOpen={loadScenes}
          onSelect={(id) => {
            call()?.background.select(id).catch(warn("background"));
            savePrefs({ background: id }).catch(() => {});
          }}
        />
```

with, near the other callbacks at the top of the component:

```tsx
  const loadScenes = useCallback(() => { call()?.background.loadScenes().catch(warn("scenes")); }, [call]);
```

(add `useCallback` to the React import).

- [ ] **Step 5: PreJoin** — in `mobile/src/ui/screens/PreJoin.tsx`:

- Imports: `fetchScenes` (add to the `../../core/api` import); `import { Backgrounds, labelFor, parseScenes } from "../../core/backgrounds";`; `import { effectPort, onBackgroundTripped } from "../../native/background";`; `import { useStore } from "../hooks";`; `import { BackgroundSheet } from "../components/BackgroundSheet";`.
- State and store, after `const previewTrack = useRef<TrackLike | null>(null);`:

```tsx
  const [bgOpen, setBgOpen] = useState(false);
  const linkRef = useRef(link);
  linkRef.current = link;
  // The preview's own effect store (the call builds its own on join).
  const bgRef = useRef<Backgrounds | null>(null);
  if (!bgRef.current) {
    bgRef.current = new Backgrounds(
      effectPort,
      async () => {
        const origin = linkRef.current.origin;
        const list = await fetchScenes(fetch, origin);
        return list ? parseScenes(list, origin) : null;
      },
      (text) => setError(text),
      console,
    );
  }
  const bgStore = bgRef.current;
  const bg = useStore(bgStore, bgStore.getSnapshot());
  useEffect(() => onBackgroundTripped((reason) => bgStore.onTripped(reason)), [bgStore]);
  useEffect(() => { bgStore.resetScenes(); }, [link.origin, bgStore]);
  const loadScenes = useCallback(() => { bgStore.loadScenes().catch(() => {}); }, [bgStore]);
```

- In the prefs `useEffect`, inside `loadPrefs().then((p) => { … })` add `bgStore.select(p.background).catch(() => {});` (add `bgStore` to that effect's dependency list).
- `stopPreview`: before `previewTrack.current?.stop();` add `bgStore.setTrack(null).catch(() => {});` (add `bgStore` to its deps).
- In the preview `useFocusEffect`, after `previewTrack.current = t;` add `bgStore.setTrack(t).catch(() => {});`.
- In `onJoin`, pass `background: bg.selected` in the `join({ … })` object.
- After the Camera row add:

```tsx
        <Pressable style={styles.row} onPress={() => setBgOpen(true)} accessibilityRole="button" accessibilityLabel={`Background: ${labelFor(bg.selected, bg.scenes)}`}>
          <Text style={styles.label}>Background</Text>
          <Text style={styles.muted}>{labelFor(bg.selected, bg.scenes)} ›</Text>
        </Pressable>
```

- As the last child of the root `KeyboardAvoidingView` (after the footer `View`):

```tsx
      <BackgroundSheet
        visible={bgOpen}
        onClose={() => setBgOpen(false)}
        snap={bg}
        onOpen={loadScenes}
        onSelect={(id) => {
          bgStore.select(id).catch(() => {});
          savePrefs({ background: id }).catch(() => {});
        }}
      />
```

- [ ] **Step 6: Verify**

Run: `npx jest && npm run typecheck && npm run lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/ui
git commit -m "feat(mobile): background picker in PreJoin and ☰, with a live preview"
```

---

### Task 8: 1.5.0 version bump, release notes, manual checklist

**Files:**
- Modify: `mobile/ios/Coyote.xcodeproj/project.pbxproj`, `mobile/android/app/build.gradle`, `mobile/RELEASE.md`, `mobile/MANUAL-TEST.md`

- [ ] **Step 1: Bump**

```bash
cd mobile && sed -i 's/MARKETING_VERSION = 1\.4\.0;/MARKETING_VERSION = 1.5.0;/; s/CURRENT_PROJECT_VERSION = 7;/CURRENT_PROJECT_VERSION = 8;/' ios/Coyote.xcodeproj/project.pbxproj && grep -c "MARKETING_VERSION = 1.5.0;" ios/Coyote.xcodeproj/project.pbxproj && grep -c "CURRENT_PROJECT_VERSION = 8;" ios/Coyote.xcodeproj/project.pbxproj
```

Expected: `4` and `4`. In `android/app/build.gradle`: `versionCode 8`, `versionName "1.5.0"`.

- [ ] **Step 2: RELEASE.md** — append to the end of "## Before every release":

```markdown

Background effects (1.5.0+) need a server with `GET /api/scenes`; deploy it before
releasing the apps (an older server still works, with Blur and Blur+ only). The
Android build pulls Google ML Kit (`segmentation-selfie`) from Maven, adding ~4.5 MB.
```

- [ ] **Step 3: MANUAL-TEST.md** — append:

```markdown
## Background effects (1.5.0)

Server prerequisite: a deploy with `GET /api/scenes`. Run on both platforms with a
browser in the call to watch the result.

60. **PreJoin.** The Background row reads "None". Open it: None, Blur, Blur+, then
    the server's scenes (thumbnails). Pick Blur: the preview blurs behind you within
    a second; Blur+ is stronger; a scene replaces the background. The choice is
    remembered after leaving and reopening PreJoin.
61. **In the call.** Join with Blur: the browser sees you blurred. ☰ → Background… →
    a scene: the browser sees the scene, upright, filling the frame (not stretched).
    Back to None: the plain camera returns.
62. **Orientation.** With an effect on, hold the phone in portrait, then landscape:
    the person cut-out lines up with you in both (a rotated or offset cut-out means
    the frame rotation is handled wrongly).
63. **Flip and camera off/on.** With an effect on, flip to the back camera and back;
    turn the camera off and on; background the app and return: the effect stays on.
64. **Android resolution.** With an effect on, the browser's stats (or the tile) show
    a 640×360 / 360×640 camera from the Android phone; with None, the normal 720p.
65. **Slow phone.** On an older phone, pick Blur+: if it cannot keep up, within a few
    seconds the effect turns off with "Background effect turned off: this phone
    couldn't keep up." Picking it again tries again.
66. **Offline / older server.** In airplane mode (or against a server without
    `/api/scenes`), the sheet shows None/Blur/Blur+ and "Scenes unavailable offline.";
    a saved scene choice joins with no effect and no error.
67. **Quick changes.** Tap a scene and immediately Blur: you end up blurred, not on
    the scene.
68. **Battery and heat.** Ten minutes with Blur on: the call stays smooth and the
    phone does not get uncomfortably hot.
```

- [ ] **Step 4: Verify**

Run (in `mobile/`): `npx jest && npm run typecheck && npm run lint` — Expected: PASS (the version guard sees four matching 1.5.0 / 8 pairs).

- [ ] **Step 5: Commit**

```bash
git add mobile/ios/Coyote.xcodeproj/project.pbxproj mobile/android/app/build.gradle mobile/RELEASE.md mobile/MANUAL-TEST.md
git commit -m "chore(mobile): 1.5.0 (build 8) with the background-effects checklist"
```
