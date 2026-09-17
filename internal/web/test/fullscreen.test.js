import { test } from "node:test";
import assert from "node:assert/strict";
import { fullscreenSupported, isFullscreen, toggleFullscreen } from "../assets/lib/fullscreen.js";

// A stand-in for `document` exposing only the Fullscreen API surface the module touches.
// request/exit record the call and flip `fullscreenElement` the way a browser would, so a
// document can be toggled and then inspected.
function fakeDoc({ enabled = true, canRequest = true, requestFails = false, exitFails = false } = {}) {
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: null,
    calls: [],
    documentElement: {},
    exitFullscreen: async () => {
      doc.calls.push("exit");
      if (exitFails) throw new Error("denied");
      doc.fullscreenElement = null;
    },
  };
  if (canRequest) {
    doc.documentElement.requestFullscreen = async () => {
      doc.calls.push("request");
      if (requestFails) throw new Error("denied");
      doc.fullscreenElement = doc.documentElement;
    };
  }
  return doc;
}

test("an environment with no document is not supported", () => {
  assert.equal(fullscreenSupported(undefined), false);
});

test("a document that disallows fullscreen is not supported", () => {
  // An iframe without allowfullscreen, or a permissions-policy block.
  assert.equal(fullscreenSupported(fakeDoc({ enabled: false })), false);
});

test("a document whose root cannot request fullscreen is not supported", () => {
  // iOS Safari: requestFullscreen exists on <video> only, not on the root element.
  assert.equal(fullscreenSupported(fakeDoc({ canRequest: false })), false);
});

test("a document with the whole API is supported", () => {
  assert.equal(fullscreenSupported(fakeDoc()), true);
});

test("isFullscreen follows the document's fullscreen element", () => {
  const doc = fakeDoc();
  assert.equal(isFullscreen(doc), false);
  doc.fullscreenElement = doc.documentElement;
  assert.equal(isFullscreen(doc), true);
});

test("toggling while windowed requests fullscreen on the root element", async () => {
  const doc = fakeDoc();
  assert.equal(await toggleFullscreen(doc), true);
  assert.deepEqual(doc.calls, ["request"]);
  assert.equal(doc.fullscreenElement, doc.documentElement);
});

test("toggling while fullscreen exits", async () => {
  const doc = fakeDoc();
  doc.fullscreenElement = doc.documentElement;
  assert.equal(await toggleFullscreen(doc), true);
  assert.deepEqual(doc.calls, ["exit"]);
  assert.equal(doc.fullscreenElement, null);
});

test("a rejected request resolves false rather than throwing", async () => {
  // Browsers reject when the call is not in a user gesture, or policy forbids it.
  const doc = fakeDoc({ requestFails: true });
  assert.equal(await toggleFullscreen(doc), false);
  assert.equal(doc.fullscreenElement, null);
});

test("a rejected exit resolves false rather than throwing", async () => {
  const doc = fakeDoc({ exitFails: true });
  doc.fullscreenElement = doc.documentElement;
  assert.equal(await toggleFullscreen(doc), false);
});

test("toggling an unsupported document is a no-op", async () => {
  const doc = fakeDoc({ canRequest: false });
  assert.equal(await toggleFullscreen(doc), false);
  assert.deepEqual(doc.calls, []);
});

test("an unsupported document is never asked to exit fullscreen", async () => {
  // Pins the support check specifically. Without it, this document takes the exit branch
  // on the strength of fullscreenElement alone — a state it could never have reached
  // through us. The no-op test above does not catch that: a missing requestFullscreen
  // throws and is swallowed, which from outside looks the same as being guarded.
  const doc = fakeDoc({ canRequest: false });
  doc.fullscreenElement = doc.documentElement;
  assert.equal(await toggleFullscreen(doc), false);
  assert.deepEqual(doc.calls, []);
});
