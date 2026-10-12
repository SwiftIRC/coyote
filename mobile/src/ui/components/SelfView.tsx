import React, { useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text } from "react-native";
import { VideoView } from "./VideoView";
import type { StreamLike } from "../../core/types";
import { colors } from "../theme";

// Mirrored, draggable picture-in-picture self view. Hidden when the camera is off.
export function SelfView({ stream, onFlip }: { stream: StreamLike | null; onFlip(): void }) {
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
      <VideoView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror zOrder={1} />
      <Pressable onPress={onFlip} style={styles.flip} accessibilityRole="button" accessibilityLabel="Switch camera" hitSlop={8}>
        <Text style={styles.flipText}>⟳</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pip: { position: "absolute", right: 12, top: 56, width: 96, height: 128, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  flip: { position: "absolute", right: 4, bottom: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  flipText: { color: colors.text, fontSize: 16 },
});
