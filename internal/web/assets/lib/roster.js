// Roster reconciliation for a re-join. DOM-free so it can be unit tested.
//
// reconcileRoster(knownIds, peers, selfId, priorSelfId) -> { departed, peers }.
// A reconnect re-join must REPLACE our roster, not add to it: after a server restart
// every participant has a new id, and the new server cannot send peer-left for ids it
// never issued, so add-only left each old tile beside its new one.
//   departed: ids we hold a tile for that the fresh roster no longer lists (never
//     selfId) — drop them.
//   peers: the roster to add, minus our own previous id. Every join mints a fresh id,
//     and on an ordinary reconnect our old session lingers in the room as a ghost
//     until its dead socket times out, so the roster can still list it — that is us,
//     not someone to draw a tile for.
export function reconcileRoster(knownIds, peers, selfId, priorSelfId) {
  const fresh = (peers || []).filter((p) => p && p.id && p.id !== selfId && p.id !== priorSelfId);
  const present = new Set(fresh.map((p) => p.id));
  const departed = [...knownIds].filter((id) => id !== selfId && !present.has(id));
  return { departed, peers: fresh };
}
