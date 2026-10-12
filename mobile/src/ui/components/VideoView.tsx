import React, { useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { RTCView } from "react-native-webrtc";

// RTCView that follows its container's size on Android too. There react-native-webrtc
// renders into a SurfaceViewRenderer whose surface keeps its old size when React
// Native resizes the view (the grid gaining or losing a tile); it only re-lays out
// when the incoming frame resolution changes. Remounting at each new size gives a
// surface of the right size at once. iOS lays out correctly and is left alone.
export function VideoView({ style, ...rest }: {
  streamURL: string;
  objectFit?: "contain" | "cover";
  mirror?: boolean;
  zOrder?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState("");
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const next = `${Math.round(width)}x${Math.round(height)}`;
    if (next !== size) setSize(next);
  };
  if (Platform.OS !== "android") return <RTCView {...rest} style={style ?? StyleSheet.absoluteFill} />;
  return (
    <View style={style ?? StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size ? <RTCView key={size} {...rest} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}
