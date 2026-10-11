import React, { useEffect, useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";

// Bottom sheet over the call. The area above it stays visible; tapping it, or
// dragging the handle down, closes the sheet. No gesture/animation libraries.
export function Sheet({ visible, onClose, heightFraction = 0.55, children }: {
  visible: boolean; onClose(): void; heightFraction?: number; children: React.ReactNode;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const height = Math.round(win.height * heightFraction);
  const y = useRef(new Animated.Value(height)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    Animated.timing(y, { toValue: visible ? 0 : height, duration: 200, useNativeDriver: true }).start();
  }, [visible, height, y]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 80 || g.vy > 0.8) onCloseRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "box-none" : "none"}>
      {visible ? <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" /> : null}
      <Animated.View style={[styles.sheet, { height: height + insets.bottom, paddingBottom: insets.bottom, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: radius, borderTopRightRadius: radius, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  handleArea: { alignItems: "center", paddingVertical: 10 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
});
