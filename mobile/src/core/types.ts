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
