import type { StreamLike } from "../core/types";

// libwebrtc per-track gain (react-native-webrtc `_setVolume`, native on both
// platforms). 1 = 100%; we allow up to 2 (200%), as the web does.
export function setStreamVolume(stream: StreamLike | null, volume: number): void {
  const v = Math.max(0, Math.min(2, volume));
  for (const t of stream?.getTracks() ?? []) {
    const fn = (t as unknown as { _setVolume?: (v: number) => void })._setVolume;
    if (typeof fn === "function") fn.call(t, v);
  }
}
