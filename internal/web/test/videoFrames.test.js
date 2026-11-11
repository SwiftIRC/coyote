import { test } from "node:test";
import assert from "node:assert/strict";
import { presentedFrames, framesAdvanced } from "../assets/lib/videoFrames.js";

const video = (frames) => ({ getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) });

test("presentedFrames reads totalVideoFrames, null when unsupported", () => {
  assert.equal(presentedFrames(video(42)), 42);
  assert.equal(presentedFrames({}), null);
  assert.equal(presentedFrames(null), null);
  assert.equal(presentedFrames({ getVideoPlaybackQuality: () => ({}) }), null);
});

test("only new frames count as progress", () => {
  assert.equal(framesAdvanced(85, 85), false); // camera off: the clock may tick, frames don't
  assert.equal(framesAdvanced(85, 86), true);
  assert.equal(framesAdvanced(null, 90), false); // not yet baselined
  assert.equal(framesAdvanced(85, null), false); // browser can't tell
});
