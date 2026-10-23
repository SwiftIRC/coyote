import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileRoster } from "../assets/lib/roster.js";

// A server restart gives every participant a fresh id, and the new server cannot send
// peer-left for ids it never issued. A re-join that only ADDED the fresh roster left
// each old tile beside its new one — everyone duplicated until a refresh.
test("ids missing from the fresh roster are departed", () => {
  const r = reconcileRoster(["self2", "oldA", "oldB"], [{ id: "newA" }, { id: "newB" }], "self2", "self1");
  assert.deepEqual(r.departed, ["oldA", "oldB"]);
  assert.deepEqual(r.peers.map((p) => p.id), ["newA", "newB"]);
});

test("ids still in the roster, and our own, are kept", () => {
  const r = reconcileRoster(["me", "a", "b"], [{ id: "a" }, { id: "b" }], "me", "me");
  assert.deepEqual(r.departed, []);
});

// On an ordinary reconnect our previous session lingers as a ghost until its socket
// times out, so the roster can list our OLD id. That is us — never a remote tile.
test("our previous id in the roster is not added as someone else", () => {
  const r = reconcileRoster(["me2", "a"], [{ id: "me1" }, { id: "a" }], "me2", "me1");
  assert.deepEqual(r.departed, []);
  assert.deepEqual(r.peers.map((p) => p.id), ["a"]);
});

test("an absent or malformed roster drops every remote tile but never self", () => {
  assert.deepEqual(reconcileRoster(["me", "a"], undefined, "me", "me").departed, ["a"]);
  assert.deepEqual(reconcileRoster(["me", "a"], [null, {}], "me", "me").departed, ["a"]);
});
