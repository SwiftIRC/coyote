// Saved preferences. Saves merge into what's stored so one screen saving its fields
// (the lobby: name, mic, camera) never resets another's (Data saver, Hide self-view).
export interface Prefs {
  name: string;
  email: string; // stays on the device; only its hash is sent
  mic: boolean;
  camera: boolean;
  dataSaver: boolean;
  hideSelf: boolean;
  background: string; // background effect id ("none", "blur", "blur-strong" or a scene id)
  debug: boolean; // hidden debug mode (core/debug.ts)
}

export const DEFAULT_PREFS: Prefs = { name: "", email: "", mic: true, camera: true, dataSaver: false, hideSelf: false, background: "none", debug: false };

export function mergePrefs(stored: unknown, patch: Partial<Prefs>): Prefs {
  const src = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS) as Array<keyof Prefs>) {
    const v = src[k];
    if (typeof v === typeof DEFAULT_PREFS[k]) (out as Record<string, unknown>)[k] = v;
  }
  return { ...out, ...patch };
}
