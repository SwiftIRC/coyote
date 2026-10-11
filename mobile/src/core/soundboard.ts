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
