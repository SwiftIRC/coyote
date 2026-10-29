import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CommonActions, useNavigation, type NavigationProp } from "@react-navigation/native";
import { NO_ROUTES, outputLabel, pendingOutcome, pickInput, pickOutput, selectedOutput, type Pending, type Routes } from "../../core/audioRoutes";
import { cameraFacing, type Camera } from "../../core/cameras";
import { chromePinned } from "../../core/chrome";
import { gridColumns } from "../../core/grid";
import { PIP_OFF, pipOthers, pipParams, pipTile, runPipAction } from "../../core/pip";
import { gridTiles, viewedFor, type Viewing } from "../../core/tiles";
import { selectInput, selectOutput, startCallAudio, stopCallAudio, watchRoutes } from "../../native/audioRoute";
import { setImmersive } from "../../native/immersive";
import { setPip, watchPip, watchPipActions } from "../../native/pip";
import { listCameras } from "../../native/webrtc";
import { useCall } from "../CallContext";
import { useAutoHide, useBackground, useChat, useModeration, usePoll, useScreenReader, useScreenShare, useVolumes } from "../hooks";
import { Banner } from "../components/Banner";
import { DevicesSheet } from "../components/DevicesSheet";
import { BackgroundSheet } from "../components/BackgroundSheet";
import { ChatSheet } from "../components/ChatSheet";
import { DebugOverlay } from "../components/DebugOverlay";
import { PollForm } from "../components/PollForm";
import { loadPrefs, savePrefs } from "../../native/storage";
import { MoreSheet } from "../components/MoreSheet";
import { Controls } from "../components/Controls";
import { SelfView } from "../components/SelfView";
import { TopBar } from "../components/TopBar";
import { Tile } from "../components/Tile";
import { PersonSheet } from "../components/PersonSheet";
import { ScreenTile } from "../components/ScreenTile";
import { SharingPill } from "../components/SharingPill";
import { OwnShareTile } from "../components/OwnShareTile";
import { PipView } from "../components/PipView";
import { ScreenViewer } from "../components/ScreenViewer";
import type { RootStack } from "../navigation";
import { colors } from "../theme";

const CONTROLS_H = 92;
const warn = (what: string) => (e: unknown) => console.warn(`${what} failed`, e);

export function Call() {
  const nav = useNavigation<NavigationProp<RootStack>>();
  const { state, notices, notify, leave, call, outcome, takePendingLink, busy } = useCall();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The call draws edge to edge, under the hidden system bars and the controls; measured
  // once laid out, estimated before. Showing or hiding the controls never resizes it.
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const width = area?.width ?? window.width;
  const height = area?.height ?? window.height;
  const [routes, setRoutes] = useState<Routes>(NO_ROUTES);
  const [pending, setPending] = useState<Pending | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraBusy, setCameraBusy] = useState<string | null>(null);
  const chat = useChat();
  const pollNow = usePoll();
  const volumes = useVolumes();
  const mod = useModeration();
  const share = useScreenShare();
  const bg = useBackground();
  const loadScenes = useCallback(() => { call()?.background.loadScenes().catch(warn("scenes")); }, [call]);
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"chat" | "more" | "poll-form" | "background" | "devices" | null>(null);
  const toggleChat = () => {
    const open = sheet !== "chat";
    setSheet(open ? "chat" : null);
    call()?.chat.setOpen(open);
  };
  const [hideSelf, setHideSelf] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    loadPrefs().then((p) => {
      setHideSelf(p.hideSelf);
      setDebug(p.debug);
    }).catch(() => {});
  }, []);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // What was open full screen when PiP started, for the PiP window to show.
  const [pipFocus, setPipFocus] = useState<Viewing | null>(null);
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  // Full screen for the whole call screen.
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, []);
  // The controls and top bar hide over the video and come back on a touch. A touch that
  // brings them back does only that: it doesn't also open the tile under the finger.
  const screenReader = useScreenReader();
  const chrome = useAutoHide(chromePinned({
    phase: state?.phase ?? "connecting",
    people: state?.participants.length ?? 0,
    sheetOpen: sheet !== null || volumeFor !== null,
    screenReader,
  }));
  const touchShowed = useRef(false);
  const onTouchStart = () => {
    touchShowed.current = !chrome.visible;
    chrome.poke();
  };
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: chrome.visible ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [chrome.visible, fade]);
  const audioStarted = useRef(false);
  const phase = state?.phase;
  const hasState = !!state;

  // Android picture-in-picture: allowed while the call is up. Entering it closes
  // everything over the grid, since the window shows a single tile.
  const [inPip, setInPip] = useState(false);
  useEffect(() => watchPip((v) => {
    setInPip(v);
    setPipFocus(v ? viewingRef.current : null);
    if (!v) return;
    setSheet(null);
    setViewing(null);
    setVolumeFor(null);
    call()?.chat.setOpen(false);
  }), [call]);
  const pip = pipParams(state, inPip ? pipFocus : viewing);
  useEffect(() => {
    setPip({ enabled: pip.enabled, micOn: pip.micOn, aspect: pip.aspect });
  }, [pip.enabled, pip.micOn, pip.aspect]);
  useEffect(() => () => setPip(PIP_OFF), []);
  // The PiP mic button flips the mic as it is now, not as it was when subscribed.
  const micRef = useRef(false);
  micRef.current = !!state?.mic;
  useEffect(() => watchPipActions((a) => runPipAction(a, {
    toggleMic: () => { call()?.setMic(!micRef.current).catch(warn("mic")); },
    hangup: leave,
  })), [call, leave]);

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

  // Close the viewer once the share or camera is gone.
  useEffect(() => {
    if (viewing && state && !viewedFor(state.participants, viewing, state.dataSaver)) setViewing(null);
  }, [viewing, state]);

  // Call audio starts once the call is up, in video mode if the camera is on.
  useEffect(() => {
    if (state?.phase === "in-call" && !audioStarted.current) {
      audioStarted.current = true;
      startCallAudio(call()?.systemCallId ?? "", state.camera).catch(warn("call audio"));
    }
  }, [state?.phase, state?.camera, call]);

  // A requested output or microphone switch: settled by the next report that selects
  // it, failed when it vanishes, the platform rejects it, or 5 s pass.
  useEffect(() => {
    if (!pending) return;
    const fail = () => {
      setPending(null);
      notify(`Couldn't switch to ${pending.name}.`);
    };
    const o = pendingOutcome(pending, routes, Date.now());
    if (o.kind === "done") {
      setPending(null);
      return;
    }
    if (o.kind === "failed") {
      fail();
      return;
    }
    const t = setTimeout(fail, o.ms);
    return () => clearTimeout(t);
  }, [pending, routes, notify]);
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
  if (inPip) {
    const t = pipTile(state.participants, pipFocus, state.dataSaver);
    return (
      <PipView
        tile={t}
        others={pipOthers(t, state.participants)}
        self={{ name: state.name, stream: state.camera && !hideSelf ? state.localStream : null }}
        volumes={volumes}
        dataSaver={state.dataSaver}
      />
    );
  }
  const people = state.participants;
  const tiles = gridTiles(people, share.status === "sharing");
  const gridH = height;
  const cols = gridColumns(width, gridH, tiles.length);
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const tileW = Math.floor(width / cols);
  const tileH = Math.floor(gridH / rows);
  const viewed = viewedFor(people, viewing, state.dataSaver);
  const current = selectedOutput(routes);
  const pickRoute = (id: string) => {
    const p = pickOutput(routes, id, Date.now());
    if (!p) return;
    setPending(p);
    // at: 0 marks it failed; the pending effect shows the notice.
    selectOutput(id).catch((e) => {
      console.warn("audio output failed", e);
      setPending((cur) => (cur === p ? { ...p, at: 0 } : cur));
    });
  };
  const pickMic = (id: string) => {
    const p = pickInput(routes, id, Date.now());
    if (!p) return;
    setPending(p);
    selectInput(routes, id, state.camera).catch((e) => {
      console.warn("microphone failed", e);
      setPending((cur) => (cur === p ? { ...p, at: 0 } : cur));
    });
  };
  const pickCamera = (c: Camera) => {
    if (c.id === state.cameraId || cameraBusy) return;
    const p = call()?.selectCamera(c.id, cameraFacing(c.facing));
    if (!p) return;
    setCameraBusy(c.id);
    p.catch(warn("camera")).finally(() => setCameraBusy(null));
  };

  return (
    <View style={styles.root} onTouchStart={onTouchStart}>
      <View style={styles.area} onLayout={(e) => setArea(e.nativeEvent.layout)}>
        <View style={[styles.grid, { height: gridH }]}>
          {tiles.length === 0 ? (
            <Text style={styles.waiting}>{state.phase === "connecting" ? "Connecting…" : `Waiting for others in #${state.slug}…`}</Text>
          ) : (
            tiles.map((t) => t.kind === "own-screen"
              ? <OwnShareTile key={t.key} width={tileW} height={tileH} />
              : t.kind === "screen"
              ? <ScreenTile key={t.key} p={t.p} width={tileW} height={tileH} onOpen={() => { if (!touchShowed.current) setViewing({ kind: "screen", id: t.p.id }); }} />
              : <Tile
                key={t.key} p={t.p} width={tileW} height={tileH}
                volume={volumes[t.p.id] ?? 1}
                dataSaver={state.dataSaver}
                onPress={() => { if (!touchShowed.current) setViewing({ kind: "camera", id: t.p.id }); }}
                onLongPress={() => setVolumeFor(t.p.id)}
              />)
          )}
        </View>
        <Animated.View
          style={[styles.top, { top: insets.top, left: insets.left, right: insets.right, opacity: fade }]}
          pointerEvents="none"
          accessibilityElementsHidden={!chrome.visible}
          importantForAccessibility={chrome.visible ? "auto" : "no-hide-descendants"}
        >
          <TopBar slug={state.slug} locked={mod.locked} />
        </Animated.View>
        <SelfView inset={insets.top} stream={state.camera && !hideSelf ? state.localStream : null} onFlip={() => { call()?.flipCamera().catch(warn("flip camera")); }} />
        <Banner inset={insets.top} kind={state.banner} notices={notices} />
        {debug ? <DebugOverlay top={insets.top + 44} left={insets.left + 4} /> : null}
        {share.status === "sharing" ? (
          <SharingPill bottom={insets.bottom + 8 + (chrome.visible ? CONTROLS_H : 0)} onStop={() => call()?.screenShare.stop("user")} />
        ) : null}
        <Animated.View
          style={[styles.controls, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right, opacity: fade }]}
          pointerEvents={chrome.visible ? "auto" : "none"}
          accessibilityElementsHidden={!chrome.visible}
          importantForAccessibility={chrome.visible ? "auto" : "no-hide-descendants"}
        >
          <Controls
            mic={state.mic}
            camera={state.camera}
            routeA11y={`Audio and video devices. Output: ${current?.name ?? outputLabel(undefined)}`}
            onMic={() => { call()?.setMic(!state.mic).catch(warn("mic")); }}
            onCamera={() => { call()?.setCamera(!state.camera).catch(warn("camera")); }}
            unread={chat.unread}
            onChat={toggleChat}
            onMore={() => { setSheet(sheet === "more" ? null : "more"); call()?.chat.setOpen(false); }}
            onRoute={() => {
              const open = sheet !== "devices";
              setSheet(open ? "devices" : null);
              if (open) listCameras().then(setCameras).catch(() => setCameras([]));
              call()?.chat.setOpen(false);
            }}
            onLeave={leave}
          />
        </Animated.View>
        <ChatSheet
          visible={sheet === "chat"}
          onClose={() => { setSheet(null); call()?.chat.setOpen(false); }}
          send={(t) => call()?.chat.send(t) ?? "offline"}
          draft={call()?.chat.draft ?? ""}
          onDraft={(t) => call()?.chat.setDraft(t)}
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
          onBackground={() => setSheet("background")}
          locked={mod.locked}
          quality={mod.quality}
          share={share.status}
          canShare={state.phase === "in-call"}
          onShare={() => { setSheet(null); call()?.screenShare.start().catch(warn("screen share")); }}
          onStopShare={() => { setSheet(null); call()?.screenShare.stop("user"); }}
          mod={{
            lock: (pw) => call()?.moderation.lock(pw) ?? "offline",
            unlock: () => call()?.moderation.unlock() ?? "offline",
            setQuality: (t, tier) => call()?.moderation.setQuality(t, tier) ?? "offline",
          }}
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
        <BackgroundSheet
          visible={sheet === "background"}
          onClose={() => setSheet(null)}
          snap={bg}
          onOpen={loadScenes}
          onSelect={(id) => {
            call()?.background.select(id).catch(warn("background"));
            savePrefs({ background: id }).catch(() => {});
          }}
        />
        <DevicesSheet
          visible={sheet === "devices"}
          onClose={() => setSheet(null)}
          routes={routes}
          pending={pending}
          cameras={cameras}
          cameraId={state.cameraId}
          cameraBusy={cameraBusy}
          onOutput={pickRoute}
          onInput={pickMic}
          onCamera={pickCamera}
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
        <ScreenViewer v={viewed} onClose={() => setViewing(null)} isOp={state.role === "op"} onStopShare={(id) => call()?.moderation.stopShare(id) ?? "offline"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  area: { flex: 1 },
  top: { position: "absolute", height: 40 },
  controls: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(17,18,20,0.85)" },
  grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start" },
  waiting: { color: colors.muted, textAlign: "center", width: "100%", marginTop: "50%" },
  setup: { alignItems: "center", justifyContent: "center", gap: 24 },
  setupText: { color: colors.muted, fontSize: 16 },
  leave: { height: 52, borderRadius: 26, paddingHorizontal: 24, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  leaveText: { color: colors.text, fontSize: 18, fontWeight: "600" },
});
