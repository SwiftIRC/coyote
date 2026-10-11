import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useElapsed } from "../hooks";
import { colors } from "../theme";

// "#room · 12:34" — the room timer counts from when the server created the room.
export function TopBar({ slug }: { slug: string }) {
  const elapsed = useElapsed();
  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>#{slug}{elapsed ? ` · ${elapsed}` : ""}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 8, left: 12, right: 120 },
  text: { alignSelf: "flex-start", color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden", fontVariant: ["tabular-nums"] },
});
