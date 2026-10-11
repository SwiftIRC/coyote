// Per-participant listening volume for this call (not saved), keyed by participant id.
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;
export const VOLUME_STEP = 0.05;

export class Volumes {
  private snap: Record<string, number> = {};
  private listeners = new Set<() => void>();

  get(id: string): number {
    return this.snap[id] ?? 1;
  }

  set(id: string, v: number): void {
    const clamped = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Number.isFinite(v) ? v : 1));
    const stepped = Math.round(clamped / VOLUME_STEP) * VOLUME_STEP;
    const value = Math.round(stepped * 100) / 100;
    if (this.snap[id] === value) return;
    this.snap = { ...this.snap, [id]: value };
    for (const fn of [...this.listeners]) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): Record<string, number> => this.snap;
}
