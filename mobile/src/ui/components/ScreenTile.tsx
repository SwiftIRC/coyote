import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { Participant } from "../../core/roster";
import { colors } from "../theme";

export const ScreenTile = memo(function ScreenTileView({ p, width, height, onOpen }: {
  p: Participant; width: number; height: number; onOpen(): void;
}) {
  return (
    <Pressable style={[styles.tile, { width, height }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${p.name}'s screen, open full screen`}>
      {p.screen?.toURL ? (
        <RTCView streamURL={p.screen.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
      ) : (
        <Text style={styles.audioOnly}>🔊 Sharing audio</Text>
      )}
      <View style={styles.label}>
        <Text style={styles.name} numberOfLines={1}>🖥 {p.name} (screen)</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: "#000", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.bg },
  audioOnly: { color: colors.muted },
  label: { position: "absolute", left: 6, bottom: 6, right: 6 },
  name: { alignSelf: "flex-start", color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
});
