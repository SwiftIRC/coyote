import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme";

// Always-visible way to stop your own screenshare, just above the controls.
export function SharingPill({ bottom, onStop }: { bottom: number; onStop(): void }) {
  return (
    <Pressable
      onPress={onStop}
      accessibilityRole="button"
      accessibilityLabel="Stop sharing your screen"
      style={[styles.pill, { bottom }]}
    >
      <Text style={styles.text}>Sharing your screen · Stop</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { position: "absolute", alignSelf: "center", backgroundColor: colors.danger, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18 },
  text: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
