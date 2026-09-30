import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBoard, soundboardFromPage, boardButtonState } from "../assets/lib/soundboard.js";

const rocket = { id: "1f680", label: "🚀", src: "/v/x/sounds/board/1f680.mp3" };

test("a well-formed board passes through in order", () => {
  const party = { id: "1f389", label: "🎉", src: "/v/x/sounds/board/1f389.mp3" };
  assert.deepEqual(normalizeBoard([party, rocket]), [party, rocket]);
});

test("malformed entries and non-arrays are dropped", () => {
  assert.deepEqual(normalizeBoard(null), []);
  assert.deepEqual(normalizeBoard({}), []);
  assert.deepEqual(
    normalizeBoard([null, {}, { id: "a", label: "", src: "/a" }, { id: "b", label: "🅱️" }, rocket]),
    [rocket],
  );
});

test("no window under node --test means an empty board", () => {
  assert.deepEqual(soundboardFromPage(), []);
});

test("idle: every button plays", () => {
  assert.deepEqual(boardButtonState("1f680", "🚀", "", false), { active: false, disabled: false, title: "Play 🚀 for everyone" });
});

test("the starter can stop their own sound, and nothing else", () => {
  assert.deepEqual(boardButtonState("1f680", "🚀", "1f680", true), { active: true, disabled: false, title: "Stop 🚀" });
  assert.equal(boardButtonState("1f389", "🎉", "1f680", true).disabled, true);
});

test("everyone else is locked out, with the playing sound highlighted", () => {
  assert.deepEqual(boardButtonState("1f680", "🚀", "1f680", false), { active: true, disabled: true, title: "A sound is playing" });
  assert.deepEqual(boardButtonState("1f389", "🎉", "1f680", false), { active: false, disabled: true, title: "A sound is playing" });
});
