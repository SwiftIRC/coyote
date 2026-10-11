import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MOD_RESULT_TEXT, type ModResult } from "../../core/moderation";
import type { Participant } from "../../core/roster";
import { VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../core/volumes";
import { colors, radius } from "../theme";
import { Sheet } from "./Sheet";
import { Slider } from "./Slider";

export interface PersonActions {
  muteMic(id: string): ModResult;
  grantOp(id: string): ModResult;
  kick(id: string): ModResult;
  ban(id: string): ModResult;
}

// Long-press a tile: the person's volume for everyone, and for ops the moderation
// actions. Kick, Ban and Make op ask first; Mute is a nudge they can undo.
export function PersonSheet({ p, volume, onChange, onClose, isOp, actions }: {
  p: Participant | null; volume: number; onChange(v: number): void; onClose(): void;
  isOp: boolean; actions: PersonActions;
}) {
  const [msg, setMsg] = useState("");
  const id = p?.id;
  useEffect(() => { setMsg(""); }, [id]);

  const run = (r: ModResult, closeOnSent = false) => {
    if (r === "sent" && closeOnSent) onClose();
    else setMsg(MOD_RESULT_TEXT[r] || "");
  };
  const confirm = (title: string, message: string, label: string, destructive: boolean, act: () => void) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: label, style: destructive ? "destructive" : "default", onPress: act },
    ]);

  const name = p?.name ?? "";
  const pid = p?.id ?? "";
  return (
    <Sheet visible={!!p} onClose={onClose} heightFraction={isOp ? 0.5 : 0.25}>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{p?.role === "op" ? "@" : ""}{name}</Text>
        <Text style={styles.value}>Volume {Math.round(volume * 100)}%</Text>
        <Slider value={volume} min={VOLUME_MIN} max={VOLUME_MAX} step={VOLUME_STEP} onChange={onChange}
          accessibilityLabel={`${name} volume`} />
        {isOp && p ? (
          <View style={styles.actions}>
            <View style={styles.row}>
              <Pressable
                onPress={() => run(actions.muteMic(pid))}
                disabled={!p.mic}
                accessibilityRole="button"
                accessibilityLabel={p.mic ? `Mute ${name}'s mic` : `${name} is muted`}
                accessibilityState={{ disabled: !p.mic }}
                style={[styles.btn, !p.mic && styles.off]}
              >
                <Text style={styles.btnText}>{p.mic ? "Mute mic" : "Muted"}</Text>
              </Pressable>
              {p.role !== "op" ? (
                <Pressable
                  onPress={() => confirm(`Make ${name} an op?`, "They'll be able to kick, ban and mute anyone. This can't be undone.", "Make op", false, () => run(actions.grantOp(pid)))}
                  accessibilityRole="button"
                  style={styles.btn}
                >
                  <Text style={styles.btnText}>Make op</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.row}>
              <Pressable
                onPress={() => confirm(`Kick ${name}?`, "They'll be removed from the call.", "Kick", true, () => run(actions.kick(pid), true))}
                accessibilityRole="button"
                style={[styles.btn, styles.danger]}
              >
                <Text style={styles.btnText}>Kick</Text>
              </Pressable>
              <Pressable
                onPress={() => confirm(`Ban ${name}?`, "They'll be removed and blocked from rejoining.", "Ban", true, () => run(actions.ban(pid), true))}
                accessibilityRole="button"
                style={[styles.btn, styles.danger]}
              >
                <Text style={styles.btnText}>Ban</Text>
              </Pressable>
            </View>
            {msg ? <Text style={styles.value}>{msg}</Text> : null}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  value: { color: colors.muted },
  actions: { gap: 8, marginTop: 12 },
  row: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radius, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, alignItems: "center" },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  off: { opacity: 0.5 },
  btnText: { color: colors.text, fontSize: 16, fontWeight: "600" },
});
