// Recently joined rooms, newest first, for the home card's Recent list. Only slugs
// are stored — never a #t= token or #i= invite (an invite is single-use, and a recent
// entry re-joins as a plain room link). Same guarded-localStorage contract as prefs.js.
const KEY = "swiftirc-vc-recent";
export const MAX_RECENT = 10;

// Pure: put slug at the front, drop its older entry, cap the list.
export function mergeRecent(list, slug, now, max = MAX_RECENT) {
  return [{ slug, at: now }, ...list.filter((r) => r.slug !== slug)].slice(0, max);
}

export function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.slug === "string") : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore */
  }
  return list;
}

export function rememberRoom(slug, now = Date.now()) {
  return save(mergeRecent(loadRecent(), slug, now));
}

export function forgetRoom(slug) {
  return save(loadRecent().filter((r) => r.slug !== slug));
}
