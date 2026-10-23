import type { Participant } from "./roster";

export type GridTile =
  | { kind: "person"; key: string; p: Participant }
  | { kind: "screen"; key: string; p: Participant }
  | { kind: "own-screen"; key: string };

const sharing = (p: Participant) => !!(p.screen || p.screenAudio);

// One tile per person, plus a screen tile right after anyone who is sharing, then
// your own share last (while sharing): it only says you're sharing.
export function gridTiles(people: Participant[], selfSharing = false): GridTile[] {
  const out: GridTile[] = [];
  for (const p of people) {
    out.push({ kind: "person", key: p.id, p });
    if (sharing(p)) out.push({ kind: "screen", key: `${p.id}:screen`, p });
  }
  if (selfSharing) out.push({ kind: "own-screen", key: "self:screen" });
  return out;
}

export function screenFor(people: Participant[], id: string): Participant | null {
  const p = people.find((x) => x.id === id);
  return p && sharing(p) ? p : null;
}

// The full-screen viewer: someone's screenshare, or their camera to look closely
// at something they're holding up.
export type Viewing = { kind: "screen" | "camera"; id: string };

// A camera can be opened only while it has video to show.
export function cameraFor(people: Participant[], id: string, dataSaver: boolean): Participant | null {
  const p = people.find((x) => x.id === id);
  return p && !dataSaver && p.camera && p.video?.toURL ? p : null;
}

// What the viewer shows, or null once it has nothing left to show.
export function viewedFor(people: Participant[], v: Viewing | null, dataSaver: boolean): { kind: Viewing["kind"]; p: Participant } | null {
  if (!v) return null;
  const p = v.kind === "screen" ? screenFor(people, v.id) : cameraFor(people, v.id, dataSaver);
  return p ? { kind: v.kind, p } : null;
}
