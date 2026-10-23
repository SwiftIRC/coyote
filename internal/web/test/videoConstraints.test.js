import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityTier, captureTarget } from "../assets/lib/quality.js";
import { cameraConstraints } from "../assets/lib/videoConstraints.js";

// A bare `video: true` lands on the browser default of 640x480, and the tiers can only
// scale DOWN from the source — so without an explicit capture size, every tier above
// Medium was unreachable. Auto and every tier up to High capture 720p; Ultra 1080p.
test("each tier asks the camera for enough pixels to reach it", () => {
  assert.deepEqual(captureTarget(qualityTier("auto")), { width: 1280, height: 720, frameRate: 30 });
  assert.deepEqual(captureTarget(qualityTier("low")), { width: 1280, height: 720, frameRate: 30 });
  assert.deepEqual(captureTarget(qualityTier("high")), { width: 1280, height: 720, frameRate: 30 });
  assert.deepEqual(captureTarget(qualityTier("ultra")), { width: 1920, height: 1080, frameRate: 30 });
});

// Fast is 720p at 60: the capture has to offer 60fps or the cap is a ceiling nobody hits.
test("a 60fps tier asks the camera for 60fps", () => {
  assert.deepEqual(captureTarget(qualityTier("fast")), { width: 1280, height: 720, frameRate: 60 });
});

// Size and rate are `ideal`, never `exact`: a camera that cannot do 1080p must still
// open at whatever it can do rather than fail the capture outright.
test("the capture size is a preference, not a requirement", () => {
  const v = cameraConstraints(null, { target: captureTarget(qualityTier("ultra")) });
  assert.deepEqual(v, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
});

test("the device id is ideal by default and exact on request", () => {
  const target = captureTarget(qualityTier("auto"));
  assert.deepEqual(cameraConstraints("cam1", { target }).deviceId, { ideal: "cam1" });
  assert.deepEqual(cameraConstraints("cam1", { exact: true, target }).deviceId, { exact: "cam1" });
  assert.equal("deviceId" in cameraConstraints("", { target }), false, "an empty id must not become {exact:''}");
});
