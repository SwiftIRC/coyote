// Narrow-screen stacking rule for the camera grid, kept pure so it runs under
// `node --test`; ui/grid.js applies it.
//
// The grid's area-maximising pick scores tiles as squares, so a single column only
// wins once the grid is more than twice as tall as it is wide — which a phone never
// is. On a phone, though, a 2x2 of thumbnails is harder to read than a column of
// full-width strips, so a narrow grid stacks small calls outright. Past MAX_STACK the
// strips get too thin to be worth it and the normal pick takes over.

// The app's existing phone breakpoint (30rem at the default 16px root size).
export const NARROW_STACK_PX = 480;
export const MAX_STACK = 4;

// Whether a grid `width` px wide holding `n` visible tiles stacks in one column. A
// single tile is already one column, so it is not "stacked".
export function stacksNarrow(width, n) {
  return width > 0 && width <= NARROW_STACK_PX && n >= 2 && n <= MAX_STACK;
}
