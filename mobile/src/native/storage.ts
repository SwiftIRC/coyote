import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RoomLink } from "../core/link";
import { mergeRecent, removeRecent, type RecentRoom } from "../core/recent";

export interface Prefs {
  name: string;
  email: string; // stays on the device; only its hash is sent
  mic: boolean;
  camera: boolean;
}

const PREFS_KEY = "coyote.prefs.v1";
const RECENT_KEY = "coyote.recent.v1";
export const DEFAULT_PREFS: Prefs = { name: "", email: "", mic: true, camera: true };

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export async function loadPrefs(): Promise<Prefs> {
  return readJSON(PREFS_KEY, DEFAULT_PREFS);
}

export async function savePrefs(p: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p));
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
