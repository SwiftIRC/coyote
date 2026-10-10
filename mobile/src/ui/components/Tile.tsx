import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { Participant } from "../../core/roster";
import { colors } from "../theme";
import { Avatar } from "./Avatar";

export const Tile = memo(function TileView({ p, width, height }: { p: Participant; width: number; height: number }) {
  const showVideo = p.camera && p.video?.toURL;
  return (
    <View style={[styles.tile, { width, height }]}>
      {showVideo ? (
        <RTCView streamURL={p.video!.toURL!()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <Avatar name={p.name} gravatar={p.gravatar} size={Math.min(width, height) * 0.4} />
      )}
      <View style={styles.label}>
        {p.role === "op" ? <Text style={styles.op}>@</Text> : null}
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        {!p.mic ? <Text style={styles.muted} accessibilityLabel="muted">🔇</Text> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.bg },
  label: { position: "absolute", left: 6, bottom: 6, right: 6, flexDirection: "row", alignItems: "center" },
  op: { color: colors.accent, fontWeight: "700", marginRight: 2 },
  name: { color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, flexShrink: 1 },
  muted: { marginLeft: 4 },
});
