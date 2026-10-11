import { NativeEventEmitter, NativeModules } from "react-native";
import type { ChimeName } from "../core/chimes";

const { CoyoteSounds } = NativeModules;

const CHIME_FILES: Record<ChimeName, string> = { join: "door_open", drop: "sounds_drop", bloop: "sounds_bloop" };
let chimesLoaded = false;

function preloadChimes(): void {
  if (chimesLoaded || !CoyoteSounds) return;
  chimesLoaded = true;
  for (const [name, file] of Object.entries(CHIME_FILES)) CoyoteSounds.preload(`chime:${name}`, `asset:${file}`);
}

// Best-effort: a missing chime never affects the call.
export function playChime(n: ChimeName): void {
  if (!CoyoteSounds) return;
  try {
    preloadChimes();
    CoyoteSounds.play(`chime:${n}`);
  } catch (e) {
    console.warn("chime failed", e);
  }
}

// For the soundboard (2b): fires when a clip finishes on its own.
export function onSoundEnded(fn: (id: string) => void): () => void {
  if (!CoyoteSounds) return () => {};
  const sub = new NativeEventEmitter(CoyoteSounds).addListener("CoyoteSoundEnded", (e) => fn((e as { id: string }).id));
  return () => sub.remove();
}

// Soundboard clips: stubs until the native implementation lands (Task 9).
export function loadClip(_id: string, _url: string): void {}
export function playClip(_id: string): void {}
export function stopClip(_id: string): void {}
