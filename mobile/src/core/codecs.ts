import type { CodecLike } from "./types";

// The SFU registers only VP8 (and Opus). react-native-webrtc may prefer H.264, which
// the SFU would reject, so VP8 is moved to the front of the video codec preferences.
export function preferVp8(codecs: CodecLike[]): CodecLike[] {
  const isVp8 = (c: CodecLike) => c.mimeType.toLowerCase() === "video/vp8";
  if (!codecs.some(isVp8)) return codecs;
  return [...codecs.filter(isVp8), ...codecs.filter((c) => !isVp8(c))];
}
