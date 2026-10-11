// The room timer: `joined.roomAge` is the seconds since the server created the room;
// we turn it into a start time and count up with the local clock, as the web does.
export class RoomClock {
  private startMs: number | null = null;
  private listeners = new Set<() => void>();

  anchor(roomAgeSec: number | undefined, nowMs: number): void {
    const ok = typeof roomAgeSec === "number" && Number.isFinite(roomAgeSec) && roomAgeSec >= 0;
    this.set(ok ? nowMs - roomAgeSec * 1000 : null);
  }

  reset(): void {
    this.set(null);
  }

  elapsed(nowMs: number): number | null {
    return this.startMs === null ? null : Math.max(0, Math.floor((nowMs - this.startMs) / 1000));
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number | null => this.startMs;

  private set(v: number | null) {
    if (v === this.startMs) return;
    this.startMs = v;
    for (const fn of [...this.listeners]) fn();
  }
}
