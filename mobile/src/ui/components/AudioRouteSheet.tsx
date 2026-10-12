import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { sortOutputs, type OutputKind, type Routes } from "../../core/audioRoutes";
import { colors } from "../theme";
import { Sheet } from "./Sheet";

const ICON: Record<OutputKind, string> = { earpiece: "📱", speaker: "🔊", wired: "🎧", bluetooth: "🎧", car: "🚗" };

// Android's audio output picker: every output Telecom offers, each Bluetooth device
// by name. Picking one closes the sheet; the list follows devices coming and going.
export function AudioRouteSheet({ visible, onClose, routes, onSelect }: {
  visible: boolean; onClose(): void; routes: Routes; onSelect(id: string): void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.4}>
      <ScrollView contentContainerStyle={styles.list}>
        {sortOutputs(routes.outputs).map((o) => {
          const on = o.id === routes.selected;
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.name}
              style={styles.row}
            >
              <Text style={styles.icon}>{ICON[o.kind]}</Text>
              <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>{o.name}</Text>
              {on ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })}
        {routes.outputs.length === 0 ? <Text style={styles.msg}>No audio outputs reported yet.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { fontSize: 20, width: 36 },
  name: { flex: 1, color: colors.text, fontSize: 17 },
  nameOn: { fontWeight: "700" },
  check: { color: colors.accent, fontSize: 18, fontWeight: "700", marginLeft: 8 },
  msg: { color: colors.muted, marginTop: 12 },
});
