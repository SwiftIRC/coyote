import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BoardSnapshot } from "../../core/soundboard";
import { boardButtonState } from "../../shared/web";
import { colors, radius } from "../theme";

export function SoundboardPanel({ board, start, stop }: {
  board: BoardSnapshot;
  start(id: string): "sent" | "offline" | "busy" | "unavailable";
  stop(): "sent" | "offline" | "not-mine";
}) {
  const [msg, setMsg] = useState("");
  const playing = board.playing?.id ?? "";
  const mine = !!board.playing?.mine;
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {(board.sounds ?? []).map((s) => {
          const st = boardButtonState(s.id, s.label, playing, mine);
          const failed = board.clips[s.id] === "failed";
          const disabled = st.disabled || failed;
          return (
            <Pressable
              key={s.id}
              disabled={disabled}
              onPress={() => {
                const r = st.active ? stop() : start(s.id);
                setMsg(r === "offline" ? "Not connected." : "");
              }}
              accessibilityRole="button"
              accessibilityLabel={failed ? `${s.label} unavailable` : st.title}
              accessibilityState={{ disabled, selected: st.active }}
              style={[styles.btn, st.active && styles.active, disabled && styles.off]}
            >
              <Text style={styles.emoji}>{st.active ? "⏹" : s.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {msg ? <Text style={styles.err}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  btn: { width: 64, height: 64, borderRadius: radius, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  active: { borderColor: colors.accent },
  off: { opacity: 0.4 },
  emoji: { fontSize: 30 },
  err: { color: colors.danger },
});
