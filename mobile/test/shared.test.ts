import {
  encode, decode, parseInvite, parseToken, backoffDelay, handleRemoteOffer,
  serverErrorDisposition, qualityTier, encodingCaps, stacksNarrow, avatarFor, gravatarUrl,
  formatDuration, linkSegments, Presence,
} from "../src/shared/web";

test("the web client's pure modules load under Jest", () => {
  expect(decode(encode("join", { name: "a" }))).toEqual({ type: "join", name: "a" });
  expect(parseInvite("#i=abc")).toBe("abc");
  expect(parseToken("#t=x.y")).toBe("x.y");
  expect(backoffDelay(0)).toBe(500);
  expect(backoffDelay(10)).toBe(10000);
  expect(handleRemoteOffer({ makingOffer: true, signalingState: "stable" }).action).toBe("rollback-then-answer");
  expect(serverErrorDisposition({ code: "x", message: "m", inCall: false }).fatal).toBe(true);
  expect(encodingCaps(qualityTier("low"), 720).scaleResolutionDownBy).toBe(2);
  expect(stacksNarrow(400, 800, 3)).toBe(true);
  expect(avatarFor("bob").initial).toBe("B");
  expect(gravatarUrl("nope", 10)).toBe("");
});

test("room-feature modules load: linkify, duration, presence", () => {
  expect(linkSegments("see https://x.io/a). ok")).toEqual([
    { text: "see " }, { text: "https://x.io/a", href: "https://x.io/a" }, { text: "). ok" },
  ]);
  expect(linkSegments("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
  expect(linkSegments("www.example.com")).toEqual([{ text: "www.example.com", href: "https://www.example.com" }]);
  expect(formatDuration(65)).toBe("1:05");
  expect(formatDuration(3661)).toBe("1:01:01");
  let joins = 0;
  // presence.js defaults `timers` to globalThis, so allowJs infers that type; a plain
  // {setTimeout, clearTimeout} is all it uses.
  const p = new Presence({ onJoinChime: () => joins++, timers: { setTimeout, clearTimeout } as unknown as typeof globalThis });
  p.seed([{ ref: "a" }]);
  p.joined("a");
  expect(joins).toBe(0);
  p.joined("b");
  expect(joins).toBe(1);
  p.clear();
});

import { boardButtonState, normalizeBoard, tallyPercents, totalVotes } from "../src/shared/web";

test("poll and soundboard modules load", () => {
  expect(totalVotes([1, "x", 2])).toBe(3);
  expect(tallyPercents([1, 1, 1])).toEqual([34, 33, 33]);
  expect(tallyPercents([0, 0])).toEqual([0, 0]);
  expect(normalizeBoard([{ id: "a", label: "🚀", src: "/s.mp3" }, { id: "", label: "x", src: "y" }, null]))
    .toEqual([{ id: "a", label: "🚀", src: "/s.mp3" }]);
  expect(boardButtonState("a", "🚀", "", false)).toEqual({ active: false, disabled: false, title: "Play 🚀 for everyone" });
  expect(boardButtonState("a", "🚀", "a", true)).toMatchObject({ active: true, disabled: false });
  expect(boardButtonState("b", "🧪", "a", false)).toMatchObject({ active: false, disabled: true });
});
