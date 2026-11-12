import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutFor, takesText } from "../assets/lib/shortcuts.js";

const key = (k, extra = {}) => ({ key: k, target: { tagName: "BODY" }, ...extra });

test("V toggles video, A toggles audio, either case", () => {
  assert.equal(shortcutFor(key("v")), "video");
  assert.equal(shortcutFor(key("V")), "video");
  assert.equal(shortcutFor(key("a")), "audio");
  assert.equal(shortcutFor(key("A")), "audio");
  assert.equal(shortcutFor(key("b")), null);
  assert.equal(shortcutFor(key(" ")), null);
});

test("modified and auto-repeated presses are not shortcuts", () => {
  assert.equal(shortcutFor(key("a", { ctrlKey: true })), null);
  assert.equal(shortcutFor(key("v", { metaKey: true })), null);
  assert.equal(shortcutFor(key("v", { altKey: true })), null);
  assert.equal(shortcutFor(key("v", { repeat: true })), null);
});

test("typing in a field is text, but a focused button still takes the shortcut", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(shortcutFor(key("a", { target: { tagName } })), null, tagName);
  }
  assert.equal(shortcutFor(key("a", { target: { tagName: "DIV", isContentEditable: true } })), null);
  assert.equal(shortcutFor(key("a", { target: { tagName: "BUTTON" } })), "audio");
  assert.equal(takesText(null), false);
});
