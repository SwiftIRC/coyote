import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutFor, takesText } from "../assets/lib/shortcuts.js";

const key = (k, extra = {}) => ({ key: k, target: { tagName: "BODY" }, ...extra });

test("V toggles video, M toggles the mic, either case", () => {
  assert.equal(shortcutFor(key("v")), "video");
  assert.equal(shortcutFor(key("V")), "video");
  assert.equal(shortcutFor(key("m")), "audio");
  assert.equal(shortcutFor(key("M")), "audio");
  assert.equal(shortcutFor(key("a")), null); // A was the old mic key
  assert.equal(shortcutFor(key("b")), null);
  assert.equal(shortcutFor(key(" ")), null);
});

test("modified and auto-repeated presses are not shortcuts", () => {
  assert.equal(shortcutFor(key("m", { ctrlKey: true })), null);
  assert.equal(shortcutFor(key("v", { metaKey: true })), null);
  assert.equal(shortcutFor(key("v", { altKey: true })), null);
  assert.equal(shortcutFor(key("v", { repeat: true })), null);
});

test("typing in a field is text, but a focused button still takes the shortcut", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(shortcutFor(key("m", { target: { tagName } })), null, tagName);
  }
  assert.equal(shortcutFor(key("m", { target: { tagName: "DIV", isContentEditable: true } })), null);
  assert.equal(shortcutFor(key("m", { target: { tagName: "BUTTON" } })), "audio");
  assert.equal(takesText(null), false);
});
