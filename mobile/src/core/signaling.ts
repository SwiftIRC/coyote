// WebSocket signaling: port of internal/web/assets/net/signaling.js.
//
// Security-critical, as on the web: reconnect happens on ANY close except after
// stop(). kicked/banned/leave call stop(); server-restarting does not.
//
// Differences from the web client, both about reconnects:
//  - onOpen hooks (the join frame) run BEFORE queued frames flush, so join is always
//    the first frame the server sees on a socket.
//  - The outbound queue is dropped on an unexpected close: anything queued belongs to
//    a dead server session (an old peer's offer or candidates). State that matters is
//    re-sent by the join frame and the rebuilt peer.
import { encode, decode, backoffDelay } from "../shared/web";
import { SOCKET_OPEN, type Frame, type Logger, type SocketLike, type Timers } from "./types";

const JITTER_MS = 250;

export interface SignalingDeps extends Timers {
  createSocket(url: string): SocketLike;
  random(): number;
  log: Logger;
}

export type Handler = (msg: Frame) => void;

export class Signaling {
  private handlers = new Map<string, Handler[]>();
  private openHooks: Array<() => void> = [];
  private closeHooks: Array<() => void> = [];
  private queue: string[] = [];
  private attempt = 0;
  private ws: SocketLike | null = null;
  private reconnectTimer: unknown = null;
  private _stopped = false;
  // Set when the session that queued frames is gone (unexpected close, reconnectNow):
  // sends are dropped, not queued, until the next open.
  private sessionDead = false;

  constructor(readonly url: string, private deps: SignalingDeps) {}

  get stopped(): boolean {
    return this._stopped;
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === SOCKET_OPEN;
  }

  onOpen(fn: () => void): void {
    this.openHooks.push(fn);
  }

  onClose(fn: () => void): void {
    this.closeHooks.push(fn);
  }

  on(type: string, fn: Handler): this {
    const list = this.handlers.get(type) || [];
    list.push(fn);
    this.handlers.set(type, list);
    return this;
  }

  off(type: string, fn: Handler): this {
    const list = this.handlers.get(type);
    if (list) {
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    }
    return this;
  }

  connect(): void {
    if (this._stopped) return;
    const ws = this.deps.createSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.deps.log.info(`[signaling] open${this.attempt ? ` after ${this.attempt} failed attempt(s)` : ""}`);
      this.attempt = 0;
      this.sessionDead = false;
      for (const hook of this.openHooks) hook(); // join first
      const pending = this.queue;
      this.queue = [];
      for (const frame of pending) ws.send(frame);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: Frame;
      try {
        msg = decode(String(ev.data));
      } catch {
        return;
      }
      this.dispatch(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // a socket we already replaced or stopped
      this.ws = null;
      if (this._stopped) return;
      this.deps.log.warn(`[signaling] closed unexpectedly code=${ev?.code ?? "?"} — will reconnect`);
      this.queue = [];
      this.sessionDead = true;
      for (const hook of this.closeHooks) hook();
      this.scheduleReconnect();
    };
    ws.onerror = () => this.deps.log.warn("[signaling] socket error (a close, and a reconnect, follow)");
  }

  send(type: string, fields: Record<string, unknown> = {}): void {
    const frame = encode(type, fields);
    if (this.ws && this.ws.readyState === SOCKET_OPEN) this.ws.send(frame);
    else if (!this.sessionDead) this.queue.push(frame);
  }

  stop(): void {
    this._stopped = true;
    this.cancelTimer();
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  // Reconnect immediately: app foregrounded, network changed, or the media plane
  // failed. Replaces an open socket too (the server then builds a fresh session).
  reconnectNow(): void {
    if (this._stopped) return;
    this.cancelTimer();
    this.attempt = 0;
    const old = this.ws;
    this.ws = null; // detach first so its late close is ignored
    old?.close();
    this.queue = [];
    this.sessionDead = true;
    this.connect();
  }

  private dispatch(msg: Frame) {
    for (const fn of [...(this.handlers.get(msg.type) || [])]) fn(msg);
    for (const fn of [...(this.handlers.get("*") || [])]) fn(msg);
  }

  private cancelTimer() {
    if (this.reconnectTimer !== null) {
      this.deps.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    const delay = backoffDelay(this.attempt) + Math.floor(this.deps.random() * JITTER_MS);
    this.attempt += 1;
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
