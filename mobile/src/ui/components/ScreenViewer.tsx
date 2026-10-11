import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MOD_RESULT_TEXT, type ModResult } from "../../core/moderation";
import type { Participant } from "../../core/roster";
import { setStreamVolume } from "../../native/volume";
import { colors } from "../theme";
import { Slider } from "./Slider";

const MAX_ZOOM = 5;
const dist = (t: ReadonlyArray<{ pageX: number; pageY: number }>) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

// Full-screen share: pinch to zoom, drag to pan, ⟲ rotates 90° (the app is
// portrait-locked), and a volume slider when the share has audio.
export function ScreenViewer({ p, onClose, isOp, onStopShare }: {
  p: Participant | null; onClose(): void; isOp: boolean; onStopShare(id: string): ModResult;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rotated, setRotated] = useState(false);
  const [volume, setVolume] = useState(1);
  const [stopMsg, setStopMsg] = useState("");
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const g = useRef({ scale: 1, x: 0, y: 0, startDist: 0, startScale: 1, startX: 0, startY: 0 }).current;

  const reset = () => {
    Object.assign(g, { scale: 1, x: 0, y: 0 });
    scale.setValue(1);
    tx.setValue(0);
    ty.setValue(0);
  };

  // Start fresh only when a different participant's share is opened. The body
  // touches only stable refs, so it is inlined rather than calling `reset`.
  const id = p?.id;
  useEffect(() => {
    if (!id) return;
    Object.assign(g, { scale: 1, x: 0, y: 0 });
    scale.setValue(1);
    tx.setValue(0);
    ty.setValue(0);
    setRotated(false);
    setVolume(1);
    setStopMsg("");
  }, [id, g, scale, tx, ty]);

  useEffect(() => {
    const audio = p?.screenAudio ?? null;
    setStreamVolume(audio, volume);
  }, [p?.screenAudio, volume]);

  // Closing (or switching) the viewer puts the share's audio back to 100%, so a
  // boosted or muted level does not linger on the tile with no control.
  useEffect(() => {
    const audio = p?.screenAudio ?? null;
    return () => setStreamVolume(audio, 1);
  }, [p?.screenAudio]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches;
      g.startDist = t.length >= 2 ? dist(t) : 0;
      g.startScale = g.scale;
      g.startX = g.x;
      g.startY = g.y;
    },
    onPanResponderMove: (e, gs) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        if (!g.startDist) { g.startDist = dist(t); g.startScale = g.scale; return; }
        g.scale = Math.max(1, Math.min(MAX_ZOOM, g.startScale * (dist(t) / g.startDist)));
        scale.setValue(g.scale);
      } else if (g.scale > 1) {
        g.x = g.startX + gs.dx;
        g.y = g.startY + gs.dy;
        tx.setValue(g.x);
        ty.setValue(g.y);
      }
    },
    onPanResponderRelease: () => {
      if (g.scale <= 1.01) reset();
    },
  })).current;

  if (!p) return null;
  const w = rotated ? win.height : win.width;
  const h = rotated ? win.width : win.height;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait"]} statusBarTranslucent>
      <View style={styles.root} {...pan.panHandlers}>
        <Animated.View style={{ width: w, height: h, transform: [{ translateX: tx }, { translateY: ty }, { rotate: rotated ? "90deg" : "0deg" }, { scale }] }}>
          {p.screen?.toURL ? (
            <RTCView streamURL={p.screen.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
          ) : (
            <Text style={styles.audioOnly}>🔊 {p.name} is sharing audio</Text>
          )}
        </Animated.View>
      </View>
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <Pressable onPress={onClose} style={styles.btn} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.btnText}>✕</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{p.name} (screen)</Text>
        <Pressable onPress={() => { setRotated((r) => !r); reset(); }} style={styles.btn} accessibilityRole="button" accessibilityLabel="Rotate"><Text style={styles.btnText}>⟲</Text></Pressable>
      </View>
      {isOp ? (
        <View style={[styles.stopWrap, { top: insets.top + 60 }]}>
          <Pressable
            onPress={() => { const r = onStopShare(p.id); setStopMsg(r === "sent" ? "" : MOD_RESULT_TEXT[r] || ""); }}
            style={styles.stop}
            accessibilityRole="button"
            accessibilityLabel={`Stop ${p.name}'s screenshare`}
          >
            <Text style={styles.btnText}>Stop share</Text>
          </Pressable>
          {stopMsg ? <Text style={styles.vol}>{stopMsg}</Text> : null}
        </View>
      ) : null}
      {p.screenAudio ? (
        <View style={[styles.bottom, { bottom: insets.bottom + 12 }]}>
          <Text style={styles.vol}>Volume {Math.round(volume * 100)}%</Text>
          <Slider value={volume} min={0} max={2} step={0.05} onChange={setVolume} accessibilityLabel="Screen share volume" />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  audioOnly: { color: colors.muted, textAlign: "center", marginTop: "50%" },
  top: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, color: colors.text, textAlign: "center" },
  btn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  btnText: { color: colors.text, fontSize: 20 },
  stopWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 4 },
  stop: { paddingHorizontal: 16, height: 40, borderRadius: 20, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 20, right: 20, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, padding: 12 },
  vol: { color: colors.text, marginBottom: 4 },
});
