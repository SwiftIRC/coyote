import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { PipTile } from "../../core/pip";
import type { StreamLike } from "../../core/types";
import { colors } from "../theme";
import { Avatar } from "./Avatar";
import { ScreenTile } from "./ScreenTile";
import { Tile } from "./Tile";

const noop = () => {};

// The Android picture-in-picture window: one tile filling it, plus how many others are
// in the call. Nothing else is mounted, so no hidden video surface can bleed through.
export function PipView({ tile, others, self, volumes, dataSaver }: {
  tile: PipTile;
  others: number;
  self: { name: string; stream: StreamLike | null };
  volumes: Record<string, number>;
  dataSaver: boolean;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <View style={styles.root}>
      {tile.kind === "screen" ? (
        <ScreenTile p={tile.p} width={width} height={height} onOpen={noop} />
      ) : tile.kind === "person" ? (
        <Tile p={tile.p} width={width} height={height} volume={volumes[tile.p.id] ?? 1} dataSaver={dataSaver} onLongPress={noop} />
      ) : self.stream?.toURL ? (
        <RTCView streamURL={self.stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror />
      ) : (
        <View style={styles.self}>
          <Avatar name={self.name} gravatar="" size={Math.min(width, height) * 0.4} />
        </View>
      )}
      {others > 0 ? <Text style={styles.others}>+{others}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  self: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  others: {
    position: "absolute", top: 6, right: 6, color: colors.text, fontSize: 12, fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden",
  },
});
