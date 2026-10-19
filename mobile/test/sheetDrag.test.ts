import { sheetCloses, sheetTakesDrag } from "../src/core/sheetDrag";

const down = { dx: 2, dy: 20 };

// Outside any list (tab row, padding, empty space) a downward drag moves the sheet.
test("a downward drag outside a list moves the sheet", () => {
  expect(sheetTakesDrag(down, null)).toBe(true);
});

// Inside a list only once it's at the top; otherwise the list scrolls.
test("inside a list, only when the list is at its top", () => {
  expect(sheetTakesDrag(down, true)).toBe(true);
  expect(sheetTakesDrag(down, false)).toBe(false);
});

test("upward, sideways and tiny moves are left alone", () => {
  expect(sheetTakesDrag({ dx: 0, dy: -20 }, null)).toBe(false);
  expect(sheetTakesDrag({ dx: 30, dy: 20 }, null)).toBe(false); // a slider
  expect(sheetTakesDrag({ dx: 0, dy: 5 }, null)).toBe(false); // a tap that wobbled
});

test("closes past 80 px or on a flick; springs back otherwise", () => {
  expect(sheetCloses({ dy: 81, vy: 0 })).toBe(true);
  expect(sheetCloses({ dy: 20, vy: 0.9 })).toBe(true);
  expect(sheetCloses({ dy: 60, vy: 0.3 })).toBe(false);
});
