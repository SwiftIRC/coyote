// Browser fullscreen for the whole page, so a call can use the entire screen — on a
// phone that also reclaims the space the browser's own URL bar and chrome occupy.
//
// Everything here is best-effort and feature-detected. The API is absent or refused in
// several ordinary places: iOS Safari exposes requestFullscreen on <video> only and not
// on the root element, an iframe without `allowfullscreen` reports fullscreenEnabled
// false, and a request outside a user gesture is rejected. Callers should ask
// fullscreenSupported() before offering a control at all, and must never let a refusal
// throw into the call.
//
// `doc` is injected so this is testable off a browser; it defaults to the real document.

export function fullscreenSupported(doc = globalThis.document) {
  return !!(doc && doc.fullscreenEnabled && typeof doc.documentElement?.requestFullscreen === "function");
}

export function isFullscreen(doc = globalThis.document) {
  return !!(doc && doc.fullscreenElement);
}

// Enter fullscreen, or leave it if already there. Resolves true when the transition was
// made, false when it was refused or unavailable. Callers should not use the return value
// to paint button state — listen for `fullscreenchange` instead, since the user can also
// leave fullscreen with Esc or a system gesture, with no call through here.
export async function toggleFullscreen(doc = globalThis.document) {
  if (!fullscreenSupported(doc)) return false;
  try {
    if (isFullscreen(doc)) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
    return true;
  } catch {
    return false; /* refused: no user gesture, or blocked by policy */
  }
}
