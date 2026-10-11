import { RoomClock } from "../src/core/roomClock";

test("anchors to roomAge and counts with the local clock", () => {
  const c = new RoomClock();
  expect(c.elapsed(1000)).toBeNull();
  c.anchor(90, 10_000);
  expect(c.getSnapshot()).toBe(10_000 - 90_000);
  expect(c.elapsed(10_000)).toBe(90);
  expect(c.elapsed(15_500)).toBe(95);
});

test("re-anchoring on rejoin replaces the start; missing roomAge hides the timer", () => {
  const c = new RoomClock();
  let n = 0;
  c.subscribe(() => n++);
  c.anchor(10, 0);
  c.anchor(20, 0);
  expect(c.elapsed(0)).toBe(20);
  c.anchor(undefined, 0);
  expect(c.elapsed(0)).toBeNull();
  c.reset();
  expect(n).toBe(3); // the reset after an absent anchor changes nothing
});

test("negative or non-numeric ages are treated as unknown", () => {
  const c = new RoomClock();
  c.anchor(-5, 0);
  expect(c.elapsed(0)).toBeNull();
  c.anchor(Number.NaN, 0);
  expect(c.elapsed(0)).toBeNull();
});
