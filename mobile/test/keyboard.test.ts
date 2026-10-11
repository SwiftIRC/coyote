import { keyboardEvents } from "../src/core/keyboard";

// iOS never resized the window for the keyboard, and Android doesn't either once the
// app is edge-to-edge (adjustResize is a no-op), so both must track the keyboard
// themselves. Android has no "will" events.
test("keyboard events to track on each platform", () => {
  expect(keyboardEvents("ios")).toEqual({ show: "keyboardWillShow", hide: "keyboardWillHide" });
  expect(keyboardEvents("android")).toEqual({ show: "keyboardDidShow", hide: "keyboardDidHide" });
});
