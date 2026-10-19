import { isDrag } from "../src/core/drag";

// Android reports a few pixels of movement during an ordinary tap; treating that as a
// drag stole the self view's ⟳ press.
test("a tap's jitter is not a drag", () => {
  expect(isDrag({ dx: 0, dy: 0 })).toBe(false);
  expect(isDrag({ dx: 3, dy: -4 })).toBe(false);
});

test("a real move in any direction is a drag", () => {
  expect(isDrag({ dx: 12, dy: 0 })).toBe(true);
  expect(isDrag({ dx: 0, dy: -12 })).toBe(true);
});
