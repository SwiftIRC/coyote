// The soundboard's pure logic: which sounds this page was served with, and how each
// board button should look for a given room state. Kept free of the DOM so it runs
// under `node --test`; ui/controls.js owns the buttons and the Audio elements.

// Keep only well-formed {id, label, src} entries. The list is server-built, so this
// is a guard against a malformed page rather than a filter anything relies on.
export function normalizeBoard(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s) => s && typeof s.id === "string" && s.id && typeof s.label === "string" && s.label && typeof s.src === "string" && s.src,
  );
}

// The board the page was served with (see internal/server/soundboard.go). Absent
// under `node --test` (no window), so normalizeBoard is what the tests exercise.
export function soundboardFromPage() {
  return normalizeBoard(globalThis.window && globalThis.window.__vcSoundboard);
}

// How one board button should render. `playing` is the room's playing sound id ("" when
// idle) and `mine` whether we started it. One sound plays at a time: while it does, the
// starter sees its button as a highlighted "stop" and every other button — theirs and
// everyone else's — is locked.
export function boardButtonState(id, label, playing, mine) {
  if (!playing) return { active: false, disabled: false, title: `Play ${label} for everyone` };
  if (id === playing && mine) return { active: true, disabled: false, title: `Stop ${label}` };
  return { active: id === playing, disabled: true, title: "A sound is playing" };
}

// The toggle's title for the whole board.
export function boardToggleTitle(playing, mine) {
  if (!playing) return "Soundboard";
  return mine ? "Soundboard (your sound is playing)" : "Soundboard (a sound is playing)";
}
