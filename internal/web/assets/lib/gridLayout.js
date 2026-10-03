// Narrow-screen stacking rule for the camera grid, kept pure so it runs under
// `node --test`; ui/grid.js applies it.
//
// The grid's area-maximising pick scores tiles as squares, so a single column only
// wins once the grid is more than twice as tall as it is wide — which a phone never
// is. On a tall, thin screen, though, a 2x2 of thumbnails is harder to read than a
// column of full-width strips, so a portrait grid stacks small calls outright. Past
// MAX_STACK the strips get too thin to be worth it and the normal pick takes over.
//
// The test is the grid's SHAPE, not a pixel width. A width cutoff (480px, the phone
// breakpoint) was tried first and never fired on a narrowed desktop window, which a
// browser will not let shrink much below ~500px. Shape also keeps a phone in
// landscape, or any small landscape window, out of the stack: strips there would be
// slivers.

// How much taller than wide the grid must be. Clearly portrait, so a near-square grid
// keeps its 2x2 rather than becoming four thin bands.
export const PORTRAIT_RATIO = 1.25;
export const MAX_STACK = 4;

// Whether a grid `width` x `height` px holding `n` visible tiles stacks in one column.
// A single tile is already one column, so it is not "stacked".
export function stacksNarrow(width, height, n) {
  return width > 0 && height >= width * PORTRAIT_RATIO && n >= 2 && n <= MAX_STACK;
}
