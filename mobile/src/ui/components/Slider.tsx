import React, { useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { colors } from "../theme";

// A minimal horizontal slider (no native dependency). Tap or drag anywhere on it.
export function Slider({ value, min, max, step, onChange, accessibilityLabel }: {
  value: number; min: number; max: number; step: number; onChange(v: number): void; accessibilityLabel: string;
}) {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  widthRef.current = width;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const toValue = (x: number) => {
    const raw = min + (Math.max(0, Math.min(widthRef.current, x)) / widthRef.current) * (max - min);
    return Math.round(raw / step) * step;
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => onChangeRef.current(toValue(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => onChangeRef.current(toValue(e.nativeEvent.locationX)),
  })).current;
  const frac = (value - min) / (max - min);
  return (
    <View
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onChange(Math.min(max, value + step));
        if (e.nativeEvent.actionName === "decrement") onChange(Math.max(min, value - step));
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      {...pan.panHandlers}
    >
      <View style={styles.rail} pointerEvents="none" />
      <View style={[styles.fill, { width: `${frac * 100}%` }]} pointerEvents="none" />
      <View style={[styles.thumb, { left: frac * width - 12 }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 40, justifyContent: "center" },
  rail: { height: 4, borderRadius: 2, backgroundColor: colors.border },
  fill: { position: "absolute", height: 4, borderRadius: 2, backgroundColor: colors.accent },
  thumb: { position: "absolute", width: 24, height: 24, borderRadius: 12, backgroundColor: colors.text },
});
