import { test } from "node:test";
import assert from "node:assert/strict";
import { PORTRAIT_RATIO, MAX_STACK, stacksNarrow } from "../assets/lib/gridLayout.js";

test("a portrait phone grid stacks 2 to 4 tiles in one column", () => {
  for (const n of [2, 3, 4]) assert.equal(stacksNarrow(375, 560, n), true, `n=${n}`);
});

// The bug this rule replaced: a fixed 480px cutoff that a desktop browser window
// cannot be dragged below (Chrome stops at ~500px), so a narrowed window never
// stacked and four people stayed 2x2.
test("a narrowed desktop window stacks once it is portrait", () => {
  assert.equal(stacksNarrow(520, 900, 4), true);
  assert.equal(stacksNarrow(700, 1000, 4), true);
});

test("the portrait threshold is inclusive", () => {
  assert.equal(PORTRAIT_RATIO, 1.25);
  assert.equal(stacksNarrow(400, 500, 4), true);
  assert.equal(stacksNarrow(400, 499, 4), false);
});

test("square and landscape grids never stack, however small", () => {
  assert.equal(stacksNarrow(480, 480, 4), false); // square
  assert.equal(stacksNarrow(1100, 700, 4), false); // desktop
  assert.equal(stacksNarrow(800, 350, 3), false); // phone in landscape
  assert.equal(stacksNarrow(480, 300, 4), false); // a tiny landscape window
});

test("past MAX_STACK the normal layout takes over", () => {
  assert.equal(MAX_STACK, 4);
  assert.equal(stacksNarrow(375, 560, 5), false);
});

test("one tile, no tiles, and an unsized grid never stack", () => {
  assert.equal(stacksNarrow(375, 560, 1), false);
  assert.equal(stacksNarrow(375, 560, 0), false);
  assert.equal(stacksNarrow(0, 560, 3), false);
  assert.equal(stacksNarrow(375, 0, 3), false);
});
