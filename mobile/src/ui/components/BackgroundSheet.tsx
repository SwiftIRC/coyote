import React, { useEffect } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { BUILTIN_EFFECTS, type BgSnapshot } from "../../core/backgrounds";
import { colors, radius } from "../theme";
import { Sheet, useSheetList } from "./Sheet";

// Pick a background effect: None, Blur, Blur+, then the server's scenes. Applies
// immediately; the sheet stays open so you can compare.
export function BackgroundSheet({ visible, onClose, snap, onSelect, onOpen }: {
  visible: boolean; onClose(): void; snap: BgSnapshot; onSelect(id: string): void; onOpen(): void;
}) {
  useEffect(() => {
    if (visible) onOpen();
  }, [visible, onOpen]);

  const list = useSheetList();
  const tile = (id: string, label: string, image?: string) => {
    const on = snap.selected === id;
    return (
      <Pressable
        key={id}
        onPress={() => onSelect(id)}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        style={[styles.tile, on && styles.tileOn]}
      >
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <Text style={[styles.label, image ? styles.labelOnImage : null]} numberOfLines={1}>{on ? "✓ " : ""}{label}</Text>
        {on && snap.busy ? <ActivityIndicator style={styles.spinner} color={colors.text} /> : null}
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.55}>
      <ScrollView {...list} contentContainerStyle={styles.grid}>
        {BUILTIN_EFFECTS.map((b) => tile(b.id, b.label))}
        {snap.scenes.map((s) => tile(s.id, s.label, s.url))}
        {snap.scenesState === "loading" ? <ActivityIndicator style={styles.loading} color={colors.muted} /> : null}
        {snap.scenesState === "unavailable" ? <Text style={styles.msg}>Scenes currently unavailable</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  tile: { width: "31%", aspectRatio: 16 / 9, borderRadius: radius, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  tileOn: { borderColor: colors.accent },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  labelOnImage: { position: "absolute", left: 4, bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 4, borderRadius: 4, overflow: "hidden" },
  spinner: { position: "absolute", top: 4, right: 4 },
  loading: { width: "100%", marginTop: 8 },
  msg: { color: colors.muted, width: "100%", marginTop: 8 },
});
