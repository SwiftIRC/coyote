import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { EffectPort, NativeEffect, TripReason } from "../core/backgrounds";
import type { TrackLike } from "../core/types";

const { CoyoteBackground } = NativeModules;

// The processor CoyoteBackground registers with react-native-webrtc's ProcessorProvider.
export const PROCESSOR = "coyote-background";

type EffectsTrack = TrackLike & { _setVideoEffects?(names: string[] | null): void };

function setVideoEffects(track: TrackLike, names: string[] | null) {
  const t = track as EffectsTrack;
  if (typeof t._setVideoEffects !== "function") return;
  try {
    t._setVideoEffects(names);
  } catch (e) {
    console.warn("setting video effects failed", e);
  }
}

export const effectPort: EffectPort = {
  setEffect: (e: NativeEffect) =>
    CoyoteBackground ? CoyoteBackground.setEffect(e) : Promise.reject(new Error("CoyoteBackground native module missing")),
  attach: (track) => setVideoEffects(track, [PROCESSOR]),
  // Android: null removes the processor (an empty list over-releases frames in
  // react-native-webrtc 124). iOS: the native side takes a nonnull array.
  detach: (track) => setVideoEffects(track, Platform.OS === "android" ? null : []),
};

export function onBackgroundTripped(fn: (reason: TripReason) => void): () => void {
  if (!CoyoteBackground) return () => {};
  const sub = new NativeEventEmitter(CoyoteBackground).addListener("CoyoteBackgroundTripped", (e) => {
    const reason = (e as { reason?: unknown })?.reason;
    if (reason === "slow" || reason === "failed") fn(reason);
  });
  return () => sub.remove();
}
