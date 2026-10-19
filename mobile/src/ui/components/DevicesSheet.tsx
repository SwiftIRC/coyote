import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { selectedOutput, sortInputs, sortOutputs, type InputKind, type OutputKind, type Pending, type Routes } from "../../core/audioRoutes";
import type { Camera } from "../../core/cameras";
import { RoutePicker } from "../../native/RoutePicker";
import { colors } from "../theme";
import { Sheet, useSheetList } from "./Sheet";

const OUTPUT_ICON: Record<OutputKind, string> = { earpiece: "📱", speaker: "🔊", wired: "🎧", bluetooth: "🎧", car: "🚗" };
const INPUT_ICON: Record<InputKind, string> = { builtin: "🎙", wired: "🎧", bluetooth: "🎧", usb: "🔌" };

function Row({ icon, name, on, busy, onPress }: { icon: string; name: string; on: boolean; busy: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on, busy }} accessibilityLabel={name} style={styles.row}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>{name}</Text>
      {busy ? <Text style={styles.check}>…</Text> : on ? <Text style={styles.check}>✓</Text> : null}
    </Pressable>
  );
}

// The call's devices: output, microphone, camera. Android lists every output; iOS
// shows the current one and opens Apple's picker from it. Picks keep the sheet open;
// "…" marks a switch the system hasn't confirmed yet.
export function DevicesSheet({ visible, onClose, routes, pending, cameras, cameraId, cameraBusy, onOutput, onInput, onCamera }: {
  visible: boolean; onClose(): void; routes: Routes; pending: Pending | null;
  cameras: Camera[]; cameraId: string | null; cameraBusy: string | null;
  onOutput(id: string): void; onInput(id: string): void; onCamera(c: Camera): void;
}) {
  const list = useSheetList();
  const current = selectedOutput(routes);
  const currentName = current?.name ?? "Audio";
  return (
    <Sheet visible={visible} onClose={onClose} heightFraction={0.6}>
      <ScrollView {...list} contentContainerStyle={styles.list}>
        <Text style={styles.header}>Output</Text>
        {RoutePicker ? (
          // iOS: Apple's route picker over the row takes the tap and VoiceOver.
          <View>
            <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.icon}>{OUTPUT_ICON[current?.kind ?? "speaker"]}</Text>
              <Text style={styles.name} numberOfLines={1}>{currentName}</Text>
              <Text style={styles.change}>Change ›</Text>
            </View>
            <RoutePicker style={StyleSheet.absoluteFill} accessible accessibilityLabel={`Audio output: ${currentName}. Change`} />
          </View>
        ) : (
          <>
            {sortOutputs(routes.outputs).map((o) => (
              <Row key={o.id} icon={OUTPUT_ICON[o.kind]} name={o.name} on={o.id === routes.selected}
                busy={pending?.target === "output" && pending.id === o.id} onPress={() => onOutput(o.id)} />
            ))}
            {routes.outputs.length === 0 ? <Text style={styles.msg}>No audio outputs reported yet.</Text> : null}
          </>
        )}
        <Text style={styles.header}>Microphone</Text>
        {sortInputs(routes.inputs).map((i) => (
          <Row key={i.id} icon={INPUT_ICON[i.kind]} name={i.name} on={i.id === routes.input}
            busy={pending?.target === "input" && pending.id === i.id} onPress={() => onInput(i.id)} />
        ))}
        {routes.inputs.length === 0 ? <Text style={styles.msg}>No microphones reported yet.</Text> : null}
        {cameras.length > 0 ? (
          <>
            <Text style={styles.header}>Camera</Text>
            {cameras.map((c) => (
              <Row key={c.id} icon="📷" name={c.name} on={c.id === cameraId} busy={cameraBusy === c.id} onPress={() => onCamera(c)} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  header: { color: colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { fontSize: 20, width: 36 },
  name: { flex: 1, color: colors.text, fontSize: 17 },
  nameOn: { fontWeight: "700" },
  check: { color: colors.accent, fontSize: 18, fontWeight: "700", marginLeft: 8 },
  change: { color: colors.accent, fontSize: 17, marginLeft: 8 },
  msg: { color: colors.muted, marginTop: 12 },
});
