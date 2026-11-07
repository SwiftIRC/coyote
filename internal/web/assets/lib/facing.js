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

// Which physical camera a track comes from, so a manual mirror flip can stay with
// the camera it was set for and fall away when you switch to a different one.
export function cameraKey(track) {
  if (!track) return null;
  const s = (typeof track.getSettings === "function" && track.getSettings()) || {};
  return s.deviceId || track.label || "";
}

// Whether YOUR OWN view of this camera is mirrored. Purely local: it never changes
// what anyone else sees. The default is a selfie flip for a front camera and none
// for a rear one; `flippedFor` (a cameraKey, or null) inverts that for the one
// camera the person flipped by hand.
export function selfMirrored(track, flippedFor) {
  const byDefault = !facesAway(track);
  const flipped = flippedFor != null && track != null && flippedFor === cameraKey(track);
  return flipped ? !byDefault : byDefault;
}
