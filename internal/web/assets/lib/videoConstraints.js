// The video constraints for a camera capture, in one place so the acquisition sites
// cannot drift apart (the camera counterpart of audioConstraints.js).
//
// cameraConstraints(cameraId, {exact, target}) -> a MediaTrackConstraints object for
// `video`. `target` is captureTarget()'s {width, height, frameRate}, applied as
// `ideal` so a camera that cannot do it opens at its best rather than failing. A falsy
// cameraId omits deviceId entirely (any camera). exact=false asks for the device as
// `ideal`, so a since-removed one falls back to the default; exact=true is for a
// deliberate device switch or re-enable, where landing on another camera is a bug.
export function cameraConstraints(cameraId, { exact = false, target } = {}) {
  const video = {};
  if (target) {
    video.width = { ideal: target.width };
    video.height = { ideal: target.height };
    video.frameRate = { ideal: target.frameRate };
  }
  if (cameraId) video.deviceId = exact ? { exact: cameraId } : { ideal: cameraId };
  return video;
}
