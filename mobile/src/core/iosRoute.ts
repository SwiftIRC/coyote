import type { AudioRoutes } from "./audioRoutes";

// iOS only exposes speaker on/off, so the route list is fixed and `selected`
// follows the speaker flag. Video calls start on the speaker, audio-only on the earpiece.
export function iosRoutes(speaker: boolean): AudioRoutes {
  return { available: ["EARPIECE", "SPEAKER_PHONE"], selected: speaker ? "SPEAKER_PHONE" : "EARPIECE" };
}

export function iosInitialSpeaker(video: boolean): boolean {
  return video;
}
