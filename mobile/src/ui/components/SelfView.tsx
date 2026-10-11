import React, { useRef } from "react";
import { Animated, PanResponder, StyleSheet } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { StreamLike } from "../../core/types";
import { colors } from "../theme";

// Mirrored, draggable picture-in-picture self view. Hidden when the camera is off.
export function SelfView({ stream }: { stream: StreamLike | null }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => pos.extractOffset(),
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => pos.flattenOffset(),
  })).current;
  if (!stream?.toURL) return null;
  return (
    <Animated.View style={[styles.pip, { transform: pos.getTranslateTransform() }]} {...pan.panHandlers}>
      <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pip: { position: "absolute", right: 12, top: 56, width: 96, height: 128, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
