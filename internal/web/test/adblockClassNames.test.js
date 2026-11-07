import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Ad blockers' social-widget filter lists (Fanboy's Social/Annoyances, Brave Shields)
// hide "share this" widgets by class name, e.g. `.share-wrap`. When the screen-share,
// soundboard and ☰ buttons lived in `.share-wrap`, they silently vanished for one user.
// So no class or selector the call UI uses may contain "share".
const files = ["../assets/ui/controls.js", "../assets/ui/grid.js", "../assets/style.css"];

test("no UI class name contains 'share' (ad-block filter lists hide them)", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const hits = [];
    // class: "a b c" in el() calls / classList ops, and .selectors in CSS.
    for (const m of src.matchAll(/class:\s*"([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/share/i.test(c)) hits.push(c);
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*"([^"]+)"/g)) if (/share/i.test(m[1])) hits.push(m[1]);
    if (f.endsWith(".css")) {
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of noComments.matchAll(/\.([a-zA-Z_][\w-]*)/g)) if (/share/i.test(m[1])) hits.push(`.${m[1]}`);
    }
    assert.deepEqual(hits, [], `${f} uses share-named classes`);
  }
});
