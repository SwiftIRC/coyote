import React, { memo, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView } from "./VideoView";
import type { Participant } from "../../core/roster";
import { setStreamVolume } from "../../native/volume";
import { colors } from "../theme";
import { Avatar } from "./Avatar";

export const Tile = memo(function TileView({ p, width, height, volume, dataSaver, onLongPress }: {
  p: Participant; width: number; height: number; volume: number; dataSaver: boolean; onLongPress(): void;
}) {
  useEffect(() => {
    setStreamVolume(p.audio, volume);
  }, [p.audio, volume]);
  const showVideo = !dataSaver && p.camera && p.video?.toURL;
  return (
    <Pressable
      style={[styles.tile, { width, height }]}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityHint="Long-press to change this person's volume"
    >
      {showVideo ? (
        <VideoView streamURL={p.video!.toURL!()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <Avatar name={p.name} gravatar={p.gravatar} size={Math.min(width, height) * 0.4} />
      )}
      <View style={styles.label}>
        {p.role === "op" ? <Text style={styles.op}>@</Text> : null}
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        {!p.mic ? <Text style={styles.muted} accessibilityLabel="muted">🔇</Text> : null}
        {volume !== 1 ? <Text style={styles.volume}>🔉{Math.round(volume * 100)}%</Text> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.bg },
  label: { position: "absolute", left: 6, bottom: 6, right: 6, flexDirection: "row", alignItems: "center" },
  op: { color: colors.accent, fontWeight: "700", marginRight: 2 },
  name: { color: colors.text, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, flexShrink: 1 },
  volume: { color: colors.text, fontSize: 12, marginLeft: 4 },
  muted: { marginLeft: 4 },
});
