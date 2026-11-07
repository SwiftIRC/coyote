import { test } from "node:test";
import assert from "node:assert/strict";
import { facesAway, cameraKey, selfMirrored } from "../assets/lib/facing.js";

const track = (settings) => ({ getSettings: () => settings });

test("a rear (environment) camera faces away", () => {
  assert.equal(facesAway(track({ facingMode: "environment" })), true);
});

test("front, unreported, or missing cameras do not face away", () => {
  assert.equal(facesAway(track({ facingMode: "user" })), false);
  assert.equal(facesAway(track({})), false); // desktop webcams report nothing
  assert.equal(facesAway(track(undefined)), false);
  assert.equal(facesAway({}), false); // no getSettings
  assert.equal(facesAway(null), false);
});

const front = { label: "Front", getSettings: () => ({ facingMode: "user", deviceId: "f" }) };
const rear = { label: "Back", getSettings: () => ({ facingMode: "environment", deviceId: "r" }) };
const webcam = { label: "USB Cam", getSettings: () => ({}) };

test("cameraKey prefers deviceId, then label", () => {
  assert.equal(cameraKey(front), "f");
  assert.equal(cameraKey(webcam), "USB Cam");
  assert.equal(cameraKey(null), null);
});

test("self-view defaults: front and webcams mirrored, rear not", () => {
  assert.equal(selfMirrored(front, null), true);
  assert.equal(selfMirrored(webcam, null), true);
  assert.equal(selfMirrored(rear, null), false);
});

test("a manual flip inverts only the camera it was set for", () => {
  assert.equal(selfMirrored(rear, "r"), true); // rear flipped by hand
  assert.equal(selfMirrored(front, "f"), false); // front un-mirrored by hand
  assert.equal(selfMirrored(front, "r"), true); // switched away: back to front's default
  assert.equal(selfMirrored(null, "r"), true); // no camera: harmless default
});
