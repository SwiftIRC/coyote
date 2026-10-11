import type { Logger } from "./types";

export interface SystemCallTarget {
  onSystemMute(muted: boolean): unknown;
  onSystemEnd(): void;
  onHold(held: boolean): unknown;
}

// CallKit / ConnectionService events carry a call UUID. Only the active call may
// react. callkeep lowercases iOS UUIDs (RNCallKeep.m) while CallKit itself reports
// them upper-case, so ids compare case-insensitively to guard both.
export class SystemCallRouter {
  private current: string | null = null;

  constructor(private log: Logger) {}

  track(callId: string): void {
    this.current = callId.toLowerCase();
  }

  clear(callId: string): void {
    if (this.is(callId)) this.current = null;
  }

  mute(callId: string, muted: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) this.contain("mute", () => t.onSystemMute(muted));
  }

  end(callId: string, t: SystemCallTarget): void {
    if (this.is(callId)) this.contain("end", () => t.onSystemEnd());
  }

  hold(callId: string, held: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) this.contain("hold", () => t.onHold(held));
  }

  endCurrent(t: SystemCallTarget): void {
    if (this.current) this.contain("end", () => t.onSystemEnd());
  }

  // Native event callbacks have no caller to catch: log sync throws and async rejections.
  private contain(what: string, fn: () => unknown): void {
    try {
      Promise.resolve(fn()).catch((e) => this.log.warn(`system call ${what} failed`, e));
    } catch (e) {
      this.log.warn(`system call ${what} failed`, e);
    }
  }

  private is(callId: string): boolean {
    return !!this.current && !!callId && callId.toLowerCase() === this.current;
  }
}
