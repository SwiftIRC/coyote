// Which keyboard events to follow so content can move above the keyboard. Neither
// platform resizes the window for it here: iOS never does, and Android doesn't once
// the app is edge-to-edge (adjustResize becomes a no-op). Android has no "will"
// events, so it follows the "did" ones.
export type KeyboardEventName = "keyboardWillShow" | "keyboardWillHide" | "keyboardDidShow" | "keyboardDidHide";

export function keyboardEvents(os: string): { show: KeyboardEventName; hide: KeyboardEventName } {
  return os === "ios"
    ? { show: "keyboardWillShow", hide: "keyboardWillHide" }
    : { show: "keyboardDidShow", hide: "keyboardDidHide" };
}
