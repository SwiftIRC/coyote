import type { RoomLink } from "./link";

export interface RecentRoom {
  origin: string;
  host: string;
  slug: string;
  at: number; // ms since epoch
}

const MAX_RECENT = 10;

// Recently joined rooms, newest first. Invites and tokens are never stored: an #i=
// invite is single-use, and a recent entry re-joins as a plain room link.
export function mergeRecent(list: RecentRoom[], link: RoomLink, now: number, max = MAX_RECENT): RecentRoom[] {
  const entry: RecentRoom = { origin: link.origin, host: link.host, slug: link.slug, at: now };
  const rest = list.filter((r) => !(r.host === link.host && r.slug === link.slug));
  return [entry, ...rest].slice(0, max);
}

export function recentInput(r: RecentRoom): string {
  return `${r.origin}/${r.slug}`;
}
