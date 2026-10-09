import { parseInvite, parseToken } from "../shared/web";

export const DEFAULT_HOST = "vc.swiftirc.net";
// The server's slug rule (internal/server/server.go).
export const SLUG_RE = /^[a-z0-9-]{1,32}$/;

export interface RoomLink {
  origin: string; // "https://host[:port]"
  host: string; // "host[:port]"
  slug: string;
  invite: string; // #i= id, "" if none
  token: string; // #t= token, "" if none or an invite is present
}

// scheme, host, path, fragment. React Native's URL has no pathname/hash getters.
const URL_RE = /^(https?):\/\/([^/?#\s]+)\/?([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/i;

// parseRoomInput accepts a full room link (any host) or a bare room name (default
// host). Returns null for anything that is not exactly one valid slug segment, so a
// tapped link to /api/... or /ws/... opens Home rather than a room.
export function parseRoomInput(input: string, defaultHost: string = DEFAULT_HOST): RoomLink | null {
  const text = (input || "").trim();
  if (!text) return null;
  const m = URL_RE.exec(text);
  if (!m) {
    const slug = text.toLowerCase();
    if (!SLUG_RE.test(slug)) return null;
    return { origin: `https://${defaultHost}`, host: defaultHost, slug, invite: "", token: "" };
  }
  const [, scheme, host, rawPath, fragment = ""] = m;
  const path = rawPath.replace(/\/+$/, "").toLowerCase();
  if (!path || path.includes("/") || !SLUG_RE.test(path)) return null;
  const invite = parseInvite(fragment);
  return {
    origin: `${scheme.toLowerCase()}://${host.toLowerCase()}`,
    host: host.toLowerCase(),
    slug: path,
    invite,
    token: invite ? "" : parseToken(fragment),
  };
}

export function wsUrl(link: RoomLink): string {
  return `${link.origin.replace(/^http/, "ws")}/ws/${link.slug}`;
}

export function isDefaultHost(link: RoomLink): boolean {
  return link.host === DEFAULT_HOST;
}
