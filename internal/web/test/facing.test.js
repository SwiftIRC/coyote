import { test } from "node:test";
import assert from "node:assert/strict";
import { facesAway } from "../assets/lib/facing.js";

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
