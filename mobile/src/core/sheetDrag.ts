// Dragging a bottom sheet down closes it. A drag that starts outside any list moves the
// sheet; one inside a list does only once the list is scrolled to its top (`listAtTop`
// is null outside a list), so the list still scrolls back up first.
export function sheetTakesDrag(g: { dx: number; dy: number }, listAtTop: boolean | null): boolean {
  return listAtTop !== false && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx);
}

// Released far enough down, or flicked: close. Otherwise it springs back.
export function sheetCloses(g: { dy: number; vy: number }): boolean {
  return g.dy > 80 || g.vy > 0.8;
}
