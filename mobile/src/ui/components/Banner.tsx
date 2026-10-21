import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Banner as BannerKind } from "../../core/call";
import { colors } from "../theme";

const TEXT: Record<Exclude<BannerKind, "">, string> = {
  reconnecting: "Reconnecting…",
  "media-lost": "Media connection lost — rejoining…",
};

// `inset` is the top safe-area inset: the call draws edge to edge.
export function Banner({ kind, notices, inset }: { kind: BannerKind; notices: string[]; inset: number }) {
  if (!kind && notices.length === 0) return null;
  return (
    <View style={[styles.wrap, { top: inset + 40 }]} pointerEvents="none">
      {kind ? <Text style={[styles.item, styles.banner]}>{TEXT[kind]}</Text> : null}
      {notices.map((n, i) => (
        <Text key={`${i}-${n}`} style={styles.item}>{n}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 120, gap: 6 },
  item: { color: colors.text, backgroundColor: "rgba(0,0,0,0.75)", padding: 8, borderRadius: 8, overflow: "hidden" },
  banner: { backgroundColor: colors.accent, color: "#000", fontWeight: "600" },
});
