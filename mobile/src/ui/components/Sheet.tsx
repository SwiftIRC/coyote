import React, { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Keyboard, PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keyboardEvents } from "../../core/keyboard";
import { sheetCloses, sheetTakesDrag } from "../../core/sheetDrag";
import { colors, radius } from "../theme";

type AtTop = { current: boolean };
// The list (if any) the current touch began in, for deciding who gets a downward drag.
// One finger drives a sheet at a time, so one slot will do: a sheet clears it as a touch
// starts, and a list inside sets it just after.
let touchedList: AtTop | null = null;

// A scrolling list inside a sheet: spread onto the ScrollView/FlatList so a pull down at
// its top drags the sheet instead. A list with its own onScroll calls this one's too.
export function useSheetList() {
  const atTop = useRef<AtTop>({ current: true }).current;
  return {
    onTouchStart: () => { touchedList = atTop; },
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => { atTop.current = e.nativeEvent.contentOffset.y <= 0; },
    scrollEventThrottle: 16,
  };
}

// Bottom sheet over the call. The area above it stays visible; tapping it, dragging the
// sheet down (from a list, once it's at its top), or Android's back closes the sheet.
// No gesture/animation libraries.
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

  // Registered after the navigator's, so back closes the sheet before leaving the call.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onCloseRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  // Captured before the lists see it, so a pull at a list's top moves the sheet.
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => sheetTakesDrag(g, touchedList ? touchedList.current : null),
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (sheetCloses(g)) onCloseRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: true }).start(),
  })).current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "box-none" : "none"}>
      {visible ? <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" /> : null}
      <Animated.View
        {...pan.panHandlers}
        onTouchStartCapture={() => { touchedList = null; }}
        style={[styles.sheet, { bottom: kb, height: total, paddingBottom: pad, transform: [{ translateY: y }] }]}
      >
        <View style={styles.handleArea}>
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
