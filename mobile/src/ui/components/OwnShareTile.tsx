import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

// Stands in for your own screenshare: a preview would show the call inside itself.
export const OwnShareTile = memo(function OwnShareTileView({ width, height }: { width: number; height: number }) {
  return (
    <View style={[styles.tile, { width, height }]} accessible accessibilityLabel="You're sharing your screen">
      <Text style={styles.text}>📱 You're sharing your screen</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: "#000", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.bg, padding: 8 },
  text: { color: colors.muted, textAlign: "center" },
});
