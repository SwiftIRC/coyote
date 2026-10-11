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

// Removes one room from history (the Home screen's ×). Matches by host + slug,
// like mergeRecent's de-duplication.
export function removeRecent(list: RecentRoom[], room: Pick<RecentRoom, "host" | "slug">): RecentRoom[] {
  return list.filter((r) => !(r.host === room.host && r.slug === room.slug));
}

export function recentInput(r: RecentRoom): string {
  return `${r.origin}/${r.slug}`;
}
