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
