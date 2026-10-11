import { mergeRecent, recentInput, removeRecent } from "../src/core/recent";
import { parseRoomInput } from "../src/core/link";

const L = (s: string) => parseRoomInput(s)!;

test("newest first, deduped by host+slug, capped, invite never stored", () => {
  let list = mergeRecent([], L("https://vc.swiftirc.net/a#i=secret"), 1);
  list = mergeRecent(list, L("b"), 2);
  list = mergeRecent(list, L("A"), 3);
  expect(list.map((r) => [r.slug, r.at])).toEqual([["a", 3], ["b", 2]]);
  expect(recentInput(list[0])).toBe("https://vc.swiftirc.net/a");
  expect(JSON.stringify(list)).not.toContain("secret");
  for (let i = 0; i < 20; i++) list = mergeRecent(list, L(`r${i}`), 10 + i);
  expect(list).toHaveLength(10);
  expect(list[0].slug).toBe("r19");
});

test("same slug on another host is a separate entry", () => {
  const list = mergeRecent(mergeRecent([], L("x"), 1), L("http://localhost:8080/x"), 2);
  expect(list.map((r) => r.host)).toEqual(["localhost:8080", "vc.swiftirc.net"]);
});

test("removeRecent drops only the matching host+slug and keeps order", () => {
  let list = mergeRecent([], L("a"), 1);
  list = mergeRecent(list, L("b"), 2);
  list = mergeRecent(list, L("http://localhost:8080/a"), 3);
  const out = removeRecent(list, { host: "vc.swiftirc.net", slug: "a" });
  expect(out.map((r) => `${r.host}/${r.slug}`)).toEqual(["localhost:8080/a", "vc.swiftirc.net/b"]);
  expect(removeRecent(out, { host: "nowhere", slug: "zzz" })).toEqual(out);
  expect(list).toHaveLength(3); // input not mutated
});
