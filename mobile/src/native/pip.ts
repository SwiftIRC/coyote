import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { PipAction, PipParams } from "../core/pip";

// Android picture-in-picture (CoyotePip). A no-op on iOS and when the module is
// missing; watchVisibility then returns null so callers can fall back to AppState.
const native = Platform.OS === "android" ? NativeModules.CoyotePip ?? null : null;
let emitter: NativeEventEmitter | null = null;

function on(event: string, fn: (e: Record<string, unknown>) => void): () => void {
  if (!native) return () => {};
  emitter ??= new NativeEventEmitter(native);
  const sub = emitter.addListener(event, (e: unknown) => fn((e ?? {}) as Record<string, unknown>));
  return () => sub.remove();
}

export function setPip(p: PipParams): void {
  native?.setPip(p.enabled, p.micOn, p.aspect);
}

export function watchPip(fn: (inPip: boolean) => void): () => void {
  return on("CoyotePipChanged", (e) => fn(e.inPip === true));
}

export function watchPipActions(fn: (a: PipAction) => void): () => void {
  return on("CoyotePipAction", (e) => {
    if (e.action === "mic" || e.action === "hangup") fn(e.action);
  });
}

// The activity's on-screen state (onStart / onStop).
export function watchVisibility(fn: (visible: boolean) => void): (() => void) | null {
  if (!native) return null;
  return on("CoyotePipVisibility", (e) => {
    if (typeof e.visible === "boolean") fn(e.visible);
  });
}
