import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RoomLink } from "../core/link";
import { mergeRecent, removeRecent, type RecentRoom } from "../core/recent";
import { mergePrefs, type Prefs } from "../core/prefs";
export type { Prefs } from "../core/prefs";

const PREFS_KEY = "coyote.prefs.v1";
const RECENT_KEY = "coyote.recent.v1";

async function readPrefs(): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadPrefs(): Promise<Prefs> {
  return mergePrefs(await readPrefs(), {});
}

// Merges `patch` into the stored preferences and returns the result.
export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = mergePrefs(await readPrefs(), patch);
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export async function loadRecent(): Promise<RecentRoom[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function rememberRoom(link: RoomLink): Promise<RecentRoom[]> {
  const next = mergeRecent(await loadRecent(), link, Date.now());
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export async function forgetRoom(room: Pick<RecentRoom, "host" | "slug">): Promise<RecentRoom[]> {
  const next = removeRecent(await loadRecent(), room);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
