// Whether a camera track faces away from the user (a phone's rear camera). A
// selfie view is mirrored so it behaves like a mirror; a rear camera shows the
// world in front of you and must NOT be flipped, or text reads backwards.
//
// Only an explicit "environment" counts. Desktop webcams usually report no
// facingMode at all, and those face the user, so they stay mirrored.
export function facesAway(track) {
  if (!track || typeof track.getSettings !== "function") return false;
  const s = track.getSettings() || {};
  return s.facingMode === "environment";
}
