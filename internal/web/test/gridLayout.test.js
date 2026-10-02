import { test } from "node:test";
import assert from "node:assert/strict";
import { NARROW_STACK_PX, MAX_STACK, stacksNarrow } from "../assets/lib/gridLayout.js";

test("a phone-narrow grid stacks 2 to 4 tiles in one column", () => {
  for (const n of [2, 3, 4]) assert.equal(stacksNarrow(375, n), true, `n=${n}`);
});

test("the breakpoint is inclusive and matches the CSS phone breakpoint (30rem)", () => {
  assert.equal(NARROW_STACK_PX, 480);
  assert.equal(stacksNarrow(480, 4), true);
  assert.equal(stacksNarrow(481, 4), false);
});

test("past MAX_STACK the normal layout takes over", () => {
  assert.equal(MAX_STACK, 4);
  assert.equal(stacksNarrow(375, 5), false);
});

test("one tile, no tiles, and an unsized grid never stack", () => {
  assert.equal(stacksNarrow(375, 1), false);
  assert.equal(stacksNarrow(375, 0), false);
  assert.equal(stacksNarrow(0, 3), false);
});
