import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetRoom, loadRecent, mergeRecent, rememberRoom } from "../assets/lib/recent.js";

function stubStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  return store;
}

test("mergeRecent is newest first, deduped, and capped", () => {
  let list = mergeRecent([], "a", 1);
  list = mergeRecent(list, "b", 2);
  list = mergeRecent(list, "a", 3);
  assert.deepEqual(list, [{ slug: "a", at: 3 }, { slug: "b", at: 2 }]);
  for (let i = 0; i < 20; i++) list = mergeRecent(list, `r${i}`, 10 + i);
  assert.equal(list.length, 10);
  assert.equal(list[0].slug, "r19");
});

test("rememberRoom / forgetRoom round-trip through storage", () => {
  stubStorage();
  assert.deepEqual(loadRecent(), []);
  rememberRoom("a", 1);
  rememberRoom("b", 2);
  assert.deepEqual(loadRecent().map((r) => r.slug), ["b", "a"]);
  forgetRoom("b");
  assert.deepEqual(loadRecent(), [{ slug: "a", at: 1 }]);
});

test("loadRecent tolerates junk and missing storage", () => {
  const store = stubStorage();
  store.set("swiftirc-vc-recent", "{not json");
  assert.deepEqual(loadRecent(), []);
  store.set("swiftirc-vc-recent", JSON.stringify([{ slug: "ok" }, null, { nope: 1 }]));
  assert.deepEqual(loadRecent(), [{ slug: "ok" }]);
  delete globalThis.localStorage;
  assert.deepEqual(loadRecent(), []);
  assert.doesNotThrow(() => rememberRoom("x"));
});
