import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CommonActions, useNavigation, type NavigationProp } from "@react-navigation/native";
import { routeLabel, type AudioRoutes } from "../../core/audioRoutes";
import { gridColumns } from "../../core/grid";
import { gridTiles, screenFor } from "../../core/tiles";
import { cycleRoute, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";
import { useCall } from "../CallContext";
import { useChat, useModeration, usePoll, useVolumes } from "../hooks";
import { Banner } from "../components/Banner";
import { ChatSheet } from "../components/ChatSheet";
import { PollForm } from "../components/PollForm";
import { loadPrefs, savePrefs } from "../../native/storage";
import { MoreSheet } from "../components/MoreSheet";
import { Controls } from "../components/Controls";
import { SelfView } from "../components/SelfView";
import { TopBar } from "../components/TopBar";
import { Tile } from "../components/Tile";
import { PersonSheet } from "../components/PersonSheet";
import { ScreenTile } from "../components/ScreenTile";
import { ScreenViewer } from "../components/ScreenViewer";
import type { RootStack } from "../navigation";
import { colors } from "../theme";

const CONTROLS_H = 92;
const warn = (what: string) => (e: unknown) => console.warn(`${what} failed`, e);

export function Call() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { state, notices, leave, call, outcome, takePendingLink, busy } = useCall();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The call area inside the system bars; measured once laid out, estimated before.
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const width = area?.width ?? window.width - insets.left - insets.right;
  const height = area?.height ?? window.height - insets.top - insets.bottom;
  const [routes, setRoutes] = useState<AudioRoutes>({ available: [], selected: "" });
  const chat = useChat();
  const pollNow = usePoll();
  const volumes = useVolumes();
  const mod = useModeration();
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"chat" | "more" | "poll-form" | null>(null);
  const toggleChat = () => {
    const open = sheet !== "chat";
    setSheet(open ? "chat" : null);
    call()?.chat.setOpen(open);
  };
  const [hideSelf, setHideSelf] = useState(false);
  useEffect(() => { loadPrefs().then((p) => setHideSelf(p.hideSelf)).catch(() => {}); }, []);
  const [viewing, setViewing] = useState<string | null>(null);
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

  // Close the person sheet when that person leaves (or a rejoin changes ids).
  useEffect(() => {
    if (volumeFor && state && !state.participants.some((x) => x.id === volumeFor)) setVolumeFor(null);
  }, [volumeFor, state]);

  // Drop a stale viewer id once the share is gone.
  useEffect(() => {
    if (viewing && state && !screenFor(state.participants, viewing)) setViewing(null);
  }, [viewing, state]);

  // Call audio starts once the call is up, in video mode if the camera is on.
  useEffect(() => {
    if (state?.phase === "in-call" && !audioStarted.current) {
      audioStarted.current = true;
      startCallAudio(state.camera);
    }
  }, [state?.phase, state?.camera]);
  // Back (Android button, gestures, header) must not drop a live call's UI; ask first.
  // `busy` also covers the setup window before any call state exists.
  const liveRef = useRef(busy);
  liveRef.current = busy;
  const confirming = useRef(false);
  useEffect(() => nav.addListener("beforeRemove", (e) => {
    if (!liveRef.current) return;
    e.preventDefault();
    if (confirming.current) return;
    confirming.current = true;
    Alert.alert("Leave call?", undefined, [
      { text: "Stay", style: "cancel", onPress: () => { confirming.current = false; } },
      { text: "Leave", style: "destructive", onPress: () => { confirming.current = false; leave(); } },
    ], { onDismiss: () => { confirming.current = false; } });
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

  if (!state) {
    // Setting up the system call: no call state yet, but the user can still back out.
    if (!busy) return <View style={styles.root} />;
    return (
      <View style={[styles.root, styles.setup]}>
        <Text style={styles.setupText}>Connecting…</Text>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Leave call" style={styles.leave}>
          <Text style={styles.leaveText}>Leave</Text>
        </Pressable>
      </View>
    );
  }
  const people = state.participants;
  const tiles = gridTiles(people);
  const gridH = height - CONTROLS_H;
  const cols = gridColumns(width, gridH, tiles.length);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(gridH / rows);
  const viewed = viewing ? screenFor(people, viewing) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.area} onLayout={(e) => setArea(e.nativeEvent.layout)}>
        <View style={[styles.grid, { height: gridH }]}>
          {tiles.length === 0 ? (
            <Text style={styles.waiting}>{state.phase === "connecting" ? "Connecting…" : `Waiting for others in #${state.slug}…`}</Text>
          ) : (
            tiles.map((t) => t.kind === "screen"
              ? <ScreenTile key={t.key} p={t.p} width={tileW} height={tileH} onOpen={() => setViewing(t.p.id)} />
              : <Tile
                key={t.key} p={t.p} width={tileW} height={tileH}
                volume={volumes[t.p.id] ?? 1}
                dataSaver={state.dataSaver}
                onLongPress={() => setVolumeFor(t.p.id)}
              />)
          )}
        </View>
        <TopBar slug={state.slug} locked={mod.locked} />
        <SelfView stream={state.camera && !hideSelf ? state.localStream : null} onFlip={() => { call()?.flipCamera().catch(warn("flip camera")); }} />
        <Banner kind={state.banner} notices={notices} />
        <Controls
          mic={state.mic}
          camera={state.camera}
          routeLabel={routeLabel(routes.selected)}
          onMic={() => { call()?.setMic(!state.mic).catch(warn("mic")); }}
          onCamera={() => { call()?.setCamera(!state.camera).catch(warn("camera")); }}
          unread={chat.unread}
          onChat={toggleChat}
          onMore={() => { setSheet(sheet === "more" ? null : "more"); call()?.chat.setOpen(false); }}
          onRoute={() => { cycleRoute(routes).catch(warn("audio route")); }}
          onLeave={leave}
        />
        <ChatSheet
          visible={sheet === "chat"}
          onClose={() => { setSheet(null); call()?.chat.setOpen(false); }}
          send={(t) => call()?.chat.send(t) ?? "offline"}
          isOp={state.role === "op"}
          polls={{ vote: (i) => call()?.polls.vote(i) ?? "offline", close: () => call()?.polls.close() ?? "offline" }}
          soundboard={{
            start: (id) => call()?.soundboard.start(id) ?? "offline",
            stop: () => call()?.soundboard.stop() ?? "offline",
          }}
        />
        <MoreSheet
          visible={sheet === "more"}
          onClose={() => setSheet(null)}
          name={state.name}
          rename={(n) => call()?.rename(n) ?? "offline"}
          isOp={state.role === "op"}
          onNewPoll={() => setSheet("poll-form")}
          dataSaver={state.dataSaver}
          onDataSaver={(v) => { call()?.setDataSaver(v); savePrefs({ dataSaver: v }).catch(() => {}); }}
          hideSelf={hideSelf}
          onHideSelf={(v) => { setHideSelf(v); savePrefs({ hideSelf: v }).catch(() => {}); }}
        />
        <PollForm
          visible={sheet === "poll-form"}
          onClose={() => setSheet(null)}
          replacing={!!pollNow?.open}
          create={(q, o) => call()?.polls.create(q, o) ?? "offline"}
        />
        <PersonSheet
          p={volumeFor ? people.find((x) => x.id === volumeFor) ?? null : null}
          volume={volumeFor ? volumes[volumeFor] ?? 1 : 1}
          onChange={(v) => { if (volumeFor) call()?.volumes.set(volumeFor, v); }}
          onClose={() => setVolumeFor(null)}
          isOp={state.role === "op"}
          actions={{
            muteMic: (id) => call()?.moderation.muteMic(id) ?? "offline",
            grantOp: (id) => call()?.moderation.grantOp(id) ?? "offline",
            kick: (id) => call()?.moderation.kick(id) ?? "offline",
            ban: (id) => call()?.moderation.ban(id) ?? "offline",
          }}
        />
        <ScreenViewer p={viewed} onClose={() => setViewing(null)} isOp={state.role === "op"} onStopShare={(id) => call()?.moderation.stopShare(id) ?? "offline"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  area: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" },
  waiting: { color: colors.muted, textAlign: "center", width: "100%", marginTop: "50%" },
  setup: { alignItems: "center", justifyContent: "center", gap: 24 },
  setupText: { color: colors.muted, fontSize: 16 },
  leave: { height: 52, borderRadius: 26, paddingHorizontal: 24, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  leaveText: { color: colors.text, fontSize: 18, fontWeight: "600" },
});
