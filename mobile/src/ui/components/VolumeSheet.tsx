import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Participant } from "../../core/roster";
import { VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../core/volumes";
import { colors } from "../theme";
import { Sheet } from "./Sheet";
import { Slider } from "./Slider";

export function VolumeSheet({ p, volume, onChange, onClose }: {
  p: Participant | null; volume: number; onChange(v: number): void; onClose(): void;
}) {
  return (
    <Sheet visible={!!p} onClose={onClose} heightFraction={0.25}>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{p?.name ?? ""}</Text>
        <Text style={styles.value}>Volume {Math.round(volume * 100)}%</Text>
        <Slider value={volume} min={VOLUME_MIN} max={VOLUME_MAX} step={VOLUME_STEP} onChange={onChange}
          accessibilityLabel={`${p?.name ?? ""} volume`} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  value: { color: colors.muted },
});
