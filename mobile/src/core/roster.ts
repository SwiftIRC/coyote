import type { StreamLike } from "./types";

// A participant as the server describes it (signal.PeerInfo / PeerJoined).
export interface PeerInfo {
  id: string;
  name: string;
  role: string;
  mic: boolean;
  camera: boolean;
  ref?: string;
  gravatar?: string;
}

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
}

type StreamSlot = "video" | "audio";
const slotFor = (kind: "camera" | "mic"): StreamSlot => (kind === "camera" ? "video" : "audio");

// The other participants in the room (the server never lists self). Objects are
// replaced on every change so UI memoisation can compare by identity.
export class Roster {
  private map = new Map<string, Participant>();
  // Remote media can be labelled before peer-joined is processed; hold it until then.
  private early = new Map<string, Partial<Record<StreamSlot, StreamLike>>>();
  private listeners = new Set<() => void>();

  seed(peers: PeerInfo[]): void {
    this.map.clear();
    this.early.clear();
    for (const p of peers) this.map.set(p.id, this.fromInfo(p, null));
    this.notify();
  }

  upsert(p: PeerInfo): void {
    this.map.set(p.id, this.fromInfo(p, this.map.get(p.id) || null));
    this.notify();
  }

  remove(id: string): void {
    this.early.delete(id);
    if (this.map.delete(id)) this.notify();
  }

  patch(id: string, fields: Partial<Pick<Participant, "name" | "role" | "mic" | "camera">>): void {
    const p = this.map.get(id);
    if (!p) return;
    this.map.set(id, { ...p, ...fields });
    this.notify();
  }

  setStream(id: string, kind: "camera" | "mic", stream: StreamLike | null): void {
    const slot = slotFor(kind);
    const p = this.map.get(id);
    if (!p) {
      if (stream) this.early.set(id, { ...this.early.get(id), [slot]: stream });
      return;
    }
    this.map.set(id, { ...p, [slot]: stream });
    this.notify();
  }

  list(): Participant[] {
    return [...this.map.values()];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fromInfo(p: PeerInfo, prev: Participant | null): Participant {
    const early = this.early.get(p.id);
    this.early.delete(p.id);
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      mic: p.mic,
      camera: p.camera,
      ref: p.ref || "",
      gravatar: p.gravatar || "",
      video: early?.video ?? prev?.video ?? null,
      audio: early?.audio ?? prev?.audio ?? null,
    };
  }

  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
}
