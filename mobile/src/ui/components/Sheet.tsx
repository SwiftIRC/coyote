import React, { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keyboardEvents } from "../../core/keyboard";
import { colors, radius } from "../theme";

// Bottom sheet over the call. The area above it stays visible; tapping it, or
// dragging the handle down, closes the sheet. No gesture/animation libraries.
export function Sheet({ visible, onClose, heightFraction = 0.55, children }: {
  visible: boolean; onClose(): void; heightFraction?: number; children: React.ReactNode;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Neither iOS nor edge-to-edge Android resizes the window for the keyboard, so
  // lift the sheet above it ourselves.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const ev = keyboardEvents(Platform.OS);
    const show = Keyboard.addListener(ev.show, (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener(ev.hide, () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const base = Math.round(win.height * heightFraction);
  const height = kb > 0 ? Math.min(base, win.height - kb - insets.top - 8) : base;
  const pad = kb > 0 ? 0 : insets.bottom;
  const total = height + pad;
  const closedY = total + kb;
  const y = useRef(new Animated.Value(closedY)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    Animated.timing(y, { toValue: visible ? 0 : closedY, duration: 200, useNativeDriver: true }).start();
  }, [visible, closedY, y]);

  useEffect(() => { if (!visible) Keyboard.dismiss(); }, [visible]);

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
      <Animated.View style={[styles.sheet, { bottom: kb, height: total, paddingBottom: pad, transform: [{ translateY: y }] }]}>
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
