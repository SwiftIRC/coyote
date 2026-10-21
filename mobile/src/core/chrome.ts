// The call's controls and top bar ("chrome") hide over full-screen video and come
// back on a touch, then hide again after a quiet spell.
export const CHROME_HIDE_MS = 4000;

// Times the controls stay up: a sheet is open, there's no one to look at yet, or a
// screen reader is on (vanishing buttons are hard to find without sight).
export function chromePinned(s: { phase: string; people: number; sheetOpen: boolean; screenReader: boolean }): boolean {
  return s.sheetOpen || s.screenReader || s.phase !== "in-call" || s.people === 0;
}

type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };

export class AutoHide {
  private timer: unknown = null;
  private pinned = false;
  visible = true;

  constructor(private onChange: (visible: boolean) => void, private timers: Timers = globalThis as unknown as Timers) {
    this.arm();
  }

  // A touch: show, and restart the countdown.
  poke(): void {
    this.show();
    this.arm();
  }

  setPinned(pinned: boolean): void {
    if (pinned === this.pinned) return;
    this.pinned = pinned;
    if (pinned) this.show();
    this.arm();
  }

  dispose(): void {
    this.clear();
  }

  private show(): void {
    if (this.visible) return;
    this.visible = true;
    this.onChange(true);
  }

  private arm(): void {
    this.clear();
    if (this.pinned) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.visible = false;
      this.onChange(false);
    }, CHROME_HIDE_MS);
  }

  private clear(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
