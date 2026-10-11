import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useElapsed } from "../hooks";
import { colors } from "../theme";

// "🔒 #room · 12:34" — the lock shows while the room is password-locked; the timer
// counts from when the server created the room.
export function TopBar({ slug, locked }: { slug: string; locked: boolean }) {
  const elapsed = useElapsed();
  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1} accessibilityLabel={`${locked ? "Room locked. " : ""}#${slug}${elapsed ? `, ${elapsed}` : ""}`}>
        {locked ? "🔒 " : ""}#{slug}{elapsed ? ` · ${elapsed}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 8, left: 12, right: 120 },
  text: { alignSelf: "flex-start", color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", fontVariant: ["tabular-nums"] },
});
