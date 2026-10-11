import type { Participant } from "./roster";

export type GridTile =
  | { kind: "person"; key: string; p: Participant }
  | { kind: "screen"; key: string; p: Participant }
  | { kind: "own-screen"; key: string };

const sharing = (p: Participant) => !!(p.screen || p.screenAudio);

// Your own share first (while sharing), then one tile per person, plus a screen
// tile right after anyone who is sharing.
export function gridTiles(people: Participant[], selfSharing = false): GridTile[] {
  const out: GridTile[] = selfSharing ? [{ kind: "own-screen", key: "self:screen" }] : [];
  for (const p of people) {
    out.push({ kind: "person", key: p.id, p });
    if (sharing(p)) out.push({ kind: "screen", key: `${p.id}:screen`, p });
  }
  return out;
}

export function screenFor(people: Participant[], id: string): Participant | null {
  const p = people.find((x) => x.id === id);
  return p && sharing(p) ? p : null;
}
