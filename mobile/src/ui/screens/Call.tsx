import React, { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CommonActions, useNavigation, type NavigationProp } from "@react-navigation/native";
import { routeLabel, type AudioRoutes } from "../../core/audioRoutes";
import { gridColumns } from "../../core/grid";
import { cycleRoute, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";
import { useCall } from "../CallContext";
import { Banner } from "../components/Banner";
import { Controls } from "../components/Controls";
import { SelfView } from "../components/SelfView";
import { Tile } from "../components/Tile";
import type { RootStack } from "../navigation";
import { colors } from "../theme";

const CONTROLS_H = 92;
const warn = (what: string) => (e: unknown) => console.warn(`${what} failed`, e);

export function Call() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { state, notices, leave, call, outcome, takePendingLink } = useCall();
  const { width, height } = useWindowDimensions();
  const [routes, setRoutes] = useState<AudioRoutes>({ available: [], selected: "" });
  const audioStarted = useRef(false);
  const phase = state?.phase;
  const hasState = !!state;

  useEffect(() => {
    const stop = watchRoutes(setRoutes);
    return () => {
      stop();
      if (audioStarted.current) stopCallAudio();
    };
  }, []);

  // Call audio starts once the call is up, in video mode if the camera is on.
  useEffect(() => {
    if (state?.phase === "in-call" && !audioStarted.current) {
      audioStarted.current = true;
      startCallAudio(state.camera);
    }
  }, [state?.phase, state?.camera]);
  // Back (Android button, gestures, header) must not drop a live call's UI; ask first.
  const live = hasState && phase !== "ended" && phase !== "idle";
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => nav.addListener("beforeRemove", (e) => {
    if (!liveRef.current) return;
    e.preventDefault();
    Alert.alert("Leave call?", undefined, [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: leave },
    ]);
  }), [nav, leave]);

  // Leaving this screen for any reason follows the outcome.
  useEffect(() => {
    // Also acts when setup failed before any call existed (outcome set, state null).
    if (!outcome || (hasState && phase !== "ended")) return;
    const link = takePendingLink();
    if (link) {
      nav.dispatch(CommonActions.reset({ index: 1, routes: [{ name: "Home" }, { name: "PreJoin", params: { link } }] }));
      return;
    }
    if (outcome.kind === "rejected") {
      const prev = nav.getState()?.routes.find((r) => r.name === "PreJoin");
      if (prev) {
        nav.dispatch(CommonActions.reset({
          index: 1,
          routes: [{ name: "Home" }, { name: "PreJoin", params: { ...(prev.params as object), error: outcome.text } }],
        }));
        return;
      }
    }
    const message = outcome.kind === "removed"
      ? `You were ${outcome.reason === "kicked" ? "removed from" : "banned from"} the call${outcome.by ? ` by ${outcome.by}` : ""}.`
      : outcome.kind === "rejected" ? outcome.text : undefined;
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "Home", params: message ? { message } : undefined }] }));
  }, [outcome, hasState, phase, nav, takePendingLink]);

  if (!state) return <View style={styles.root} />;
  const people = state.participants;
  const gridH = height - CONTROLS_H;
  const cols = gridColumns(width, gridH, people.length);
  const rows = Math.max(1, Math.ceil(people.length / cols));
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(gridH / rows);

  return (
    <View style={styles.root}>
      <View style={[styles.grid, { height: gridH }]}>
        {people.length === 0 ? (
          <Text style={styles.waiting}>{state.phase === "connecting" ? "Connecting…" : `Waiting for others in #${state.slug}…`}</Text>
        ) : (
          people.map((p) => <Tile key={p.id} p={p} width={tileW} height={tileH} />)
        )}
      </View>
      <SelfView stream={state.camera ? state.localStream : null} />
      <Banner kind={state.banner} notices={notices} />
      <Controls
        mic={state.mic}
        camera={state.camera}
        routeLabel={routeLabel(routes.selected)}
        onMic={() => { call()?.setMic(!state.mic).catch(warn("mic")); }}
        onCamera={() => { call()?.setCamera(!state.camera).catch(warn("camera")); }}
        onFlip={() => { call()?.flipCamera().catch(warn("flip camera")); }}
        onRoute={() => { cycleRoute(routes).catch(warn("audio route")); }}
        onLeave={leave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" },
  waiting: { color: colors.muted, textAlign: "center", width: "100%", marginTop: "50%" },
});
