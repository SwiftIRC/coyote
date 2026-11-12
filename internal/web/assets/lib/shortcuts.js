// Single-key call shortcuts: V toggles video, A toggles audio (the mic).
//
// Matched on e.key, not e.code, so the shortcut follows the letter printed on the key
// on any layout (AZERTY's A sits where QWERTY's Q is).

// True when the focused element takes typed letters, so the keystroke is text, not a
// shortcut. Buttons and links are NOT included: a letter does nothing to a focused
// button, and after clicking a control-bar button focus stays on it.
export function takesText(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

// "video" | "audio" | null for a keydown event.
export function shortcutFor(e) {
  if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null; // Ctrl+A etc. stay the browser's
  if (takesText(e.target)) return null;
  switch (typeof e.key === "string" ? e.key.toLowerCase() : "") {
    case "v":
      return "video";
    case "a":
      return "audio";
    default:
      return null;
  }
}
