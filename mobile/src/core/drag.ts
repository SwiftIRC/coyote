// Fingers wobble a few pixels during a tap (Android reports it as movement), so a touch
// becomes a drag only past this distance; below it, buttons inside still get the press.
const TAP_SLOP = 8;

export function isDrag(g: { dx: number; dy: number }): boolean {
  return Math.hypot(g.dx, g.dy) > TAP_SLOP;
}
