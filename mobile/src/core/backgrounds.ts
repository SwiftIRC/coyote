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
  clear(): void; // frees the native effect (scene image, mask) while nothing uses it
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

const sameEffect = (a: NativeEffect, b: NativeEffect) =>
  a.kind === "blur" ? b.kind === "blur" && a.radius === b.radius : b.kind === "scene" && a.url === b.url;

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

// The short side of the frames a native effect sends when it scales the camera to a
// long-side limit (Android: 640), rounded then made even as I420 needs; null when there
// is no limit or the size is unknown. Quality tiers must scale from this, not 720.
export function effectOutputHeight(settings: { width?: number; height?: number }, maxLongSide: number | null): number | null {
  const w = settings.width || 0;
  const h = settings.height || 0;
  if (!maxLongSide || !w || !h) return null;
  // Mirrors BackgroundEngine.kt: the long side always becomes maxLongSide.
  return Math.max(2, Math.round((maxLongSide * Math.min(w, h)) / Math.max(w, h)) & ~1);
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
  // After a trip the effect stays off for the call (new tracks included) until the
  // user chooses again; otherwise a slow phone would stutter and trip on every flip.
  private tripped = false;
  // What the native processor was last configured with successfully. A new track
  // with the same effect is attached at once, before it sends a raw frame.
  private configured: NativeEffect | null = null;
  // The native processor is shared (PreJoin's preview and the call each have a
  // store): every setEffect/clear by any store bumps this, voiding older memos.
  private static nativeGen = 0;
  private configuredAt = -1;

  constructor(
    private port: EffectPort,
    private loadSceneList: () => Promise<Scene[] | null>,
    private notice: (text: string) => void,
    private log: Logger,
  ) {}

  select(id: string): Promise<void> {
    this.tripped = false;
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
    // The native engine is tripped whatever this store shows (the trip may come from
    // a track already gone): never attach to it again without reconfiguring.
    this.configured = null;
    if (this.snap.applied === "none" && !this.snap.busy) return;
    this.gen++;
    this.tripped = true;
    this.off(this.track);
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

  // Decides synchronously whenever it can (built-ins, a loaded scene list), so a
  // new track is attached before setTrack returns; only a scene list fetch waits.
  private apply(): Promise<void> {
    try {
      const gen = ++this.gen;
      const track = this.track;
      const id = this.snap.selected;
      if (!track) {
        this.set({ applied: "none", busy: false });
        return Promise.resolve();
      }
      if (this.tripped) return this.applyEffect(gen, track, id, null);
      const b = builtin(id);
      if (b) return this.applyEffect(gen, track, id, b.radius === undefined ? null : { kind: "blur", radius: b.radius });
      if (this.snap.scenesState === "ready") return this.applyEffect(gen, track, id, this.sceneEffect(id));
      return this.loadScenes().then(() => {
        if (gen === this.gen) return this.applyEffect(gen, track, id, this.sceneEffect(id));
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private applyEffect(gen: number, track: TrackLike, id: string, effect: NativeEffect | null): Promise<void> {
    if (!effect) {
      this.off(track);
      this.set({ applied: "none", busy: false });
      return Promise.resolve();
    }
    if (this.configured && this.configuredAt === Backgrounds.nativeGen && sameEffect(this.configured, effect)) {
      this.port.attach(track);
      this.set({ applied: id, busy: false });
      return Promise.resolve();
    }
    this.configured = null; // native is being reconfigured: unknown until this settles
    const mark = ++Backgrounds.nativeGen;
    this.set({ busy: true });
    return this.port.setEffect(effect).then(
      () => {
        if (gen !== this.gen) return;
        this.configured = effect;
        this.configuredAt = mark;
        this.port.attach(track);
        this.set({ applied: id, busy: false });
      },
      (e) => {
        if (gen !== this.gen) return;
        this.log.warn("[background] effect failed", e);
        this.off(track);
        this.set({ applied: "none", busy: false });
        this.notice(BG_TEXT.load);
      },
    );
  }

  // Detach (if there is a track) and free the native effect.
  private off(track: TrackLike | null) {
    if (track) this.port.detach(track);
    this.configured = null;
    Backgrounds.nativeGen++;
    this.port.clear();
  }

  private sceneEffect(id: string): NativeEffect | null {
    const scene = this.snap.scenes.find((s) => s.id === id);
    return scene ? { kind: "scene", url: scene.url } : null;
  }

  private set(patch: Partial<BgSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of [...this.listeners]) fn();
  }
}
