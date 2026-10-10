export interface SystemCallTarget {
  onSystemMute(muted: boolean): unknown;
  onSystemEnd(): void;
  onHold(held: boolean): unknown;
}

// CallKit / ConnectionService events carry a call UUID. Only the active call may
// react; iOS upper-cases UUIDs, so ids compare case-insensitively.
export class SystemCallRouter {
  private current: string | null = null;

  track(callId: string): void {
    this.current = callId.toLowerCase();
  }

  clear(callId: string): void {
    if (this.is(callId)) this.current = null;
  }

  mute(callId: string, muted: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) t.onSystemMute(muted);
  }

  end(callId: string, t: SystemCallTarget): void {
    if (this.is(callId)) t.onSystemEnd();
  }

  hold(callId: string, held: boolean, t: SystemCallTarget): void {
    if (this.is(callId)) t.onHold(held);
  }

  endCurrent(t: SystemCallTarget): void {
    if (this.current) t.onSystemEnd();
  }

  private is(callId: string): boolean {
    return !!this.current && !!callId && callId.toLowerCase() === this.current;
  }
}
