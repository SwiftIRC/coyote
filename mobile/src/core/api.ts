import type { RoomLink } from "./link";

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

// GET /api/rooms/{slug} -> {count, locked}; null when unreachable.
export async function peekRoom(f: Fetcher, link: RoomLink): Promise<{ count: number; locked: boolean } | null> {
  try {
    const res = await f(`${link.origin}/api/rooms/${link.slug}`);
    if (!res.ok) return null;
    const j = await res.json();
    return { count: Number(j?.count) || 0, locked: !!j?.locked };
  } catch {
    return null;
  }
}

export type InvitePeek = { status: "ok"; name: string } | { status: "invalid" } | { status: "unknown" };

// GET /api/invite/{id} -> {name}; 404 means unknown or expired. Does not consume the invite.
export async function peekInvite(f: Fetcher, link: RoomLink): Promise<InvitePeek> {
  try {
    const res = await f(`${link.origin}/api/invite/${encodeURIComponent(link.invite)}`);
    if (res.status === 404) return { status: "invalid" };
    if (!res.ok) return { status: "unknown" };
    const j = await res.json();
    return typeof j?.name === "string" ? { status: "ok", name: j.name } : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export async function serverVersion(f: Fetcher, origin: string): Promise<string> {
  try {
    const res = await f(`${origin}/api/version`);
    if (!res.ok) return "";
    const j = await res.json();
    return typeof j?.version === "string" ? j.version : "";
  } catch {
    return "";
  }
}

// GET /api/soundboard -> [{id, label, src}]; null when unreachable or malformed.
export async function fetchSoundboard(f: Fetcher, origin: string): Promise<unknown[] | null> {
  try {
    const res = await f(`${origin}/api/soundboard`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

// GET /api/scenes -> [{id, label, src}]; null when unreachable or malformed.
export async function fetchScenes(f: Fetcher, origin: string): Promise<unknown[] | null> {
  try {
    const res = await f(`${origin}/api/scenes`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}
