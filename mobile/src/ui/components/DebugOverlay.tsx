import React, { useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { shareDebugReport } from "../../native/debug";
import { useCall } from "../CallContext";

const POLL_MS = 1000;
const mono = Platform.OS === "ios" ? "Menlo" : "monospace";

// Debug mode's in-call panel (core/debug.ts): the call's state and the media
// connection's counters, once a second, with a button to share a full report.
// `top`/`left` place it below the top bar, inside the safe area.
export function DebugOverlay({ top, left }: { top: number; left: number }) {
  const { call } = useCall();
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(true);

  // Polls while collapsed too: each poll refreshes the stats a report from Home
  // will carry once the call has ended.
  useEffect(() => {
    let live = true;
    const tick = () => {
      call()?.debugStats()
        .then((l) => live && setLines(l))
        .catch((e) => live && setLines([`stats failed: ${String(e)}`]));
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [call]);

  const share = () => {
    const c = call();
    (c ? c.debugReport() : Promise.resolve(null))
      .then((report) => shareDebugReport(report))
      .catch((e) => Alert.alert("Couldn't share the debug report", String(e)));
  };

  return (
    <View style={[styles.root, { top, left }]} pointerEvents="box-none">
      <View style={styles.buttons}>
        <Pressable onPress={() => setOpen((v) => !v)} style={styles.button} accessibilityRole="button" accessibilityLabel={open ? "Hide debug details" : "Show debug details"}>
          <Text style={styles.buttonText}>{open ? "debug ▾" : "debug ▸"}</Text>
        </Pressable>
        <Pressable onPress={share} style={styles.button} accessibilityRole="button" accessibilityLabel="Share debug report">
          <Text style={styles.buttonText}>share</Text>
        </Pressable>
      </View>
      {open ? (
        <View style={styles.panel} pointerEvents="none">
          {lines.map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", maxWidth: "72%" },
  buttons: { flexDirection: "row", gap: 6, marginBottom: 4 },
  button: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 4 },
  buttonText: { color: "#0f0", fontSize: 11, fontFamily: mono },
  panel: { backgroundColor: "rgba(0,0,0,0.65)", padding: 4, borderRadius: 4 },
  line: { color: "#0f0", fontSize: 9, fontFamily: mono },
});
