import { gridColumns } from "../src/core/grid";

test.each([
  [400, 800, 1, 1], // solo
  [400, 800, 3, 1], // portrait small call stacks (web narrow-stack rule)
  [400, 800, 5, 2],
  [400, 800, 9, 3],
  [800, 400, 2, 2], // landscape
  [800, 400, 5, 3],
  [800, 400, 16, 4],
  [800, 400, 30, 4],
])("%i x %i with %i tiles -> %i columns", (w, h, n, cols) => {
  expect(gridColumns(w, h, n)).toBe(cols);
});
