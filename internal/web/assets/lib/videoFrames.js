// How many frames a <video> has actually presented, or null when the browser cannot
// say. This, not currentTime, is the evidence that a remote camera is live: Chromium
// keeps advancing a MediaStream element's currentTime (and firing timeupdate) after
// the sender stops sending, with no new frame ever arriving — which is how a
// legitimate camera-off was mistaken for a missed broadcast and the last frame left
// frozen on screen.
export function presentedFrames(video) {
  if (!video || typeof video.getVideoPlaybackQuality !== "function") return null;
  const q = video.getVideoPlaybackQuality();
  return q && Number.isFinite(q.totalVideoFrames) ? q.totalVideoFrames : null;
}

// Whether a camera tile has shown NEW frames since `baseline` (a presentedFrames
// reading, or null for "not yet measured"). Unknown on either side is never progress:
// the self-heal only uncovers on proof.
export function framesAdvanced(baseline, now) {
  return baseline != null && now != null && now > baseline;
}
