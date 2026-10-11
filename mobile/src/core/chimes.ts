// Join/leave/share chimes. Join and leave go through the web's Presence (by session
// ref), so a reconnect is silent and a leave waits 6 s for a quick rejoin. A share
// bloops when it first appears; the sharing set survives our own rejoin, so the
// share's tracks re-arriving on the new peer don't bloop again.
import { Presence } from "../shared/web";
import type { Timers } from "./types";

export type ChimeName = "join" | "drop" | "bloop";

export class Chimes {
  private presence: Presence;
  private sharing = new Set<string>();

  constructor(private play: (n: ChimeName) => void, timers: Timers) {
    this.presence = new Presence({
      onJoinChime: () => play("join"),
      onDropChime: () => play("drop"),
      // presence.js defaults `timers` to globalThis, so allowJs infers that type; it
      // only ever calls setTimeout/clearTimeout.
      timers: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } as unknown as typeof globalThis,
    });
  }

  seed(peers: Array<{ ref?: string }>): void {
    this.presence.seed(peers);
  }

  joined(ref: string): void {
    this.presence.joined(ref);
  }

  left(ref: string): void {
    if (ref) this.sharing.delete(ref);
    this.presence.left(ref);
  }

  shareStarted(ref: string): void {
    if (ref && this.sharing.has(ref)) return;
    if (ref) this.sharing.add(ref);
    this.play("bloop");
  }

  shareStopped(ref: string): void {
    this.sharing.delete(ref);
  }

  dispose(): void {
    this.presence.clear();
    this.sharing.clear();
  }
}
