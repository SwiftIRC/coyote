import { SOCKET_OPEN, type Logger, type SocketLike, type Timers } from "../src/core/types";

export const silentLog: Logger = { info() {}, warn() {}, error() {} };

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  static last(): FakeSocket {
    return FakeSocket.all[FakeSocket.all.length - 1];
  }
  send(data: string) {
    if (this.readyState !== SOCKET_OPEN) throw new Error("send on non-open socket");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // test drivers
  open() {
    this.readyState = SOCKET_OPEN;
    this.onopen?.();
  }
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  types(): string[] {
    return this.sent.map((f) => f.type);
  }
}

// Manual timers: advance(ms) runs everything due, in order.
export class FakeTimers implements Timers {
  now = 0;
  private seq = 0;
  private due = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.due.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.due.delete(h as number);
  };
  pending(): number {
    return this.due.size;
  }
  advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const next = [...this.due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
    }
    this.now = until;
  }
}
