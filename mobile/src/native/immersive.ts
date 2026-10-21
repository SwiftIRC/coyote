import { NativeModules, Platform, StatusBar } from "react-native";

// Full screen during a call. Android hides the status and navigation bars
// (CoyoteImmersive); iOS hides the status bar and lets the home indicator fade.
const native = NativeModules.CoyoteImmersive ?? null;

export function setImmersive(on: boolean): void {
  if (Platform.OS === "ios") StatusBar.setHidden(on, "fade");
  native?.setImmersive(on);
}
