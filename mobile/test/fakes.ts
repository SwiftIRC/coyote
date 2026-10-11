import type {
  CodecLike, Frame, PeerConnectionLike, SenderLike, SessionDescription, StreamLike, TrackLike, TransceiverLike,
} from "../src/core/types";
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

export class FakeSig {
  sent: Frame[] = [];
  handlers = new Map<string, Array<(m: Frame) => void>>();
  on(t: string, fn: (m: Frame) => void) {
    this.handlers.set(t, [...(this.handlers.get(t) || []), fn]);
    return this;
  }
  off(t: string, fn: (m: Frame) => void) {
    this.handlers.set(t, (this.handlers.get(t) || []).filter((f) => f !== fn));
    return this;
  }
  send(type: string, fields: Record<string, unknown> = {}) {
    this.sent.push({ type, ...fields });
  }
  receive(frame: Frame) {
    for (const fn of [...(this.handlers.get(frame.type) || [])]) fn(frame);
  }
  ofType(t: string) {
    return this.sent.filter((f) => f.type === t);
  }
  handlerCount() {
    return [...this.handlers.values()].reduce((n, l) => n + l.length, 0);
  }
}

let trackSeq = 0;
export class FakeTrack implements TrackLike {
  readonly id = `t${++trackSeq}`;
  enabled = true;
  stopped = false;
  released = false;
  private ended: Array<() => void> = [];
  constructor(readonly kind: string, private height = 720, private width = 1280) {}
  stop() {
    this.stopped = true;
  }
  release() {
    this.released = true;
  }
  getSettings() {
    return { height: this.height, width: this.width };
  }
  addEventListener(_t: "ended", fn: () => void) {
    this.ended.push(fn);
  }
  end() {
    for (const fn of this.ended) fn();
  }
}

let streamSeq = 0;
export class FakeStream implements StreamLike {
  readonly id = `s${++streamSeq}`;
  constructor(private tracks: TrackLike[]) {}
  getTracks() {
    return this.tracks;
  }
  toURL() {
    return `url-${this.id}`;
  }
}

export class FakeSender implements SenderLike {
  params: { encodings: Array<Record<string, unknown>> } = { encodings: [] };
  setParams: any[] = [];
  constructor(public track: TrackLike | null) {}
  async replaceTrack(t: TrackLike | null) {
    this.track = t;
  }
  getParameters() {
    return JSON.parse(JSON.stringify(this.params));
  }
  async setParameters(p: any) {
    this.setParams.push(p);
  }
}

export class FakeTransceiver implements TransceiverLike {
  readonly sender: FakeSender;
  codecPrefs: CodecLike[] | null = null;
  constructor(
    public mid: string | null,
    track: TrackLike | null,
    public streams: StreamLike[],
    public kind: string = track?.kind ?? "",
    public direction: "sendonly" | "recvonly" = "sendonly",
  ) {
    this.sender = new FakeSender(track);
  }
  setCodecPreferences(c: CodecLike[]) {
    this.codecPrefs = c;
  }
}

// A small RTCPeerConnection model: just enough signaling-state machine for perfect
// negotiation, with implicit rollback on setRemoteDescription(offer).
export class FakePC implements PeerConnectionLike {
  signalingState = "stable";
  connectionState = "new";
  iceConnectionState = "new";
  localDescription: SessionDescription | null = null;
  remoteDescription: SessionDescription | null = null;
  transceivers: FakeTransceiver[] = [];
  removed: SenderLike[] = [];
  candidates: unknown[] = [];
  srdCalls: SessionDescription[] = [];
  restarts = 0;
  closed = false;
  private offers = 0;
  private listeners = new Map<string, Array<(ev?: any) => void>>();
  addEventListener(type: string, fn: (ev?: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
  }
  emit(type: string, ev?: any) {
    for (const fn of this.listeners.get(type) || []) fn(ev);
  }
  addTransceiver(trackOrKind: TrackLike | "audio", init: { direction: "sendonly"; streams: StreamLike[] } | { direction: "recvonly" }) {
    const mid = String(this.transceivers.length);
    const t = typeof trackOrKind === "string"
      ? new FakeTransceiver(mid, null, [], trackOrKind, "recvonly")
      : new FakeTransceiver(mid, trackOrKind, "streams" in init ? init.streams : []);
    this.transceivers.push(t);
    return t;
  }
  removeTrack(sender: SenderLike) {
    this.removed.push(sender);
  }
  async createOffer() {
    return { type: "offer", sdp: `offer-${++this.offers}` };
  }
  async createAnswer() {
    return { type: "answer", sdp: `answer-to-${this.remoteDescription?.sdp}` };
  }
  async setLocalDescription(d: SessionDescription) {
    this.localDescription = d;
    this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    if (d.type === "answer") this.negotiated();
  }
  async setRemoteDescription(d: SessionDescription) {
    if ((d as any).type === "rollback") throw new Error("explicit rollback is forbidden");
    this.srdCalls.push(d);
    this.remoteDescription = d;
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable"; // offer: implicit rollback
    if (d.type === "answer") this.negotiated();
  }
  async addIceCandidate(c: unknown) {
    if (!this.remoteDescription) throw new Error("no remote description");
    this.candidates.push(c);
  }
  restartIce() {
    this.restarts++;
  }
  close() {
    this.closed = true;
  }
  setConnection(state: string, ice = state) {
    this.connectionState = state;
    this.iceConnectionState = ice;
    this.emit("connectionstatechange");
    this.emit("iceconnectionstatechange");
  }
  // After negotiation a real sender has one encoding.
  private negotiated() {
    for (const t of this.transceivers) if (t.sender.params.encodings.length === 0) t.sender.params.encodings = [{}];
  }
}

export const flush = () => new Promise((r) => setTimeout(() => r(undefined), 0));
