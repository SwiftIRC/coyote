import type React from "react";
import { Platform, requireNativeComponent, type ViewProps } from "react-native";

// iOS: Apple's output picker (CoyoteRoutePicker, an AVRoutePickerView with its icon
// hidden), laid over the audio button so a tap opens the system sheet. Android has
// no system equivalent: null, and the app shows AudioRouteSheet instead.
export const RoutePicker: React.ComponentType<ViewProps> | null =
  Platform.OS === "ios" ? requireNativeComponent<ViewProps>("CoyoteRoutePicker") : null;
