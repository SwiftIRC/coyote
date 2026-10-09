import { stacksNarrow } from "../shared/web";

// Columns for the call grid. Portrait small calls stack in one column using the web
// client's rule (lib/gridLayout.js), so both clients agree on when to stack.
export function gridColumns(width: number, height: number, n: number): number {
  if (n <= 1) return 1;
  if (stacksNarrow(width, height, n)) return 1;
  if (height > width) return n <= 8 ? 2 : 3;
  return Math.min(4, Math.ceil(Math.sqrt(n)));
}
