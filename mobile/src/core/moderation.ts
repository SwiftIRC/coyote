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

  constructor(
    private sender: Sender,
    private isOp: () => boolean,
  ) {}

  // On every joined. An older server omits `locked`: the first join falls back to
  // PreJoin's peek; a rejoin keeps what the broadcasts already told us.
  seed(joined: Frame, peekLocked: boolean, first: boolean): void {
    const locked =
      typeof joined.locked === "boolean" ? joined.locked : first ? peekLocked : this.snap.locked;
    const q = joined.quality || {};
    this.set({ locked, quality: { camera: tierOf(q.camera), screen: tierOf(q.screen) } });
  }

  onLocked(locked: boolean): void {
    if (locked !== this.snap.locked) this.set({ ...this.snap, locked });
  }

  onQuality(m: Frame): void {
    this.set({ ...this.snap, quality: { camera: tierOf(m.camera), screen: tierOf(m.screen) } });
  }

  muteMic(id: string): ModResult {
    return this.toPeer("mute-peer", id, { kind: "mic" });
  }
  stopShare(id: string): ModResult {
    return this.toPeer("mute-peer", id, { kind: "screen" });
  }
  grantOp(id: string): ModResult {
    return this.toPeer("grant-op", id);
  }
  kick(id: string): ModResult {
    return this.toPeer("kick", id);
  }
  ban(id: string): ModResult {
    return this.toPeer("ban", id);
  }

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
