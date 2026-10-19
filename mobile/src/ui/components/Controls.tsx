import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { unreadLabel } from "../../core/chat";
import { colors } from "../theme";

interface Props {
  mic: boolean;
  camera: boolean;
  routeA11y: string;
  unread: number;
  onMic(): void;
  onCamera(): void;
  onRoute(): void;
  onChat(): void;
  onMore(): void;
  onLeave(): void;
}

interface BtnProps { label: string; onPress(): void; active?: boolean; danger?: boolean; a11y: string; fit?: boolean }

function Btn({ label, onPress, active = true, danger = false, a11y, fit = false }: BtnProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={[styles.btn, fit && styles.fit, !active && styles.off, danger && styles.danger]}>
      <Text style={styles.text} numberOfLines={fit ? 1 : undefined} adjustsFontSizeToFit={fit} minimumFontScale={0.6}>{label}</Text>
    </Pressable>
  );
}

// The call's control bar.
export function Controls(p: Props) {
  return (
    <View style={styles.bar}>
      <Btn label={p.mic ? "🎙" : "🔇"} onPress={p.onMic} active={p.mic} a11y={p.mic ? "Mute microphone" : "Unmute microphone"} />
      <Btn label={p.camera ? "📷" : "🚫"} onPress={p.onCamera} active={p.camera} a11y={p.camera ? "Turn camera off" : "Turn camera on"} />
      <Btn label="Devices" onPress={p.onRoute} fit a11y={p.routeA11y} />
      <View>
        <Btn label="💬" onPress={p.onChat} a11y={p.unread ? `Chat, ${unreadLabel(p.unread)} unread` : "Chat"} />
        {p.unread > 0 ? <Text style={styles.badge} pointerEvents="none">{unreadLabel(p.unread)}</Text> : null}
      </View>
      <Btn label="☰" onPress={p.onMore} a11y="More" />
      <Btn label="Leave" onPress={p.onLeave} danger a11y="Leave call" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "center", paddingVertical: 12, paddingBottom: 28, backgroundColor: colors.bg },
  btn: { minWidth: 52, height: 52, borderRadius: 26, paddingHorizontal: 8, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  // "Devices" is the one word label besides Leave; cap it so 4x52 + 76 + Leave stays within 360 pt.
  fit: { maxWidth: 76 },
  off: { backgroundColor: "#3a3d44" },
  danger: { backgroundColor: colors.danger },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 20, paddingHorizontal: 5, borderRadius: 10, overflow: "hidden", backgroundColor: colors.accent, color: "#000", fontSize: 12, fontWeight: "700", textAlign: "center" },
  text: { color: colors.text, fontSize: 18, fontWeight: "600" },
});
