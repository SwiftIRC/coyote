// Structural types for everything core/ is given by injection. They describe the
// subset of the WebSocket / react-native-webrtc API that core/ uses, so tests can
// supply fakes and core/ never imports a native module.

export type Frame = { type: string; [k: string]: any };

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const SOCKET_OPEN = 1;

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

export type Kind = "mic" | "camera" | "screen" | "screen-audio";

export interface TrackLike {
  readonly id: string;
  readonly kind: string; // "audio" | "video"
  enabled: boolean;
  stop(): void;
  getSettings?(): { height?: number };
  addEventListener?(type: "ended", fn: () => void): void;
}

export interface StreamLike {
  readonly id: string;
  getTracks(): TrackLike[];
  toURL?(): string; // react-native-webrtc: the RTCView streamURL
}

export interface CodecLike {
  mimeType: string;
  clockRate: number;
  channels?: number;
  sdpFmtpLine?: string;
}

export interface SenderLike {
  readonly track: TrackLike | null;
  replaceTrack(t: TrackLike | null): Promise<void>;
  getParameters(): { encodings?: Array<Record<string, unknown>> };
  setParameters(p: unknown): Promise<void>;
}

export interface TransceiverLike {
  readonly mid: string | null;
  readonly sender: SenderLike;
  setCodecPreferences?(codecs: CodecLike[]): void;
}

export interface SessionDescription {
  type: string;
  sdp: string;
}

export interface TrackEventLike {
  track: TrackLike;
  transceiver: { mid: string | null };
  streams: StreamLike[];
}

export interface PeerConnectionLike {
  readonly signalingState: string;
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly localDescription: SessionDescription | null;
  readonly remoteDescription: SessionDescription | null;
  addEventListener(type: "icecandidate", fn: (ev: { candidate: unknown | null }) => void): void;
  addEventListener(type: "track", fn: (ev: TrackEventLike) => void): void;
  addEventListener(type: "negotiationneeded" | "connectionstatechange" | "iceconnectionstatechange", fn: () => void): void;
  addTransceiver(track: TrackLike, init: { direction: "sendonly"; streams: StreamLike[] }): TransceiverLike;
  addTransceiver(kind: "audio", init: { direction: "recvonly" }): TransceiverLike;
  removeTrack(sender: SenderLike): void;
  createOffer(): Promise<SessionDescription>;
  createAnswer(): Promise<SessionDescription>;
  setLocalDescription(d: SessionDescription): Promise<void>;
  setRemoteDescription(d: SessionDescription): Promise<void>;
  addIceCandidate(c: unknown): Promise<void>;
  restartIce?(): void;
  close(): void;
}
